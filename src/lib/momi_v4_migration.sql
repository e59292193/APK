-- ═══════════════════════════════════════════════════════
-- momi V4 迁移脚本 (momi_v4_migration.sql)
-- 内容：momi_tasks 周期任务与自定义任务支持（聊天内发布任务的前提）
-- 执行顺序：momi_upgrade_schema.sql → momi_v2_corrective_migration.sql
--           → momi_v3_migration.sql → 本文件
-- 执行方式：Supabase Dashboard → SQL Editor → 粘贴执行
-- 全部语句幂等，可安全重复执行。
-- ═══════════════════════════════════════════════════════

-- 1) 兜底建表（若此前 V3 迁移未执行，任务功能直接可用）
CREATE TABLE IF NOT EXISTS public.momi_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  created_by varchar NOT NULL,
  title text NOT NULL,
  due_at timestamptz NOT NULL,
  status varchar NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'cancelled')),
  notified_at timestamptz,
  source_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) 新增列：重复规则 + 自定义执行指令
--    recurrence: none(一次性) | daily(每天) | weekday(每个工作日) | weekly(每周，星期几取 due_at 的星期)
--    ai_prompt:  到点时由 momi 实时生成内容的指令（如“给我发一句英语并附上翻译”）
ALTER TABLE public.momi_tasks ADD COLUMN IF NOT EXISTS recurrence varchar(16) NOT NULL DEFAULT 'none';
ALTER TABLE public.momi_tasks ADD COLUMN IF NOT EXISTS ai_prompt text;

-- 3) 调度器取数索引（只索引待触发的任务）
CREATE INDEX IF NOT EXISTS momi_tasks_due_idx
  ON public.momi_tasks (couple_id, due_at)
  WHERE status = 'active' AND notified_at IS NULL;

-- 4) RLS（与现有一致的双人开放模型）
ALTER TABLE public.momi_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on momi_tasks" ON public.momi_tasks;
CREATE POLICY "Allow all on momi_tasks"
  ON public.momi_tasks FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
