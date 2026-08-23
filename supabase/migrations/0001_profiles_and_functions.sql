-- ═══════════════════════════════════════════════════════
-- 0001: profiles 身份映射表 + 辅助函数
--
-- 目的：把 Supabase Auth 的 uuid 身份与 App 内昵称（momo / 苞米）绑定，
--       供 0002 的 RLS 策略与 UserSig Edge Function 使用。
--
-- 执行时机：第一步执行（先于收紧 RLS）。
-- 幂等：可重复执行。
--
-- 风险：低。只新增对象，不改现有数据。
-- 回滚：见文件末尾注释。
-- ═══════════════════════════════════════════════════════

-- 1. profiles 表：App 昵称 ↔ auth.users 映射 ────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  username  text PRIMARY KEY
    CHECK (username IN ('momo', '苞米')),
  auth_uid  uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- profiles 本体策略：登录用户可读（客户端与 Edge Function 需要），
-- 写入只允许触发器（SECURITY DEFINER）与服务端。
DROP POLICY IF EXISTS "profiles select member" ON public.profiles;
CREATE POLICY "profiles select member" ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

-- 2. 新 auth 用户注册时自动建 profile ──────────────────
--    username 取值顺序：metadata.app_username → 邮箱本地部分（momo/baomi）。
--    无法映射的用户也会建档（username 占位），但 current_app_user() 不会认它。
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
BEGIN
  v_username := nullif(trim(new.raw_user_meta_data->>'app_username'), '');

  IF v_username NOT IN ('momo', '苞米') THEN
    v_username := nullif(lower(split_part(new.email, '@', 1)), '');
    IF v_username = 'baomi' THEN
      v_username := '苞米';
    END IF;
  END IF;

  IF v_username IS NULL OR v_username NOT IN ('momo', '苞米') THEN
    v_username := 'guest_' || left(new.id::text, 8);
  END IF;

  INSERT INTO public.profiles (username, auth_uid, email)
  VALUES (v_username, new.id, new.email)
  ON CONFLICT DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 3. 回填：为已存在的 auth 用户补 profile（首次执行时通常为空）
INSERT INTO public.profiles (username, auth_uid, email)
SELECT
  COALESCE(
    CASE
      WHEN trim(u.raw_user_meta_data->>'app_username') IN ('momo', '苞米')
        THEN trim(u.raw_user_meta_data->>'app_username')
      WHEN lower(split_part(u.email, '@', 1)) = 'momo' THEN 'momo'
      WHEN lower(split_part(u.email, '@', 1)) = 'baomi' THEN '苞米'
      ELSE 'guest_' || left(u.id::text, 8)
    END,
    'guest_' || left(u.id::text, 8)
  ),
  u.id,
  u.email
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.auth_uid = u.id)
ON CONFLICT DO NOTHING;

-- 4. 身份辅助函数（RLS 策略与 RPC 共用）────────────────
-- current_app_user()：当前认证会话对应的 App 昵称；未映射返回 NULL。
CREATE OR REPLACE FUNCTION public.current_app_user()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.username FROM public.profiles p
  WHERE p.auth_uid = auth.uid()
    AND p.username IN ('momo', '苞米')
  LIMIT 1
$$;

-- is_app_member()：是否为两名成员之一。
CREATE OR REPLACE FUNCTION public.is_app_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_app_user() IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.current_app_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_app_user() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_app_user() TO authenticated;

REVOKE ALL ON FUNCTION public.is_app_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_app_member() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_app_member() TO authenticated;

GRANT EXECUTE ON FUNCTION public.cleanup_old_ephemeral(interval) TO authenticated;

-- 验证：
--   select * from public.profiles;                      -- 应看到 momo/苞米 两行
--   select public.current_app_user();                   -- 匿名 SQL Editor 中为 NULL（正常）
--
-- 回滚：
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists public.handle_new_auth_user();
--   drop function if exists public.current_app_user();
--   drop function if exists public.is_app_member();
--   drop table if exists public.profiles;
