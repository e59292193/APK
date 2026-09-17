-- momi V2 corrective migration
-- 必须在 momi_upgrade_schema.sql 后执行；全部语句可重复执行。

-- 1) 旧 momi_memory.user_id 是 NOT NULL；V2 以 subject 为主。
ALTER TABLE IF EXISTS public.momi_memory
  ALTER COLUMN user_id DROP NOT NULL;

-- 2) 自然语言提醒 CRUD 使用的单次任务表。
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
ALTER TABLE public.momi_proactive_log ADD COLUMN IF NOT EXISTS event_key varchar;
ALTER TABLE public.momi_proactive_log ADD COLUMN IF NOT EXISTS event_type varchar;
ALTER TABLE public.momi_proactive_log ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.momi_proactive_log ALTER COLUMN dedupe_key DROP NOT NULL;
UPDATE public.momi_proactive_log SET event_key = dedupe_key
WHERE event_key IS NULL AND dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS momi_proactive_log_event_key_dedupe
  ON public.momi_proactive_log (couple_id, event_key)
  WHERE event_key IS NOT NULL;

-- 4) 名字唤醒插话的数据库级幂等保障。
-- 客户端在发送端先查后写，但两台设备并发时仍可能同时通过查询；
-- 唯一索引与客户端 23505 处理共同保证同一触发消息最多一条插话。
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY couple_id, trigger_message_id
           ORDER BY created_at ASC, id ASC
         ) AS row_num
  FROM public.momi_chat_interjections
  WHERE trigger_message_id IS NOT NULL
)
DELETE FROM public.momi_chat_interjections target
USING ranked
WHERE target.id = ranked.id AND ranked.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS momi_chat_interjections_trigger_dedupe
  ON public.momi_chat_interjections (couple_id, trigger_message_id)
  WHERE trigger_message_id IS NOT NULL;

-- 5) 新任务表加入 Realtime（幂等）。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'momi_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.momi_tasks;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
