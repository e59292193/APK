-- ═══════════════════════════════════════════════════════
-- ⚠️ LEGACY REFERENCE ONLY — DO NOT DEPLOY
-- momi V5 历史手工脚本 (momi_v5_migration.sql)
-- 本文件仅保留作历史/本地对照，可能与正式迁移分叉。
-- 禁止在 Supabase SQL Editor 或任何生产环境直接执行本文件。
-- 正式部署请严格按顺序使用：
--   supabase/migrations/0007_momi_v5_memory_history.sql
--   supabase/migrations/0008_momi_v5_atomic_rpc.sql
-- 部署与回滚步骤见 supabase/migrations/README.md。
-- 下方 SQL 不再维护，也不承诺与正式迁移等价。
-- 历史目标：可信记忆证据账本 + 聊天消息幂等链 + worker job
--
-- 鉴权说明：当前 APP 仍为本地昵称登录，数据库无法从 auth.uid() 区分 momo/苞米。
-- 本迁移不伪造无效的用户级 RLS；沿用既有封闭双人策略，并要求所有读写在
-- momiMemoryOrchestrator 中按 couple_id + actor_id + visibility_scope 二次鉴权。
-- 若后续启用 Supabase Auth，必须再收紧 private 记忆的数据库策略。
-- ═══════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────
-- 1. momi_memory：兼容旧表补齐证据、主体、生命周期字段
-- ─────────────────────────────────────────────────────
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'active';
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS subject_type varchar(16) NOT NULL DEFAULT 'user';
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS visibility_scope varchar(16) NOT NULL DEFAULT 'couple';
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS category varchar(32);
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS memory_key text;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS normalized_value text;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS search_text text;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS explicitness varchar(16) NOT NULL DEFAULT 'inferred';
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS source_type varchar(32);
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS source_message_id text;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS source_user_id varchar(20);
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS evidence_excerpt text;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS valid_from timestamptz;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS valid_to timestamptz;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS supersedes_id uuid;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz;

-- 旧字段映射；不推测不存在的来源。
UPDATE public.momi_memory
SET subject_type = CASE WHEN subject = 'both' THEN 'couple' ELSE 'user' END,
    visibility_scope = CASE WHEN subject = 'both' THEN 'couple' ELSE 'private' END,
    category = COALESCE(category, memory_type, 'other'),
    normalized_value = COALESCE(normalized_value, content),
    search_text = COALESCE(search_text, content),
    source_type = COALESCE(source_type, CASE
      WHEN source = 'seed' THEN 'seed'
      WHEN source = 'db_sync' THEN 'structured_data'
      WHEN source = 'user_explicit' THEN 'explicit_command'
      WHEN source = 'ai_extracted' THEN 'unknown'
      ELSE 'manual'
    END),
    explicitness = CASE WHEN source = 'user_explicit' THEN 'explicit' ELSE explicitness END
WHERE category IS NULL
   OR normalized_value IS NULL
   OR search_text IS NULL
   OR source_type IS NULL;

-- 只有 source_ref 真正指向对应人类原始消息时才升级为可归因证据。
UPDATE public.momi_memory AS memory
SET source_message_id = message.id::text,
    source_user_id = message.sender,
    evidence_excerpt = COALESCE(memory.evidence_excerpt, message.content),
    last_confirmed_at = COALESCE(memory.last_confirmed_at, message.created_at),
    source_type = CASE WHEN memory.source = 'user_explicit' THEN 'explicit_command' ELSE 'user_message' END
FROM public.momi_assistant_messages AS message
WHERE memory.source_ref = message.id::text
  AND message.sender IN ('momo', '苞米')
  AND (memory.subject = message.sender OR memory.subject = 'both');

