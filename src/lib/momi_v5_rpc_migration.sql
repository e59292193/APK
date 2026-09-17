-- =============================================================================
-- LEGACY REFERENCE ONLY - DO NOT DEPLOY
-- momi V5 历史 RPC 副本 (momi_v5_rpc_migration.sql)
-- 本文件仅保留作历史/本地对照，可能与正式迁移分叉。
-- 禁止在 Supabase SQL Editor 或任何生产环境直接执行本文件。
-- 正式部署请严格按顺序使用：
--   supabase/migrations/0007_momi_v5_memory_history.sql
--   supabase/migrations/0008_momi_v5_atomic_rpc.sql
-- 正式 0008 另含过期 lease 回收、最大尝试终止及严格 generation/source 校验。
-- 部署与回滚步骤见 supabase/migrations/README.md。
-- 下方 SQL 不再维护，也不承诺与正式迁移等价。
-- 历史目标：记忆 add/update/forget 与 chat job claim/reply 原子化、幂等化。
-- =============================================================================

-- ─────────────────────────────────────────────────────
-- 1. 写入/确认/纠正一条经过 evidence firewall 验证的记忆
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_verified_momi_memory(
  p_operation varchar,
  p_couple_id varchar,
  p_subject varchar,
  p_subject_type varchar,
  p_visibility_scope varchar,
  p_category varchar,
  p_memory_key text,
  p_content text,
  p_search_text text,
  p_keywords text[],
  p_confidence numeric,
  p_importance int,
  p_explicitness varchar,
  p_source_type varchar,
  p_source_message_id text,
  p_source_user_id varchar,
  p_evidence_excerpt text,
  p_valid_from timestamptz DEFAULT now(),
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS SETOF public.momi_memory
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_content text;
  v_existing public.momi_memory%ROWTYPE;
  v_result public.momi_memory%ROWTYPE;
BEGIN
  IF p_operation NOT IN ('add', 'update') THEN
    RAISE EXCEPTION 'MOMI_MEMORY_INVALID_OPERATION' USING ERRCODE = '22023';
  END IF;
  IF p_couple_id IS NULL OR p_subject IS NULL OR p_memory_key IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'MOMI_MEMORY_MISSING_REQUIRED_FIELD' USING ERRCODE = '22023';
  END IF;
  IF p_subject_type NOT IN ('user', 'couple') OR p_visibility_scope NOT IN ('private', 'couple') THEN
    RAISE EXCEPTION 'MOMI_MEMORY_INVALID_SCOPE' USING ERRCODE = '22023';
  END IF;
  IF p_subject_type = 'user' AND p_subject <> p_source_user_id THEN
    RAISE EXCEPTION 'MOMI_MEMORY_SPEAKER_SUBJECT_MISMATCH' USING ERRCODE = '22023';
  END IF;
  IF p_subject_type = 'couple' AND p_visibility_scope <> 'couple' THEN
    RAISE EXCEPTION 'MOMI_MEMORY_COUPLE_SCOPE_MISMATCH' USING ERRCODE = '22023';
  END IF;

  -- 用户来源必须回查 canonical user message，且 evidence_excerpt 必须为连续原文。
  IF p_source_type IN ('user_message', 'explicit_command') THEN
    IF p_source_message_id IS NULL OR p_source_user_id NOT IN ('momo', '苞米') OR btrim(COALESCE(p_evidence_excerpt, '')) = '' THEN
      RAISE EXCEPTION 'MOMI_MEMORY_MISSING_USER_EVIDENCE' USING ERRCODE = '22023';
    END IF;
    SELECT message.content INTO v_source_content
    FROM public.momi_assistant_messages AS message
    WHERE message.id::text = p_source_message_id
      AND message.couple_id = p_couple_id
      AND message.sender_type = 'user'
      AND message.sender_user_id = p_source_user_id;
    IF v_source_content IS NULL OR position(p_evidence_excerpt IN v_source_content) = 0 THEN
      RAISE EXCEPTION 'MOMI_MEMORY_EVIDENCE_NOT_FOUND' USING ERRCODE = '22023';
    END IF;
  ELSIF p_source_type NOT IN ('structured_data', 'verified_system_event', 'seed', 'manual') THEN
    RAISE EXCEPTION 'MOMI_MEMORY_UNTRUSTED_SOURCE' USING ERRCODE = '22023';
  END IF;

  -- 同 couple/主体/key 串行，避免双端同时纠正产生两个 active。
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_couple_id || ':' || p_subject || ':' || p_memory_key, 0
  ));

  SELECT * INTO v_existing
  FROM public.momi_memory
  WHERE couple_id = p_couple_id
    AND subject = p_subject
    AND memory_key = p_memory_key
    AND status = 'active'
  ORDER BY last_confirmed_at DESC NULLS LAST, updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing.id IS NOT NULL AND btrim(v_existing.content) = btrim(p_content) THEN
    UPDATE public.momi_memory
    SET confidence = GREATEST(confidence, LEAST(1, GREATEST(0, p_confidence))),
        importance = GREATEST(importance, LEAST(5, GREATEST(1, p_importance))),
        keywords = COALESCE(p_keywords, keywords),
        search_text = COALESCE(NULLIF(btrim(p_search_text), ''), search_text),
        source_type = p_source_type,
        source_message_id = p_source_message_id,
        source_user_id = p_source_user_id,
        evidence_excerpt = p_evidence_excerpt,
        explicitness = p_explicitness,
        last_confirmed_at = COALESCE(p_valid_from, now()),
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_result;
  ELSE
    IF v_existing.id IS NOT NULL AND p_operation <> 'update' THEN
      RAISE EXCEPTION 'MOMI_MEMORY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;

    IF v_existing.id IS NOT NULL THEN
      UPDATE public.momi_memory
      SET status = 'superseded', valid_to = COALESCE(p_valid_from, now()), updated_at = now()
      WHERE id = v_existing.id;
    END IF;

    INSERT INTO public.momi_memory (
      couple_id, user_id, subject, subject_type, visibility_scope,
      memory_type, category, memory_key, content, normalized_value, search_text, keywords,
      importance, confidence, explicitness, source, source_type, source_ref,
      source_message_id, source_user_id, evidence_excerpt,
      status, valid_from, expires_at, supersedes_id, last_confirmed_at,
      is_archived, hit_count, created_at, updated_at
    ) VALUES (
      p_couple_id, p_subject, p_subject, p_subject_type, p_visibility_scope,
      p_category, p_category, p_memory_key, btrim(p_content), btrim(p_content),
      COALESCE(NULLIF(btrim(p_search_text), ''), btrim(p_content)), COALESCE(p_keywords, '{}'::text[]),
      LEAST(5, GREATEST(1, p_importance)), LEAST(1, GREATEST(0, p_confidence)),
      p_explicitness, left(p_source_type, 20), p_source_type, p_source_message_id,
      p_source_message_id, p_source_user_id, p_evidence_excerpt,
      'active', COALESCE(p_valid_from, now()), p_expires_at, v_existing.id,
      COALESCE(p_valid_from, now()), false, 0, now(), now()
    )
    RETURNING * INTO v_result;
  END IF;

  IF p_source_message_id IS NOT NULL THEN
    INSERT INTO public.momi_memory_sources (
      memory_id, couple_id, source_message_id, source_user_id, source_type,
      evidence_excerpt, processing_status, updated_at
    ) VALUES (
      v_result.id, p_couple_id, p_source_message_id, p_source_user_id, p_source_type,
      p_evidence_excerpt, 'pending', now()
    )
    ON CONFLICT (memory_id, source_message_id, source_type) DO UPDATE
      SET source_user_id = EXCLUDED.source_user_id,
          evidence_excerpt = EXCLUDED.evidence_excerpt,
          processing_status = CASE
            WHEN momi_memory_sources.processing_status = 'completed' THEN 'completed'
            ELSE 'pending'
          END,
          updated_at = now();
  END IF;

  RETURN NEXT v_result;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 2. 忘记：状态与传播审计同事务写入；不提前宣称派生引擎已完成删除
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.forget_verified_momi_memories(
  p_couple_id varchar,
  p_actor_id varchar,
  p_subject varchar,
  p_memory_key text,
  p_source_message_id text
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_actor_id NOT IN ('momo', '苞米') OR p_subject NOT IN ('momo', '苞米', 'both') THEN
    RAISE EXCEPTION 'MOMI_MEMORY_INVALID_ACTOR' USING ERRCODE = '22023';
  END IF;
  IF p_subject NOT IN (p_actor_id, 'both') THEN
    RAISE EXCEPTION 'MOMI_MEMORY_FORGET_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_couple_id || ':' || p_subject || ':' || COALESCE(p_memory_key, '*'), 0
  ));

  WITH changed AS (
    UPDATE public.momi_memory
    SET status = 'deleted', valid_to = now(), updated_at = now()
    WHERE couple_id = p_couple_id
      AND subject = p_subject
      AND status = 'active'
      AND (p_memory_key IS NULL OR memory_key = p_memory_key)
    RETURNING id
  ), audit AS (
    INSERT INTO public.momi_memory_events (
      couple_id, actor_id, memory_id, event_type, source_message_id, propagation_status
    )
    SELECT p_couple_id, p_actor_id, changed.id, 'forget', p_source_message_id, 'pending'
    FROM changed
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM audit;

  RETURN v_count;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 3. worker 领取 job：SKIP LOCKED + lease + attempt_count
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_momi_chat_job(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF public.momi_chat_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.momi_chat_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job
  FROM public.momi_chat_jobs
  WHERE status IN ('pending', 'retryable')
    AND (next_retry_at IS NULL OR next_retry_at <= now())
    AND (lease_until IS NULL OR lease_until < now())
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.momi_chat_jobs
  SET status = 'processing',
      lease_owner = p_worker_id,
      lease_until = now() + make_interval(secs => LEAST(300, GREATEST(15, p_lease_seconds))),
      attempt_count = attempt_count + 1,
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN NEXT v_job;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 4. worker 原子保存最终回复：generation_key 保证重试仍只有一条
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_momi_chat_job(
  p_job_id uuid,
  p_worker_id text,
  p_content text,
  p_generation_key text
)
RETURNS SETOF public.momi_assistant_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.momi_chat_jobs%ROWTYPE;
  v_reply public.momi_assistant_messages%ROWTYPE;
BEGIN
  SELECT * INTO v_job
  FROM public.momi_chat_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_job.id IS NULL OR v_job.status <> 'processing' OR v_job.lease_owner IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'MOMI_CHAT_JOB_LEASE_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_content, '')) = '' OR btrim(COALESCE(p_generation_key, '')) = '' THEN
    RAISE EXCEPTION 'MOMI_CHAT_EMPTY_REPLY' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.momi_assistant_messages (
    couple_id, sender, sender_type, sender_user_id, content,
    reply_to_message_id, generation_key, status, trigger_source
  ) VALUES (
    v_job.couple_id, 'momi', 'assistant', NULL, btrim(p_content),
    v_job.source_message_id::text, p_generation_key, 'synced', 'assistant_worker'
  )
  ON CONFLICT (generation_key) WHERE generation_key IS NOT NULL DO NOTHING
  RETURNING * INTO v_reply;

  IF v_reply.id IS NULL THEN
    SELECT * INTO v_reply
    FROM public.momi_assistant_messages
    WHERE generation_key = p_generation_key;
  END IF;

  UPDATE public.momi_chat_jobs
  SET status = 'completed', lease_owner = NULL, lease_until = NULL,
      last_error_code = NULL, updated_at = now()
  WHERE id = v_job.id;

  RETURN NEXT v_reply;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 5. worker 失败：有限退避由调用方传秒数，数据库封顶 15 分钟
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fail_momi_chat_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_retryable boolean,
  p_retry_seconds integer DEFAULT 30
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed integer;
BEGIN
  UPDATE public.momi_chat_jobs
  SET status = CASE WHEN p_retryable AND attempt_count < 5 THEN 'retryable' ELSE 'failed' END,
      lease_owner = NULL,
      lease_until = NULL,
      next_retry_at = CASE
        WHEN p_retryable AND attempt_count < 5
          THEN now() + make_interval(secs => LEAST(900, GREATEST(5, p_retry_seconds)))
        ELSE NULL
      END,
      last_error_code = left(COALESCE(p_error_code, 'UNKNOWN'), 120),
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND lease_owner IS NOT DISTINCT FROM p_worker_id;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

-- 客户端只需要记忆写入/忘记；worker RPC 不授予 anon/authenticated。
GRANT EXECUTE ON FUNCTION public.apply_verified_momi_memory(
  varchar, varchar, varchar, varchar, varchar, varchar, text, text, text, text[],
  numeric, int, varchar, varchar, text, varchar, text, timestamptz, timestamptz
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forget_verified_momi_memories(
  varchar, varchar, varchar, text, text
) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.claim_momi_chat_job(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_momi_chat_job(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_momi_chat_job(uuid, text, text, boolean, integer) FROM PUBLIC, anon, authenticated;

-- 撤销 PUBLIC 默认权限后，必须显式允许服务端 worker 的 service_role 调用。
GRANT EXECUTE ON FUNCTION public.claim_momi_chat_job(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_momi_chat_job(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_momi_chat_job(uuid, text, text, boolean, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
