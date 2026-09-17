-- ═══════════════════════════════════════════════════════
-- 0007: momi V5 可信记忆证据账本 + 稳定聊天历史 + worker job
--
-- 前置：0006_momi_and_features_upgrade.sql
-- 兼容：可直接从正式 0006 升级，也可用于已手工执行 momi V2/V3/V4 的库。
-- 安全：不回填历史 job；不会为旧消息生成新回复；不删除用户正文。
-- 重复执行：全部对象、索引、策略与触发器均按幂等方式处理。
--
-- 注意：当前 App 的本地昵称不是 Supabase Auth 身份。本迁移不能伪造用户级
-- RLS；private 记忆仍需客户端按 actor 二次过滤，后续启用 Auth 后必须收紧。
-- ═══════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.momi_assistant_messages') IS NULL
     OR to_regclass('public.momi_memory') IS NULL THEN
    RAISE EXCEPTION 'MOMI_V5_REQUIRES_MIGRATION_0006' USING ERRCODE = '42P01';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────
-- 1. 衔接正式 0006 与此前手工 V2/V3/V4：只补 V5 所需旧列
-- ─────────────────────────────────────────────────────
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS image_urls text[];
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS image_paths text[];
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS content_type varchar(20) DEFAULT 'text';
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS is_proactive boolean DEFAULT false;
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS trigger_source varchar(30);

ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS subject varchar(20);
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS keywords text[];
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS importance int DEFAULT 3;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS confidence numeric(3,2) DEFAULT 0.60;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS source varchar(20) DEFAULT 'ai_extracted';
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS source_ref text;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS hit_count int DEFAULT 0;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS last_hit_at timestamptz;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.momi_memory ALTER COLUMN user_id DROP NOT NULL;

UPDATE public.momi_memory
SET subject = COALESCE(NULLIF(subject, ''), NULLIF(user_id, ''), 'both'),
    importance = COALESCE(importance, 3),
    confidence = COALESCE(confidence, 0.60),
    source = COALESCE(source, 'ai_extracted'),
    hit_count = COALESCE(hit_count, 0),
    is_archived = COALESCE(is_archived, false),
    created_at = COALESCE(created_at, updated_at, now())
WHERE subject IS NULL
   OR importance IS NULL
   OR confidence IS NULL
   OR source IS NULL
   OR hit_count IS NULL
   OR is_archived IS NULL
   OR created_at IS NULL;

-- V2 的正文哈希索引不知道 superseded/deleted 生命周期，会阻止合法纠正。
DROP INDEX IF EXISTS public.momi_memory_dedupe;

-- ─────────────────────────────────────────────────────
-- 2. momi_memory：证据、主体、可见性与生命周期
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
    explicitness = CASE WHEN source = 'user_explicit' THEN 'explicit' ELSE explicitness END,
    status = CASE
      WHEN status IN ('active', 'superseded', 'unverified', 'deleted') THEN status
      ELSE 'unverified'
    END
WHERE category IS NULL
   OR normalized_value IS NULL
   OR search_text IS NULL
   OR source_type IS NULL
   OR status NOT IN ('active', 'superseded', 'unverified', 'deleted');

-- 仅当 source_ref 真正命中同 couple 的人类原始消息时，升级为可归因证据。
UPDATE public.momi_memory AS memory
SET source_message_id = message.id::text,
    source_user_id = message.sender,
    evidence_excerpt = COALESCE(memory.evidence_excerpt, message.content),
    last_confirmed_at = COALESCE(memory.last_confirmed_at, message.created_at),
    source_type = CASE WHEN memory.source = 'user_explicit' THEN 'explicit_command' ELSE 'user_message' END
FROM public.momi_assistant_messages AS message
WHERE memory.source_ref = message.id::text
  AND message.couple_id = memory.couple_id
  AND message.sender IN ('momo', '苞米')
  AND (memory.subject = message.sender OR memory.subject = 'both');

-- 无原始用户消息且非权威结构化/人格 seed 的旧推断全部隔离；只改状态。
UPDATE public.momi_memory
SET status = 'unverified', updated_at = now()
WHERE status = 'active'
  AND COALESCE(source_type, 'unknown') NOT IN ('seed', 'structured_data', 'verified_system_event')
  AND source_message_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.momi_memory'::regclass
      AND conname = 'momi_memory_status_check'
  ) THEN
    ALTER TABLE public.momi_memory ADD CONSTRAINT momi_memory_status_check
      CHECK (status IN ('active', 'superseded', 'unverified', 'deleted'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.momi_memory'::regclass
      AND conname = 'momi_memory_visibility_check'
  ) THEN
    ALTER TABLE public.momi_memory ADD CONSTRAINT momi_memory_visibility_check
      CHECK (visibility_scope IN ('private', 'couple'));
  END IF;
END $$;

-- 若此前部分执行过 V5，确定性保留每个 key 最新的一条 active，其余只转历史状态。
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY couple_id, subject, memory_key
           ORDER BY last_confirmed_at DESC NULLS LAST,
                    updated_at DESC NULLS LAST,
                    created_at DESC NULLS LAST,
                    id DESC
         ) AS row_num
  FROM public.momi_memory
  WHERE status = 'active' AND memory_key IS NOT NULL
)
UPDATE public.momi_memory AS memory
SET status = 'superseded',
    valid_to = COALESCE(valid_to, now()),
    updated_at = now()
