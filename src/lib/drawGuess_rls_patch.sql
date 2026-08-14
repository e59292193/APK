-- 你画我猜：自定义词库 RLS 修复补丁
--
-- 背景：应用使用 Supabase anon key + 自定义昵称（momo / 苞米），没有 Supabase Auth 会话。
-- 原策略使用 auth.uid() = user_id：auth.uid() 始终为 NULL，且 uuid 与 varchar 类型也不匹配，
-- 因而所有自定义词的查询、添加和删除都会被 RLS 拒绝。
--
-- 请在 Supabase SQL Editor 中执行一次。脚本可重复执行。
-- 数据隔离由客户端始终按 user_id 过滤；这是当前双人私密应用的既有信任模型。

BEGIN;

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

CREATE POLICY "Allow all on drawguess_custom_words"
  ON public.drawguess_custom_words
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 为高频的“读取自己的词库”补索引。
CREATE INDEX IF NOT EXISTS idx_drawguess_custom_words_user_created
  ON public.drawguess_custom_words (user_id, created_at DESC);

-- 信号只承担短期可靠投递；删除一天前的数据，避免表无限增长拖慢轮询。
DELETE FROM public.drawguess_signals
WHERE created_at < now() - interval '1 day';

COMMIT;
