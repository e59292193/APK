-- ═══════════════════════════════════════════════════════
-- momi V3 补齐迁移脚本 (momi_v3_migration.sql)
-- 必须在 momi_upgrade_schema.sql 与 momi_v2_corrective_migration.sql 后执行；
-- 全部语句幂等，可安全重复执行。
-- ═══════════════════════════════════════════════════════

-- 1) 每日聊天与互动滚动摘要表 (momi_daily_summary)
CREATE TABLE IF NOT EXISTS public.momi_daily_summary (
  couple_id text NOT NULL DEFAULT 'momo_and_baomi',
  day date NOT NULL,
  summary text NOT NULL DEFAULT '',
  message_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, day)
);

ALTER TABLE public.momi_daily_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on momi_daily_summary" ON public.momi_daily_summary;
CREATE POLICY "Allow all on momi_daily_summary"
  ON public.momi_daily_summary FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- 2) momi_proactive_log 补齐与唯一索引强化
CREATE TABLE IF NOT EXISTS public.momi_proactive_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  event_key varchar,
  event_type varchar,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.momi_proactive_log ADD COLUMN IF NOT EXISTS event_key varchar;
ALTER TABLE public.momi_proactive_log ADD COLUMN IF NOT EXISTS event_type varchar;
ALTER TABLE public.momi_proactive_log ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.momi_proactive_log ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS momi_proactive_log_couple_event_key_idx
  ON public.momi_proactive_log (couple_id, event_key)
  WHERE event_key IS NOT NULL;

ALTER TABLE public.momi_proactive_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on momi_proactive_log" ON public.momi_proactive_log;
CREATE POLICY "Allow all on momi_proactive_log"
  ON public.momi_proactive_log FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- 3) 统一任务表命名（代码统一使用 momi_tasks）
-- 确保 momi_tasks 存在；若此前建过 momi_scheduled_tasks，建兼容视图互通
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

DO $$
BEGIN
  -- 若有旧表 momi_scheduled_tasks 且无 momi_tasks，同步数据
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'momi_scheduled_tasks') THEN
    INSERT INTO public.momi_tasks (id, couple_id, created_by, title, due_at, status, notified_at, source_message_id, created_at, updated_at)
    SELECT id, couple_id, COALESCE(created_by, 'momo'), title, due_at, status, notified_at, source_message_id, created_at, updated_at
    FROM public.momi_scheduled_tasks
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

ALTER TABLE public.momi_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on momi_tasks" ON public.momi_tasks;
CREATE POLICY "Allow all on momi_tasks"
  ON public.momi_tasks FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- 4) 校验 momi_assistant_messages 字段
ALTER TABLE public.momi_assistant_messages
  ADD COLUMN IF NOT EXISTS is_proactive boolean DEFAULT false;
ALTER TABLE public.momi_assistant_messages
  ADD COLUMN IF NOT EXISTS trigger_source varchar(30);

-- 5) Realtime 订阅发布补充
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'momi_daily_summary'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.momi_daily_summary;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