FROM ranked
WHERE memory.id = ranked.id AND ranked.row_num > 1;

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
-- 3. 记忆来源映射与纠正/忘记传播审计
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
-- 4. 消息稳定身份、幂等键、回复链与确定性服务端顺序
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
    sender_user_id = CASE WHEN sender IN ('momo', '苞米') THEN sender ELSE NULL END,
    status = CASE WHEN status IN ('pending', 'synced', 'retryable', 'failed') THEN status ELSE 'synced' END,
    updated_at = COALESCE(updated_at, created_at, now())
WHERE sender_type IS NULL
   OR sender_type NOT IN ('user', 'assistant', 'system')
   OR (sender_user_id IS NULL AND sender IN ('momo', '苞米'))
   OR status NOT IN ('pending', 'synced', 'retryable', 'failed')
   OR updated_at IS NULL;

CREATE SEQUENCE IF NOT EXISTS public.momi_assistant_messages_server_sequence_seq;
ALTER SEQUENCE public.momi_assistant_messages_server_sequence_seq
  OWNED BY public.momi_assistant_messages.server_sequence;

WITH sequence_base AS (
  SELECT COALESCE(max(server_sequence), 0)::bigint AS max_sequence
  FROM public.momi_assistant_messages
), ordered_missing AS (
  SELECT message.id,
         sequence_base.max_sequence
           + row_number() OVER (ORDER BY message.created_at ASC, message.id ASC) AS assigned_sequence
  FROM public.momi_assistant_messages AS message
  CROSS JOIN sequence_base
  WHERE message.server_sequence IS NULL
)
UPDATE public.momi_assistant_messages AS message
SET server_sequence = ordered_missing.assigned_sequence
FROM ordered_missing
WHERE message.id = ordered_missing.id;

SELECT setval(
  'public.momi_assistant_messages_server_sequence_seq',
  COALESCE(max(server_sequence), 1),
  max(server_sequence) IS NOT NULL
)
FROM public.momi_assistant_messages;

ALTER TABLE public.momi_assistant_messages ALTER COLUMN server_sequence
  SET DEFAULT nextval('public.momi_assistant_messages_server_sequence_seq');
ALTER TABLE public.momi_assistant_messages ALTER COLUMN server_sequence SET NOT NULL;

-- 保留所有正文；仅给历史重复幂等键改成带 UUID 的确定性 legacy key。
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY couple_id, client_message_id
           ORDER BY server_sequence ASC, id ASC
         ) AS row_num
  FROM public.momi_assistant_messages
  WHERE client_message_id IS NOT NULL
)
UPDATE public.momi_assistant_messages AS message
SET client_message_id = 'legacy-duplicate:' || message.id::text
FROM ranked
WHERE message.id = ranked.id AND ranked.row_num > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY generation_key
           ORDER BY server_sequence ASC, id ASC
         ) AS row_num
  FROM public.momi_assistant_messages
  WHERE generation_key IS NOT NULL
)
UPDATE public.momi_assistant_messages AS message
SET generation_key = 'legacy-duplicate:' || message.id::text
FROM ranked
WHERE message.id = ranked.id AND ranked.row_num > 1;

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

CREATE OR REPLACE FUNCTION public.normalize_momi_assistant_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.sender_type := CASE
    WHEN NEW.sender_type IN ('user', 'assistant', 'system') THEN NEW.sender_type
    WHEN NEW.sender = 'momi' THEN 'assistant'
    ELSE 'user'
  END;
  IF NEW.sender_type = 'user' THEN
    NEW.sender_user_id := COALESCE(NEW.sender_user_id, NEW.sender);
  ELSE
    NEW.sender_user_id := NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := COALESCE(NEW.updated_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_momi_assistant_message_trigger ON public.momi_assistant_messages;
CREATE TRIGGER normalize_momi_assistant_message_trigger
BEFORE INSERT OR UPDATE ON public.momi_assistant_messages
FOR EACH ROW EXECUTE FUNCTION public.normalize_momi_assistant_message();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.momi_assistant_messages'::regclass
      AND conname = 'momi_message_sender_type_check'
  ) THEN
    ALTER TABLE public.momi_assistant_messages ADD CONSTRAINT momi_message_sender_type_check
      CHECK (sender_type IN ('user', 'assistant', 'system'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.momi_assistant_messages'::regclass
      AND conname = 'momi_message_status_check'
  ) THEN
    ALTER TABLE public.momi_assistant_messages ADD CONSTRAINT momi_message_status_check
      CHECK (status IN ('pending', 'synced', 'retryable', 'failed'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────
-- 5. 服务端回复 job：source message / idempotency / lease 三层防重
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.momi_chat_jobs'::regclass
      AND conname = 'momi_chat_jobs_status_check'
  ) THEN
    ALTER TABLE public.momi_chat_jobs ADD CONSTRAINT momi_chat_jobs_status_check
      CHECK (status IN ('pending', 'processing', 'retryable', 'completed', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS momi_chat_jobs_claim_idx
  ON public.momi_chat_jobs (status, next_retry_at, created_at)
  WHERE status IN ('pending', 'retryable');

ALTER TABLE public.momi_chat_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own couple momi jobs" ON public.momi_chat_jobs;
REVOKE ALL ON TABLE public.momi_chat_jobs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_momi_chat_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

-- 触发器只作用于今后新插入的 user message；此处刻意不回填历史 job。
NOTIFY pgrst, 'reload schema';

COMMIT;

-- 执行后只看结构/数量，禁止在共享日志输出正文：
-- SELECT status, count(*) FROM public.momi_memory GROUP BY status;
-- SELECT sender_type, count(*) FROM public.momi_assistant_messages GROUP BY sender_type;
-- SELECT status, count(*) FROM public.momi_chat_jobs GROUP BY status;
