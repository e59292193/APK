-- ═══════════════════════════════════════════════════════
-- momi V2 corrective migration（在 momi_upgrade_schema.sql 后执行）
-- 修正首版迁移与客户端提醒 CRUD 的表名/字段对齐问题；全部语句可重复执行。
-- ═══════════════════════════════════════════════════════

-- 1) 旧 momi_memory.user_id 是 NOT NULL；V2 以 subject 为主。
--    解除旧约束，同时客户端过渡期仍双写 user_id + subject，兼容旧版本。
ALTER TABLE IF EXISTS public.momi_memory
  ALTER COLUMN user_id DROP NOT NULL;

-- 2) 自然语言提醒 CRUD 使用的单次任务表。
CREATE TABLE IF NOT EXISTS public.momi_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  created_by varchar NOT NULL,
  title text NOT NULL,
  due_at timestamptz NOT NULL,
  status varchar NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'done', 'cancelled')),
  notified_at timestamptz,
  source_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_momi_tasks_due
  ON public.momi_tasks (due_at ASC)
  WHERE status = 'active' AND notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_momi_tasks_couple
  ON public.momi_tasks (couple_id, status);

ALTER TABLE public.momi_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on momi_tasks" ON public.momi_tasks;
CREATE POLICY "Allow all on momi_tasks"
  ON public.momi_tasks FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- 3) 首版 momi_proactive_log 字段对齐前台调度器。
ALTER TABLE public.momi_proactive_log
  ADD COLUMN IF NOT EXISTS event_key varchar;
ALTER TABLE public.momi_proactive_log
  ADD COLUMN IF NOT EXISTS event_type varchar;
ALTER TABLE public.momi_proactive_log
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 兼容旧 NOT NULL dedupe_key：用 event_key 双写填充，并给新行默认值。
ALTER TABLE public.momi_proactive_log
  ALTER COLUMN dedupe_key DROP NOT NULL;
UPDATE public.momi_proactive_log
SET event_key = dedupe_key
WHERE event_key IS NULL AND dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS momi_proactive_log_event_key_dedupe
  ON public.momi_proactive_log (couple_id, event_key)
  WHERE event_key IS NOT NULL;

-- 4) 新表加入 Realtime（幂等）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'momi_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.momi_tasks;
  END IF;
END $$;

-- 刷新 PostgREST schema cache，减少迁移后短暂 PGRST204。
NOTIFY pgrst, 'reload schema';
