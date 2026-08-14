-- 你画我猜：已有数据库 v2 补丁
-- Supabase SQL Editor 中执行一次；脚本可重复执行。
--
-- 修复内容：
--   1. 补 deadline_at，双方倒计时与提示加时使用同一数据库时间；
--   2. 修复 anon 会话下私房词库全部被 RLS 拒绝的问题；
--   3. 清理历史重复画作并建立 (game_id, round) 唯一索引；
--   4. 清理一天前的可靠信号，避免轮询表无限增长。

BEGIN;

ALTER TABLE public.drawguess_games
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz;

ALTER TABLE public.drawguess_custom_words ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on drawguess_custom_words"
  ON public.drawguess_custom_words;
DROP POLICY IF EXISTS "drawguess_custom_words_select"
  ON public.drawguess_custom_words;
DROP POLICY IF EXISTS "drawguess_custom_words_insert"
  ON public.drawguess_custom_words;
DROP POLICY IF EXISTS "drawguess_custom_words_update"
  ON public.drawguess_custom_words;
DROP POLICY IF EXISTS "drawguess_custom_words_delete"
  ON public.drawguess_custom_words;

-- 应用使用 anon key + 应用内昵称，并没有 Supabase Auth 会话。
-- auth.uid() 在这里恒为 NULL，且不能与 varchar user_id 比较。
CREATE POLICY "Allow all on drawguess_custom_words"
  ON public.drawguess_custom_words
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_drawguess_custom_words_user_created
  ON public.drawguess_custom_words (user_id, created_at DESC);

-- 双方曾可能同时保存同一轮。保留最早一条，再由唯一索引从数据库层防重。
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY game_id, round
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_rank
  FROM public.drawguess_gallery
  WHERE round IS NOT NULL
)
DELETE FROM public.drawguess_gallery AS gallery
USING ranked
WHERE gallery.id = ranked.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_drawguess_gallery_game_round
  ON public.drawguess_gallery (game_id, round)
  WHERE round IS NOT NULL;

DELETE FROM public.drawguess_signals
WHERE created_at < now() - interval '1 day';

COMMIT;
