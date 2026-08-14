-- ═══════════════════════════════════════════════════════
-- 小纸条 & 语音信箱 (Ephemeral) —— 阅后即逝私密功能
--
-- 执行方式：Supabase Dashboard → SQL Editor → New query → 粘贴 → Run
-- 所有语句均带 IF NOT EXISTS / CREATE OR REPLACE，可重复执行
--
-- ⚠️ 身份模型安全边界（务必阅读）：
--   本项目登录使用本地 VALID_USERS / AsyncStorage，并非真正的 Supabase Auth。
--   客户端持有的是 anon key，因此下列 RLS 策略沿用项目既有约定
--   （gomoku_games / checkin 等表）采用「Allow all」。
--   这意味着 anon 客户端在表层面没有严格的用户身份隔离——
--   真正的“阅后即逝 / 防重复抽取”并发安全由 Postgres RPC
--   （FOR UPDATE SKIP LOCKED + claim_token）在服务端原子保证，
--   而非依赖客户端身份。请勿将 service_role key 放入客户端。
-- ═══════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════
-- 1. 小纸条表 ephemeral_notes
-- ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ephemeral_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id varchar NOT NULL,
  receiver_id varchar NOT NULL,
  content text NOT NULL,
  paper_style varchar,                       -- 信纸样式 ID（仅存 ID，不存 HTML）
  status varchar NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'consumed')),
  claim_token uuid,                          -- 抽取时生成，消费时校验
  claimed_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,                    -- 可选过期时间
  client_request_id uuid NOT NULL,           -- 客户端去重 ID（防止重复发送）
  -- 合法用户 + 收发双方不能相同（本项目为固定二人 App）
  CONSTRAINT ephemeral_notes_users_chk
    CHECK (sender_id IN ('momo', '苞米')
       AND receiver_id IN ('momo', '苞米')
       AND sender_id <> receiver_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_ephemeral_notes_recv_status_created
  ON ephemeral_notes(receiver_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_ephemeral_notes_sender_status
  ON ephemeral_notes(sender_id, status);
CREATE INDEX IF NOT EXISTS idx_ephemeral_notes_claimed_at
  ON ephemeral_notes(claimed_at);
-- client_request_id 唯一，防重复发送
CREATE UNIQUE INDEX IF NOT EXISTS idx_ephemeral_notes_client_req
  ON ephemeral_notes(client_request_id);

-- RLS（沿用项目 Allow all 约定，并发安全交给 RPC）
ALTER TABLE ephemeral_notes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on ephemeral_notes') THEN
    CREATE POLICY "Allow all on ephemeral_notes" ON ephemeral_notes
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════
-- 2. 语音信箱表 ephemeral_voice_messages
-- ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ephemeral_voice_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id varchar NOT NULL,
  receiver_id varchar NOT NULL,
  storage_path text NOT NULL,                -- 私有 bucket 内路径，不存公共 URL
  duration_ms integer NOT NULL DEFAULT 0,
  waveform jsonb,                            -- 归一化波形点数组 [0..1]
  mime_type varchar,
  file_size integer,
  status varchar NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'consumed')),
  claim_token uuid,
  claimed_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  client_request_id uuid NOT NULL,
  CONSTRAINT ephemeral_voice_users_chk
    CHECK (sender_id IN ('momo', '苞米')
       AND receiver_id IN ('momo', '苞米')
       AND sender_id <> receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_ephemeral_voice_recv_status_created
  ON ephemeral_voice_messages(receiver_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_ephemeral_voice_sender_status
  ON ephemeral_voice_messages(sender_id, status);
CREATE INDEX IF NOT EXISTS idx_ephemeral_voice_claimed_at
  ON ephemeral_voice_messages(claimed_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ephemeral_voice_client_req
  ON ephemeral_voice_messages(client_request_id);

ALTER TABLE ephemeral_voice_messages ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on ephemeral_voice_messages') THEN
    CREATE POLICY "Allow all on ephemeral_voice_messages" ON ephemeral_voice_messages
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════
-- 3. Realtime 发布（可选兜底；主通道仍为腾讯 IM 信号）
-- ═══════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'ephemeral_notes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ephemeral_notes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'ephemeral_voice_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ephemeral_voice_messages;
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════
-- 4. RPC：原子随机抽取小纸条
--    使用 FOR UPDATE SKIP LOCKED 防止两台设备同时抽到同一张
--    阅后即逝采用 at-most-once 语义：一旦 claimed，即使客户端
--    崩溃不再 consume，该纸条也不会回到待抽取池（视为已送达并消失）。
--    p_client_id 支持幂等：客户端超时重试时，同一请求 ID 返回同一张纸条，
--    避免“服务端已 claim 成功、客户端超时重试拿到空结果导致纸条丢失”。
-- ═══════════════════════════════════════════════════════
ALTER TABLE ephemeral_notes ADD COLUMN IF NOT EXISTS claim_request_id text;
CREATE INDEX IF NOT EXISTS idx_ephemeral_notes_claim_req
  ON ephemeral_notes(claim_request_id) WHERE claim_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION claim_ephemeral_note(p_receiver text, p_client_id text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  sender_id varchar,
  content text,
  paper_style varchar,
  claim_token uuid,
  created_at timestamptz
) AS $$
DECLARE
  v_id uuid;
  v_token uuid;
  v_row RECORD;
BEGIN
  -- 幂等恢复：该客户端请求此前已 claim 成功（如网络超时后重试），直接返回那张纸条
  IF p_client_id IS NOT NULL THEN
    SELECT e.* INTO v_row
    FROM ephemeral_notes e
    WHERE e.claim_request_id = p_client_id
      AND e.status = 'claimed'
      AND e.receiver_id = p_receiver
    LIMIT 1;
    IF FOUND THEN
      RETURN QUERY
        SELECT v_row.id, v_row.sender_id, v_row.content, v_row.paper_style,
               v_row.claim_token, v_row.created_at;
      RETURN;
    END IF;
  END IF;

  SELECT e.id INTO v_id
  FROM ephemeral_notes e
  WHERE e.receiver_id = p_receiver
    AND e.status = 'pending'
  ORDER BY random()
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  v_token := gen_random_uuid();
  -- 注意：WHERE 必须用表名限定 id，否则与 RETURNS TABLE 的 OUT 参数 id
  -- 产生 42702 ambiguous column reference 错误（前端表现为“网络开小差”）
  UPDATE ephemeral_notes
    SET status = 'claimed', claimed_at = now(), claim_token = v_token,
        claim_request_id = p_client_id
    WHERE ephemeral_notes.id = v_id
    RETURNING * INTO v_row;

  RETURN QUERY
    SELECT v_row.id, v_row.sender_id, v_row.content, v_row.paper_style,
           v_row.claim_token, v_row.created_at;
END;
$$ LANGUAGE plpgsql;


-- ═══════════════════════════════════════════════════════
-- 5. RPC：消费小纸条（校验 claim_token，删除整行）
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION consume_ephemeral_note(p_id uuid, p_claim_token uuid)
RETURNS boolean AS $$
DECLARE
  v_found uuid;
BEGIN
  DELETE FROM ephemeral_notes
    WHERE id = p_id AND claim_token = p_claim_token
    RETURNING id INTO v_found;
  RETURN v_found IS NOT NULL;
END;
$$ LANGUAGE plpgsql;


-- ═══════════════════════════════════════════════════════
-- 6. RPC：原子随机抽取语音（p_client_id 幂等，同小纸条）
-- ═══════════════════════════════════════════════════════
ALTER TABLE ephemeral_voice_messages ADD COLUMN IF NOT EXISTS claim_request_id text;
CREATE INDEX IF NOT EXISTS idx_ephemeral_voice_claim_req
  ON ephemeral_voice_messages(claim_request_id) WHERE claim_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION claim_ephemeral_voice(p_receiver text, p_client_id text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  sender_id varchar,
  storage_path text,
  duration_ms integer,
  waveform jsonb,
  mime_type varchar,
  file_size integer,
  claim_token uuid,
  created_at timestamptz
) AS $$
DECLARE
  v_id uuid;
  v_token uuid;
  v_row RECORD;
BEGIN
  IF p_client_id IS NOT NULL THEN
    SELECT e.* INTO v_row
    FROM ephemeral_voice_messages e
    WHERE e.claim_request_id = p_client_id
      AND e.status = 'claimed'
      AND e.receiver_id = p_receiver
    LIMIT 1;
    IF FOUND THEN
      RETURN QUERY
        SELECT v_row.id, v_row.sender_id, v_row.storage_path, v_row.duration_ms,
               v_row.waveform, v_row.mime_type, v_row.file_size,
               v_row.claim_token, v_row.created_at;
      RETURN;
    END IF;
  END IF;

  SELECT e.id INTO v_id
  FROM ephemeral_voice_messages e
  WHERE e.receiver_id = p_receiver
    AND e.status = 'pending'
  ORDER BY random()
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  v_token := gen_random_uuid();
  -- 同上：表名限定 id，避免与 OUT 参数 id 歧义（42702）
  UPDATE ephemeral_voice_messages
    SET status = 'claimed', claimed_at = now(), claim_token = v_token,
        claim_request_id = p_client_id
    WHERE ephemeral_voice_messages.id = v_id
    RETURNING * INTO v_row;

  RETURN QUERY
    SELECT v_row.id, v_row.sender_id, v_row.storage_path, v_row.duration_ms,
           v_row.waveform, v_row.mime_type, v_row.file_size,
           v_row.claim_token, v_row.created_at;
END;
$$ LANGUAGE plpgsql;


-- ═══════════════════════════════════════════════════════
-- 7. RPC：消费语音（校验 claim_token，标记 consumed 并返回 storage_path
--    供客户端尽力删除 Storage 对象；DB 与 Storage 无法原子，故先标记）
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION consume_ephemeral_voice(p_id uuid, p_claim_token uuid)
RETURNS TABLE (ok boolean, storage_path text) AS $$
DECLARE
  v_row RECORD;
BEGIN
  UPDATE ephemeral_voice_messages
    SET status = 'consumed', consumed_at = now()
    WHERE id = p_id AND claim_token = p_claim_token
    RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RETURN QUERY SELECT false, NULL::text;
  ELSE
    RETURN QUERY SELECT true, v_row.storage_path;
  END IF;
END;
$$ LANGUAGE plpgsql;


-- ═══════════════════════════════════════════════════════
-- 7b. RPC：释放语音 claim（音频加载失败时回退到 pending，便于安全重试）
--     仅当状态仍为 claimed 时才回退；已 consumed 的不回退。
--     这是 at-most-once 的“从未播放”恢复路径：已开始播放的语音不会回退。
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION release_ephemeral_voice_claim(p_id uuid, p_claim_token uuid)
RETURNS boolean AS $$
DECLARE
  v_found uuid;
BEGIN
  UPDATE ephemeral_voice_messages
    SET status = 'pending', claim_token = NULL, claimed_at = NULL
    WHERE id = p_id AND claim_token = p_claim_token AND status = 'claimed'
    RETURNING id INTO v_found;
  RETURN v_found IS NOT NULL;
END;
$$ LANGUAGE plpgsql;


-- ═══════════════════════════════════════════════════════
-- 8. 兜底清理：删除已消费 / 过期的行（可手动或定时执行）
--    注意：此函数只清理数据库行，Storage 对象需由客户端消费时
--    尽力删除，或通过 Edge Function 做最终兜底（见交付说明）。
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION cleanup_old_ephemeral(p_age interval DEFAULT '1 day')
RETURNS TABLE (notes_deleted integer, voice_deleted integer) AS $$
DECLARE
  v_notes integer := 0;
  v_voice integer := 0;
BEGIN
  DELETE FROM ephemeral_notes
    WHERE (status = 'consumed' AND consumed_at < now() - p_age)
       OR (expires_at IS NOT NULL AND expires_at < now());
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM ephemeral_voice_messages
    WHERE (status = 'consumed' AND consumed_at < now() - p_age)
       OR (expires_at IS NOT NULL AND expires_at < now());
  GET DIAGNOSTICS v_voice = ROW_COUNT;

  RETURN QUERY SELECT v_notes, v_voice;
END;
$$ LANGUAGE plpgsql;
