-- ═══════════════════════════════════════════════════════
-- 0008: momi V5 原子记忆 RPC + 可恢复 chat job RPC
--
-- 前置：0007_momi_v5_memory_history.sql
-- 目标：记忆 add/update/forget 与 worker claim/complete/fail 均数据库原子化。
-- 权限：记忆 RPC 给 App 角色；worker RPC 只给 service_role。
-- 重复执行：CREATE OR REPLACE / GRANT / REVOKE / IF NOT EXISTS 均幂等。
-- ═══════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.momi_memory') IS NULL
     OR to_regclass('public.momi_memory_sources') IS NULL
     OR to_regclass('public.momi_memory_events') IS NULL
     OR to_regclass('public.momi_assistant_messages') IS NULL
     OR to_regclass('public.momi_chat_jobs') IS NULL THEN
    RAISE EXCEPTION 'MOMI_V5_RPC_REQUIRES_MIGRATION_0007' USING ERRCODE = '42P01';
  END IF;
END $$;

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
SET search_path = public
AS $$
DECLARE
  v_source_content text;
  v_existing public.momi_memory%ROWTYPE;
  v_result public.momi_memory%ROWTYPE;
BEGIN
  IF COALESCE(p_operation, '') NOT IN ('add', 'update') THEN
    RAISE EXCEPTION 'MOMI_MEMORY_INVALID_OPERATION' USING ERRCODE = '22023';
  END IF;
  IF p_couple_id IS DISTINCT FROM 'momo_and_baomi' THEN
    RAISE EXCEPTION 'MOMI_MEMORY_INVALID_COUPLE' USING ERRCODE = '22023';
  END IF;
  IF p_subject IS NULL
     OR btrim(COALESCE(p_memory_key, '')) = ''
     OR btrim(COALESCE(p_content, '')) = '' THEN
    RAISE EXCEPTION 'MOMI_MEMORY_MISSING_REQUIRED_FIELD' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_subject_type, '') NOT IN ('user', 'couple')
     OR COALESCE(p_visibility_scope, '') NOT IN ('private', 'couple') THEN
    RAISE EXCEPTION 'MOMI_MEMORY_INVALID_SCOPE' USING ERRCODE = '22023';
  END IF;
  IF p_subject_type = 'user' AND p_source_type IN ('user_message', 'explicit_command')
     AND p_subject <> p_source_user_id THEN
    RAISE EXCEPTION 'MOMI_MEMORY_SPEAKER_SUBJECT_MISMATCH' USING ERRCODE = '22023';
  END IF;
  IF p_subject_type = 'couple'
     AND (p_subject <> 'both' OR p_visibility_scope <> 'couple') THEN
    RAISE EXCEPTION 'MOMI_MEMORY_COUPLE_SCOPE_MISMATCH' USING ERRCODE = '22023';
  END IF;

  -- 用户来源必须回查同 couple 的 canonical user message，且 excerpt 为连续原文。
  IF p_source_type IN ('user_message', 'explicit_command') THEN
    IF p_source_message_id IS NULL
       OR p_source_user_id NOT IN ('momo', '苞米')
       OR btrim(COALESCE(p_evidence_excerpt, '')) = '' THEN
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
  ELSIF COALESCE(p_source_type, '') NOT IN (
    'structured_data', 'verified_system_event', 'seed', 'manual'
  ) THEN
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
  ORDER BY last_confirmed_at DESC NULLS LAST, updated_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing.id IS NOT NULL AND btrim(v_existing.content) = btrim(p_content) THEN
    UPDATE public.momi_memory
    SET confidence = GREATEST(confidence, LEAST(1, GREATEST(0, COALESCE(p_confidence, 0)))),
        importance = GREATEST(importance, LEAST(5, GREATEST(1, COALESCE(p_importance, 1)))),
        keywords = COALESCE(p_keywords, keywords),
        search_text = COALESCE(NULLIF(btrim(p_search_text), ''), search_text),
        source_type = p_source_type,
        source_message_id = p_source_message_id,
        source_user_id = p_source_user_id,
        evidence_excerpt = p_evidence_excerpt,
        explicitness = COALESCE(p_explicitness, explicitness),
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
      SET status = 'superseded',
          valid_to = COALESCE(p_valid_from, now()),
          updated_at = now()
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
      COALESCE(NULLIF(p_category, ''), 'other'), COALESCE(NULLIF(p_category, ''), 'other'),
      btrim(p_memory_key), btrim(p_content), btrim(p_content),
      COALESCE(NULLIF(btrim(p_search_text), ''), btrim(p_content)), COALESCE(p_keywords, '{}'::text[]),
      LEAST(5, GREATEST(1, COALESCE(p_importance, 1))),
      LEAST(1, GREATEST(0, COALESCE(p_confidence, 0))),
      COALESCE(NULLIF(p_explicitness, ''), 'inferred'),
      left(p_source_type, 20), p_source_type, p_source_message_id,
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
-- 2. 忘记：状态与传播审计同事务写入，不提前宣称派生引擎已完成删除
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
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_couple_id IS DISTINCT FROM 'momo_and_baomi' THEN
    RAISE EXCEPTION 'MOMI_MEMORY_INVALID_COUPLE' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_actor_id, '') NOT IN ('momo', '苞米')
     OR COALESCE(p_subject, '') NOT IN ('momo', '苞米', 'both') THEN
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
-- 3. worker 领取：SKIP LOCKED + lease；过期 processing 可恢复，最多尝试 5 次
-- ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS momi_chat_jobs_lease_recovery_idx
  ON public.momi_chat_jobs (status, lease_until, next_retry_at, created_at)
  WHERE status IN ('pending', 'retryable', 'processing');

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
  IF btrim(COALESCE(p_worker_id, '')) = '' OR length(p_worker_id) > 200 THEN
    RAISE EXCEPTION 'MOMI_CHAT_INVALID_WORKER' USING ERRCODE = '22023';
  END IF;

  -- 第 5 次尝试时若 worker 再次崩溃，lease 到期后终止，不留下永久 processing。
  UPDATE public.momi_chat_jobs
  SET status = 'failed',
      lease_owner = NULL,
      lease_until = NULL,
      next_retry_at = NULL,
      last_error_code = 'LEASE_EXPIRED_MAX_ATTEMPTS',
      updated_at = now()
  WHERE status = 'processing'
    AND (lease_until IS NULL OR lease_until < now())
    AND attempt_count >= 5;

  SELECT * INTO v_job
  FROM public.momi_chat_jobs
  WHERE attempt_count < 5
    AND (
      (
        status IN ('pending', 'retryable')
        AND (next_retry_at IS NULL OR next_retry_at <= now())
        AND (lease_until IS NULL OR lease_until < now())
      )
      OR (
        status = 'processing'
        AND (lease_until IS NULL OR lease_until < now())
      )
    )
  ORDER BY CASE WHEN status = 'processing' THEN 0 ELSE 1 END,
           created_at ASC,
           id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.momi_chat_jobs
  SET status = 'processing',
      lease_owner = p_worker_id,
      lease_until = now() + make_interval(secs => LEAST(300, GREATEST(15, COALESCE(p_lease_seconds, 60)))),
      attempt_count = attempt_count + 1,
      next_retry_at = NULL,
      last_error_code = CASE
        WHEN v_job.status = 'processing' THEN 'LEASE_EXPIRED_RECLAIMED'
        ELSE last_error_code
      END,
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN NEXT v_job;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 4. 原子保存最终回复：严格 generation key + source/couple 防碰撞
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
  v_source_client_message_id text;
  v_expected_generation_key text;
