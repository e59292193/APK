-- ═══════════════════════════════════════════════════════
-- 0003: 小纸条 / 语音 RPC 加固
--
-- 变更：
--   1. 全部改为 SECURITY DEFINER + 固定 search_path（防搜索路径劫持）。
--   2. 领取（claim）强制校验 p_receiver 必须等于当前认证身份，
--      不能再替他人领取；消费/释放校验领取者身份。
--   3. 撤销 anon 执行权限（仅 authenticated 可调用）。
--
-- 兼容性：RPC 签名（参数与返回）与旧版完全一致，客户端无需变更。
-- 幂等：可重复执行。
-- ═══════════════════════════════════════════════════════

-- ─── claim_ephemeral_note ─────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_ephemeral_note(p_receiver text, p_client_id text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  sender_id varchar,
  content text,
  paper_style varchar,
  claim_token uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_token uuid;
  v_row record;
  v_caller text := public.current_app_user();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized: 需要成员登录后领取' USING ERRCODE = '42501';
  END IF;
  IF p_receiver IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'forbidden: 只能领取发给自己的纸条' USING ERRCODE = '42501';
  END IF;

  -- 幂等恢复：该客户端请求此前已 claim 成功（如网络超时后重试），直接返回那张纸条
  IF p_client_id IS NOT NULL THEN
    SELECT e.* INTO v_row
    FROM public.ephemeral_notes e
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
  FROM public.ephemeral_notes e
  WHERE e.receiver_id = p_receiver
    AND e.status = 'pending'
  ORDER BY random()
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  v_token := gen_random_uuid();
  UPDATE public.ephemeral_notes
  SET status = 'claimed', claimed_at = now(), claim_token = v_token,
      claim_request_id = p_client_id
  WHERE public.ephemeral_notes.id = v_id
  RETURNING * INTO v_row;

  RETURN QUERY
    SELECT v_row.id, v_row.sender_id, v_row.content, v_row.paper_style,
           v_row.claim_token, v_row.created_at;
END;
$$;

-- ─── consume_ephemeral_note ───────────────────────────
CREATE OR REPLACE FUNCTION public.consume_ephemeral_note(p_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found uuid;
BEGIN
  IF public.current_app_user() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.ephemeral_notes n
  WHERE n.id = p_id
    AND n.claim_token = p_claim_token
    AND n.receiver_id = public.current_app_user()
  RETURNING n.id INTO v_found;
  RETURN v_found IS NOT NULL;
END;
$$;

-- ─── claim_ephemeral_voice ────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_ephemeral_voice(p_receiver text, p_client_id text DEFAULT NULL)
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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_token uuid;
  v_row record;
  v_caller text := public.current_app_user();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized: 需要成员登录后领取' USING ERRCODE = '42501';
  END IF;
  IF p_receiver IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'forbidden: 只能领取发给自己的语音' USING ERRCODE = '42501';
  END IF;

  IF p_client_id IS NOT NULL THEN
    SELECT e.* INTO v_row
    FROM public.ephemeral_voice_messages e
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
  FROM public.ephemeral_voice_messages e
  WHERE e.receiver_id = p_receiver
    AND e.status = 'pending'
  ORDER BY random()
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  v_token := gen_random_uuid();
  UPDATE public.ephemeral_voice_messages
  SET status = 'claimed', claimed_at = now(), claim_token = v_token,
      claim_request_id = p_client_id
  WHERE public.ephemeral_voice_messages.id = v_id
  RETURNING * INTO v_row;

  RETURN QUERY
    SELECT v_row.id, v_row.sender_id, v_row.storage_path, v_row.duration_ms,
           v_row.waveform, v_row.mime_type, v_row.file_size,
           v_row.claim_token, v_row.created_at;
END;
$$;

-- ─── consume_ephemeral_voice ──────────────────────────
CREATE OR REPLACE FUNCTION public.consume_ephemeral_voice(p_id uuid, p_claim_token uuid)
RETURNS TABLE (ok boolean, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF public.current_app_user() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ephemeral_voice_messages
  SET status = 'consumed', consumed_at = now()
  WHERE id = p_id
    AND claim_token = p_claim_token
    AND receiver_id = public.current_app_user()
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RETURN QUERY SELECT false, NULL::text;
  ELSE
    RETURN QUERY SELECT true, v_row.storage_path;
  END IF;
END;
$$;

-- ─── release_ephemeral_voice_claim ────────────────────
CREATE OR REPLACE FUNCTION public.release_ephemeral_voice_claim(p_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found uuid;
BEGIN
  IF public.current_app_user() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ephemeral_voice_messages
  SET status = 'pending', claim_token = NULL, claimed_at = NULL, claim_request_id = NULL
  WHERE id = p_id
    AND claim_token = p_claim_token
    AND status = 'claimed'
    AND receiver_id = public.current_app_user()
  RETURNING id INTO v_found;
  RETURN v_found IS NOT NULL;
END;
$$;

-- ─── cleanup_old_ephemeral：仅删除已消费/过期行，保留给
--     pg_cron（postgres）与成员调用，不加身份断言 ──────
CREATE OR REPLACE FUNCTION public.cleanup_old_ephemeral(p_age interval DEFAULT '1 day')
RETURNS TABLE (notes_deleted integer, voice_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notes integer := 0;
  v_voice integer := 0;
BEGIN

  DELETE FROM public.ephemeral_notes
  WHERE (status = 'consumed' AND consumed_at < now() - p_age)
     OR (expires_at IS NOT NULL AND expires_at < now());
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM public.ephemeral_voice_messages
  WHERE (status = 'consumed' AND consumed_at < now() - p_age)
     OR (expires_at IS NOT NULL AND expires_at < now());
  GET DIAGNOSTICS v_voice = ROW_COUNT;

  RETURN QUERY SELECT v_notes, v_voice;
END;
$$;

-- ─── 权限收紧：仅 authenticated 可调用 ────────────────
REVOKE ALL ON FUNCTION public.claim_ephemeral_note(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_ephemeral_note(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ephemeral_note(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.consume_ephemeral_note(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ephemeral_note(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_ephemeral_voice(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_ephemeral_voice(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ephemeral_voice(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.consume_ephemeral_voice(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ephemeral_voice(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.release_ephemeral_voice_claim(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_ephemeral_voice_claim(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.cleanup_old_ephemeral(interval) FROM PUBLIC, anon;

-- 验证：
--   匿名调用应报权限错误：
--     curl -X POST '<url>/rest/v1/rpc/claim_ephemeral_note' -H "apikey: <anon>" -d '{"p_receiver":"momo"}'
--   → 应返回 42501 / permission denied。
--
-- 回滚：将对应函数改回 SECURITY INVOKER 版本（src/lib/ephemeral_schema.sql 内有旧定义）。