-- 无原始 user message 且非权威结构化/人格 seed 的旧记忆全部隔离；仅改状态，不删除。
UPDATE public.momi_memory
SET status = 'unverified', updated_at = now()
WHERE status = 'active'
  AND COALESCE(source_type, 'unknown') NOT IN ('seed', 'structured_data')
  AND source_message_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'momi_memory_status_check') THEN
    ALTER TABLE public.momi_memory ADD CONSTRAINT momi_memory_status_check
      CHECK (status IN ('active', 'superseded', 'unverified', 'deleted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'momi_memory_visibility_check') THEN
    ALTER TABLE public.momi_memory ADD CONSTRAINT momi_memory_visibility_check
      CHECK (visibility_scope IN ('private', 'couple'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS momi_memory_evidence_idx
  ON public.momi_memory (couple_id, subject, status);
CREATE INDEX IF NOT EXISTS momi_memory_key_idx
  ON public.momi_memory (couple_id, subject, memory_key, status);
CREATE UNIQUE INDEX IF NOT EXISTS momi_memory_source_msg_key_unique
  ON public.momi_memory (couple_id, subject, memory_key, source_message_id)
  WHERE source_message_id IS NOT NULL AND memory_key IS NOT NULL AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS momi_memory_one_active_key
  ON public.momi_memory (couple_id, subject, memory_key)
  WHERE memory_key IS NOT NULL AND status = 'active';

-- ─────────────────────────────────────────────────────
-- 2. 记忆来源映射与纠正/忘记审计（Hindsight/Graphiti 均为可重建派生索引）
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.momi_memory_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES public.momi_memory(id) ON DELETE CASCADE,
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  source_message_id text NOT NULL,
  source_user_id varchar(20),
  source_type varchar(32) NOT NULL,
  evidence_excerpt text,
  hindsight_document_id text,
  graphiti_episode_uuid text,
  processing_status varchar(20) NOT NULL DEFAULT 'pending',
  attempt_count int NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (memory_id, source_message_id, source_type)
);

CREATE TABLE IF NOT EXISTS public.momi_memory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  actor_id varchar(20) NOT NULL,
  memory_id uuid REFERENCES public.momi_memory(id) ON DELETE SET NULL,
  event_type varchar(20) NOT NULL,
  source_message_id text,
  propagation_status varchar(20) NOT NULL DEFAULT 'pending',
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS momi_memory_sources_retry_idx
  ON public.momi_memory_sources (processing_status, updated_at)
  WHERE processing_status IN ('pending', 'retryable');
CREATE INDEX IF NOT EXISTS momi_memory_events_retry_idx
  ON public.momi_memory_events (propagation_status, created_at)
  WHERE propagation_status IN ('pending', 'retryable');

ALTER TABLE public.momi_memory_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.momi_memory_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow couple app on momi_memory_sources" ON public.momi_memory_sources;
CREATE POLICY "Allow couple app on momi_memory_sources"
  ON public.momi_memory_sources FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow couple app on momi_memory_events" ON public.momi_memory_events;
CREATE POLICY "Allow couple app on momi_memory_events"
  ON public.momi_memory_events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────
-- 3. momi_assistant_messages：稳定身份、幂等键、顺序与回复链
-- ─────────────────────────────────────────────────────
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS sender_type varchar(16);
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS sender_user_id varchar(20);
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS client_message_id text;
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS reply_to_message_id text;
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'synced';
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS server_sequence bigint;
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS generation_key text;

UPDATE public.momi_assistant_messages
SET sender_type = CASE WHEN sender = 'momi' THEN 'assistant' ELSE 'user' END,
    sender_user_id = CASE WHEN sender IN ('momo', '苞米') THEN sender ELSE NULL END
WHERE sender_type IS NULL OR (sender_user_id IS NULL AND sender IN ('momo', '苞米'));

CREATE SEQUENCE IF NOT EXISTS public.momi_assistant_messages_server_sequence_seq;
ALTER SEQUENCE public.momi_assistant_messages_server_sequence_seq
  OWNED BY public.momi_assistant_messages.server_sequence;
ALTER TABLE public.momi_assistant_messages ALTER COLUMN server_sequence
  SET DEFAULT nextval('public.momi_assistant_messages_server_sequence_seq');
UPDATE public.momi_assistant_messages
SET server_sequence = nextval('public.momi_assistant_messages_server_sequence_seq')
WHERE server_sequence IS NULL;
ALTER TABLE public.momi_assistant_messages ALTER COLUMN server_sequence SET NOT NULL;

CREATE OR REPLACE FUNCTION public.normalize_momi_assistant_message()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.sender_type := COALESCE(NEW.sender_type, CASE WHEN NEW.sender = 'momi' THEN 'assistant' ELSE 'user' END);
  IF NEW.sender_type = 'user' THEN
    NEW.sender_user_id := COALESCE(NEW.sender_user_id, NEW.sender);
  ELSE
    NEW.sender_user_id := NULL;
  END IF;
  NEW.updated_at := COALESCE(NEW.updated_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_momi_assistant_message_trigger ON public.momi_assistant_messages;
CREATE TRIGGER normalize_momi_assistant_message_trigger
BEFORE INSERT OR UPDATE ON public.momi_assistant_messages
FOR EACH ROW EXECUTE FUNCTION public.normalize_momi_assistant_message();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'momi_message_sender_type_check') THEN
    ALTER TABLE public.momi_assistant_messages ADD CONSTRAINT momi_message_sender_type_check
      CHECK (sender_type IN ('user', 'assistant', 'system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'momi_message_status_check') THEN
    ALTER TABLE public.momi_assistant_messages ADD CONSTRAINT momi_message_status_check
      CHECK (status IN ('pending', 'synced', 'retryable', 'failed'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS momi_assistant_messages_client_id_unique
  ON public.momi_assistant_messages (couple_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS momi_assistant_messages_generation_key_unique
  ON public.momi_assistant_messages (generation_key)
  WHERE generation_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_momi_assistant_messages_stable_order
  ON public.momi_assistant_messages (couple_id, server_sequence, created_at);
CREATE INDEX IF NOT EXISTS idx_momi_assistant_messages_reply_to
  ON public.momi_assistant_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

-- ─────────────────────────────────────────────────────
-- 4. 服务端回复 job：source message / idempotency / lease 三层防重基础
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.momi_chat_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  source_message_id uuid NOT NULL REFERENCES public.momi_assistant_messages(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  lease_owner text,
  lease_until timestamptz,
  attempt_count int NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_message_id),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS momi_chat_jobs_claim_idx
  ON public.momi_chat_jobs (status, next_retry_at, created_at)
  WHERE status IN ('pending', 'retryable');

ALTER TABLE public.momi_chat_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own couple momi jobs" ON public.momi_chat_jobs;
CREATE POLICY "Read own couple momi jobs"
  ON public.momi_chat_jobs FOR SELECT TO anon, authenticated USING (couple_id = 'momo_and_baomi');
-- 客户端不可直接创建/领取 job；由消息触发器与服务端 worker 执行。

CREATE OR REPLACE FUNCTION public.enqueue_momi_chat_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sender_type = 'user' AND NEW.sender_user_id IN ('momo', '苞米') THEN
    INSERT INTO public.momi_chat_jobs (couple_id, source_message_id, idempotency_key)
    VALUES (NEW.couple_id, NEW.id, 'momi-message:' || NEW.id::text)
    ON CONFLICT (source_message_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_momi_chat_job_trigger ON public.momi_assistant_messages;
CREATE TRIGGER enqueue_momi_chat_job_trigger
AFTER INSERT ON public.momi_assistant_messages
FOR EACH ROW EXECUTE FUNCTION public.enqueue_momi_chat_job();

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════
-- ✅ 执行后自查（仅数量，不输出隐私内容）
-- SELECT status, count(*) FROM public.momi_memory GROUP BY status;
-- SELECT sender_type, count(*) FROM public.momi_assistant_messages GROUP BY sender_type;
-- SELECT status, count(*) FROM public.momi_chat_jobs GROUP BY status;
-- ═══════════════════════════════════════════════════════
