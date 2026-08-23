-- ═══════════════════════════════════════════════════════
-- 0005: 历史图片 URL → bucket 路径回填 + 定时清理
--
-- 前提：0004 已执行（bucket 已私有），两台手机已装新 APK。
--   新 APK 的 mediaResolver 兼容两种形态，此迁移把旧数据统一为路径。
--
-- 风险：仅改字符串前缀，不动行数。执行前请先备份涉及表。
-- 回滚：反向 replace（见文末）。
-- ═══════════════════════════════════════════════════════

-- 1. 各表图片列：公开 URL → bucket 内路径
UPDATE public.messages
SET metadata = jsonb_set(
        metadata,
        '{image_url}',
        to_jsonb(replace(metadata->>'image_url',
          'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/', '')))
WHERE metadata->>'image_url' LIKE 'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/%';

UPDATE public.time_capsules
SET photo_url = replace(photo_url,
  'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/', '')
WHERE photo_url LIKE 'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/%';

UPDATE public.wishes
SET image_url = replace(image_url,
  'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/', '')
WHERE image_url LIKE 'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/%';

UPDATE public.trips
SET cover_url = replace(cover_url,
  'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/', '')
WHERE cover_url LIKE 'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/%';

UPDATE public.trip_entries
SET photo_url = replace(photo_url,
  'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/', '')
WHERE photo_url LIKE 'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/%';

UPDATE public.drawguess_gallery
SET image_url = replace(image_url,
  'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/', '')
WHERE image_url LIKE 'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/%';

-- 打卡记录 media_urls 是 jsonb 数组，逐元素替换
UPDATE public.checkin_records
SET media_urls = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN elem LIKE 'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/%'
         THEN replace(elem, 'https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/', '')
         ELSE elem END), '[]'::jsonb)
  FROM jsonb_array_elements_text(media_urls) AS elem
)
WHERE media_urls::text LIKE '%https://kotakqdxwvienrmbcrnk.supabase.co/storage/v1/object/public/photos/%';

-- 2. 定时清理（可选；需要项目启用 pg_cron 扩展）
--    - 已消费/过期的小纸条与语音保留 1 天后删除
--    - 你画我猜信号队列按周清理（当前已积累 4700+ 行）
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'cleanup-ephemeral-daily',
  '17 4 * * *',
  $$ SELECT public.cleanup_old_ephemeral('1 day') $$
);

SELECT cron.schedule(
  'cleanup-drawguess-signals-weekly',
  '23 4 * * 0',
  $$ DELETE FROM public.drawguess_signals WHERE created_at < now() - interval '7 days' $$
);

-- 验证：
--   select count(*) from public.drawguess_signals;   -- 一周后应明显下降
--   select cron.job_run_details order by start_time desc limit 5;
--
-- 回滚：
--   select cron.unschedule('cleanup-ephemeral-daily');
--   select cron.unschedule('cleanup-drawguess-signals-weekly');
--   路径反向替换（把 '' 前缀还原为完整 URL）仅当确实需要回退到公开 URL 时执行。
