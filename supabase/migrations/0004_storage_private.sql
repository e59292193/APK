-- ═══════════════════════════════════════════════════════
-- 0004: Storage 私有化
--
-- 变更：
--   1. photos bucket 改为私有（公开 URL 全部失效，只能走 signed URL）。
--   2. storage.objects 按“成员”授权（依赖 0001 的 is_app_member()）。
--
-- ⚠️ 执行时机：与 0002 同批（两台手机均已装新 APK 后）。
--   执行后旧公开 URL 全部失效；新 APK 通过 mediaResolver 换取 signed URL。
--
-- 幂等：可重复执行。
-- ═══════════════════════════════════════════════════════

-- 1. photos → 私有 bucket
UPDATE storage.buckets
SET public = false
WHERE id = 'photos';

-- ephemeral-voice 确认为私有（若不存在则忽略）
UPDATE storage.buckets
SET public = false
WHERE id = 'ephemeral-voice';

-- 2. 对象策略：成员可读写两个私密 bucket
DROP POLICY IF EXISTS "photos member select" ON storage.objects;
CREATE POLICY "photos member select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'photos' AND public.is_app_member());

DROP POLICY IF EXISTS "photos member insert" ON storage.objects;
CREATE POLICY "photos member insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos' AND public.is_app_member());

DROP POLICY IF EXISTS "photos member update" ON storage.objects;
CREATE POLICY "photos member update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'photos' AND public.is_app_member())
  WITH CHECK (bucket_id = 'photos' AND public.is_app_member());

DROP POLICY IF EXISTS "photos member delete" ON storage.objects;
CREATE POLICY "photos member delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'photos' AND public.is_app_member());

DROP POLICY IF EXISTS "ephemeral-voice member all" ON storage.objects;
CREATE POLICY "ephemeral-voice member all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'ephemeral-voice' AND public.is_app_member())
  WITH CHECK (bucket_id = 'ephemeral-voice' AND public.is_app_member());

-- 验证：
--   1) 匿名列目录应被拒绝：
--      curl -X POST '<url>/storage/v1/object/list/photos' -H "apikey: <anon>" -d '{"prefix":""}' → 4xx/空
--   2) 旧公开 URL 应返回 400/403：
--      curl -I '<url>/storage/v1/object/public/photos/uploads/xxx.jpg'
--
-- 回滚：
--   update storage.buckets set public = true where id = 'photos';
--   drop policy ... （恢复匿名访问 = 回到不安全状态，仅应急使用）