BEGIN
  SELECT * INTO v_job
  FROM public.momi_chat_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_job.id IS NULL
     OR v_job.status <> 'processing'
     OR v_job.lease_owner IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'MOMI_CHAT_JOB_LEASE_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF v_job.couple_id IS DISTINCT FROM 'momo_and_baomi' THEN
    RAISE EXCEPTION 'MOMI_CHAT_JOB_COUPLE_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_content, '')) = '' OR btrim(COALESCE(p_generation_key, '')) = '' THEN
    RAISE EXCEPTION 'MOMI_CHAT_EMPTY_REPLY' USING ERRCODE = '22023';
  END IF;

  SELECT message.client_message_id INTO v_source_client_message_id
  FROM public.momi_assistant_messages AS message
  WHERE message.id = v_job.source_message_id
    AND message.couple_id = v_job.couple_id
    AND message.sender_type = 'user';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOMI_CHAT_SOURCE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_expected_generation_key := 'momi-chat:'
    || COALESCE(v_source_client_message_id, v_job.source_message_id::text);
  IF p_generation_key IS DISTINCT FROM v_expected_generation_key THEN
    RAISE EXCEPTION 'MOMI_CHAT_GENERATION_KEY_MISMATCH' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.momi_assistant_messages (
    couple_id, sender, sender_type, sender_user_id, content,
    reply_to_message_id, generation_key, status, trigger_source
  ) VALUES (
    v_job.couple_id, 'momi', 'assistant', NULL, left(btrim(p_content), 8000),
    v_job.source_message_id::text, p_generation_key, 'synced', 'assistant_worker'
  )
  ON CONFLICT (generation_key) WHERE generation_key IS NOT NULL DO NOTHING
  RETURNING * INTO v_reply;

  -- 客户端可能先完成模型调用；只吸收同 couple、同 source 的 assistant 回复。
  IF v_reply.id IS NULL THEN
    SELECT * INTO v_reply
    FROM public.momi_assistant_messages
    WHERE generation_key = p_generation_key
      AND couple_id = v_job.couple_id
      AND sender_type = 'assistant'
      AND reply_to_message_id = v_job.source_message_id::text;
  END IF;
  IF v_reply.id IS NULL THEN
    RAISE EXCEPTION 'MOMI_CHAT_GENERATION_COLLISION' USING ERRCODE = '23505';
  END IF;

  UPDATE public.momi_chat_jobs
  SET status = 'completed',
      lease_owner = NULL,
      lease_until = NULL,
      next_retry_at = NULL,
      last_error_code = NULL,
      updated_at = now()
  WHERE id = v_job.id;

  RETURN NEXT v_reply;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 5. worker 失败：最多 5 次，调用方退避秒数由数据库封顶 15 分钟
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
  SET status = CASE
        WHEN COALESCE(p_retryable, false) AND attempt_count < 5 THEN 'retryable'
        ELSE 'failed'
      END,
      lease_owner = NULL,
      lease_until = NULL,
      next_retry_at = CASE
        WHEN COALESCE(p_retryable, false) AND attempt_count < 5
          THEN now() + make_interval(secs => LEAST(900, GREATEST(5, COALESCE(p_retry_seconds, 30))))
        ELSE NULL
      END,
      last_error_code = left(COALESCE(NULLIF(p_error_code, ''), 'UNKNOWN'), 120),
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND lease_owner IS NOT DISTINCT FROM p_worker_id;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 6. 最小执行权限
-- ─────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.apply_verified_momi_memory(
  varchar, varchar, varchar, varchar, varchar, varchar, text, text, text, text[],
  numeric, int, varchar, varchar, text, varchar, text, timestamptz, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_verified_momi_memory(
  varchar, varchar, varchar, varchar, varchar, varchar, text, text, text, text[],
  numeric, int, varchar, varchar, text, varchar, text, timestamptz, timestamptz
) TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.forget_verified_momi_memories(
  varchar, varchar, varchar, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.forget_verified_momi_memories(
  varchar, varchar, varchar, text, text
) TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.claim_momi_chat_job(text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_momi_chat_job(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_momi_chat_job(uuid, text, text, boolean, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_momi_chat_job(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_momi_chat_job(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_momi_chat_job(uuid, text, text, boolean, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
