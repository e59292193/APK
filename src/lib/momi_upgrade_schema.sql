-- ═══════════════════════════════════════════════════════
-- momi v2 升级数据库迁移脚本 (momi_upgrade_schema.sql)
-- 提示词4 · 第5章：本次迭代所有数据库变更集中管理
-- ═══════════════════════════════════════════════════════
--
-- 【执行方式】
--   Supabase Dashboard → SQL Editor → New query → 粘贴本文件全部内容 → Run
--   项目 ref：kotakqdxwvienrmbcrnk
--
-- 【执行顺序】
--   本文件自包含，按文件内顺序从上到下执行即可；全部语句幂等
--   （IF NOT EXISTS / DO 块判断 / ON CONFLICT），可反复执行无副作用。
--
-- 【包含变更】
--   1. momi_assistant_messages 字段扩展（识图 + 主动消息）
--   2. momi_memory 记忆库结构升级 + 存量去重 + 唯一索引
--   3. kitchen_dishes 分类 CHECK 约束加入 'drink'（动态查旧约束名）
--   4. 新表：momi_state / momi_scheduled_tasks / momi_proactive_log
--            / momi_chat_interjections / momi_data_digest
--   5. 全部新表 RLS 宽松策略（沿用现有安全模型）
--   6. Realtime publication（幂等判断，不重复添加）
--   7. Storage bucket：momi-chat（momi 聊天图片，公开读）
-- ═══════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────
-- 1. momi_assistant_messages 字段扩展
-- ─────────────────────────────────────────────────────
ALTER TABLE public.momi_assistant_messages
  ADD COLUMN IF NOT EXISTS image_urls text[];
ALTER TABLE public.momi_assistant_messages
  ADD COLUMN IF NOT EXISTS image_paths text[];
ALTER TABLE public.momi_assistant_messages
  ADD COLUMN IF NOT EXISTS content_type varchar(20) DEFAULT 'text'; -- 'text' | 'image' | 'mixed'
ALTER TABLE public.momi_assistant_messages
  ADD COLUMN IF NOT EXISTS is_proactive boolean DEFAULT false;
ALTER TABLE public.momi_assistant_messages
  ADD COLUMN IF NOT EXISTS trigger_source varchar(20); -- 'assistant' | 'chat_mention' | 'proactive' | 'scheduled'


-- ─────────────────────────────────────────────────────
-- 2. momi_memory 记忆库结构升级
-- ─────────────────────────────────────────────────────
ALTER TABLE public.momi_memory
  ADD COLUMN IF NOT EXISTS subject varchar(20);          -- 'momo' | '苞米' | 'both' | 'momi'
ALTER TABLE public.momi_memory
  ADD COLUMN IF NOT EXISTS keywords text[];              -- 检索关键词，写入时由 AI 抽取
ALTER TABLE public.momi_memory
  ADD COLUMN IF NOT EXISTS importance int DEFAULT 3;     -- 1-5，5 = 用户明确要求记住 / momi 人格核心
ALTER TABLE public.momi_memory
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2) DEFAULT 0.60; -- 0.00-1.00
ALTER TABLE public.momi_memory
  ADD COLUMN IF NOT EXISTS source varchar(20) DEFAULT 'ai_extracted'; -- 'user_explicit' | 'ai_extracted' | 'db_sync' | 'seed'
ALTER TABLE public.momi_memory
  ADD COLUMN IF NOT EXISTS source_ref text;              -- 来源消息 id 或表名
ALTER TABLE public.momi_memory
  ADD COLUMN IF NOT EXISTS hit_count int DEFAULT 0;
ALTER TABLE public.momi_memory
  ADD COLUMN IF NOT EXISTS last_hit_at timestamptz;
ALTER TABLE public.momi_memory
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;       -- 可空；ongoing 类短期记忆 7-30 天
ALTER TABLE public.momi_memory
  ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;
ALTER TABLE public.momi_memory
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- 存量数据迁移：旧 user_id 列 -> 新 subject 列（保留 user_id 不动，双写兼容旧代码）
UPDATE public.momi_memory
SET subject = user_id
WHERE subject IS NULL;

-- 【必须】建唯一索引前先清理存量重复数据：归档而非删除，保留成长轨迹
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY couple_id, subject, memory_type, md5(content)
           ORDER BY updated_at DESC
         ) AS rn
  FROM public.momi_memory
  WHERE is_archived = false
)
UPDATE public.momi_memory m
SET is_archived = true
FROM ranked r
WHERE m.id = r.id AND r.rn > 1;

-- 唯一索引：彻底终结同一条记忆被反复插入的无限膨胀问题
CREATE UNIQUE INDEX IF NOT EXISTS momi_memory_dedupe
  ON public.momi_memory (couple_id, subject, memory_type, md5(content))
  WHERE is_archived = false;

-- 检索索引：按重要度 / 命中时间排序取 top N
CREATE INDEX IF NOT EXISTS momi_memory_retrieval
  ON public.momi_memory (couple_id, is_archived, importance DESC, last_hit_at DESC);


-- ─────────────────────────────────────────────────────
-- 3. kitchen_dishes 分类约束：加入 'drink'
--    动态查找旧约束名再删除，避免写死约束名导致迁移无声失败
-- ─────────────────────────────────────────────────────
DO $$
DECLARE con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.kitchen_dishes'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%category%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.kitchen_dishes DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.kitchen_dishes
  ADD CONSTRAINT kitchen_dishes_category_check
  CHECK (category IN ('meat', 'vegetable', 'snack', 'drink'));


-- ─────────────────────────────────────────────────────
-- 4. 新表
-- ─────────────────────────────────────────────────────

-- 4.1 momi 情绪 / 好感度 / 养成状态（单行，couple_id 主键）
CREATE TABLE IF NOT EXISTS public.momi_state (
  couple_id varchar PRIMARY KEY DEFAULT 'momo_and_baomi',
  mood varchar DEFAULT 'calm',           -- 'happy'|'calm'|'excited'|'sleepy'|'sad'|'annoyed'|'angry'|'worried'
  mood_intensity int DEFAULT 50,         -- 0-100
  energy int DEFAULT 80,                 -- 0-100，影响回复长度与活跃度
  affection_momo int DEFAULT 50,         -- 0-100 对 momo 的好感度
  affection_baomi int DEFAULT 50,        -- 0-100 对 苞米 的好感度
  anger_level int DEFAULT 0,             -- 0-100
  growth_level int DEFAULT 1,            -- 养成等级
  growth_exp int DEFAULT 0,              -- 经验值
  last_interaction_at timestamptz,
  last_proactive_at timestamptz,
  proactive_count_today int DEFAULT 0,   -- 今日主动消息计数（频率上限用）
  proactive_date date,                   -- 计数所属日期，跳天重置
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4.2 定时与条件任务表（momi 主动发消息的调度核心）
CREATE TABLE IF NOT EXISTS public.momi_scheduled_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  created_by varchar NOT NULL,           -- 'momo' | '苞米' | 'momi'
  task_type varchar NOT NULL,            -- 'once' | 'daily' | 'weekly' | 'interval' | 'condition'
  trigger_at timestamptz,                -- once 类型的绝对时间
  trigger_time time,                     -- daily/weekly 的时间点
  trigger_weekday int,                   -- weekly 的星期（0-6）
  interval_minutes int,                  -- interval 类型
  condition_kind varchar,                -- 'silence' | 'weather_rain' | 'weather_cold' | 'weather_hot' | 'anniversary_near' | 'no_checkin_today' | 'custom'
  condition_params jsonb,
  message_template text,                 -- 预约本地通知文案 + AI 生成失败时的兼容文案
  ai_prompt text,                        -- 给 momi 的生成指令
  target_user varchar DEFAULT 'both',    -- 'momo' | '苞米' | 'both'
  enabled boolean DEFAULT true,
  last_fired_at timestamptz,
  next_fire_at timestamptz,              -- 建索引，调度器只查这一列
  local_notification_id text,            -- expo-notifications 返回的 id，用于取消
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_momi_scheduled_tasks_next_fire
  ON public.momi_scheduled_tasks (next_fire_at)
  WHERE enabled = true;

-- 4.3 主动消息去重日志（防双用户双端同时触发重复发消息）
CREATE TABLE IF NOT EXISTS public.momi_proactive_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  task_id uuid,
  fired_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key varchar NOT NULL            -- task_id + '_' + 触发时间取到分钟
);

CREATE UNIQUE INDEX IF NOT EXISTS momi_proactive_log_dedupe
  ON public.momi_proactive_log (dedupe_key);

-- 4.4 情侣聊天里的 momi 插话（提到 momi 名字时）
CREATE TABLE IF NOT EXISTS public.momi_chat_interjections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  trigger_message_id varchar,            -- 触发插话的 TIM 消息 id
  trigger_user varchar NOT NULL,         -- 谁在聊天里提到了 momi
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_momi_chat_interjections_lookup
  ON public.momi_chat_interjections (couple_id, created_at ASC);

-- 4.5 各模块预聚合摘要（momi 对全局的「常识」，避免每次全表遍历）
CREATE TABLE IF NOT EXISTS public.momi_data_digest (
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  digest_key varchar NOT NULL,           -- 'checkin' | 'kitchen' | 'anniversary' | 'wishlist' | 'games' | 'photos' | 'capsules'
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, digest_key)
);


-- ─────────────────────────────────────────────────────
-- 5. RLS 行级安全（沿用现有安全模型：固定两人封闭使用，宽松策略）
-- ─────────────────────────────────────────────────────
ALTER TABLE public.momi_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.momi_scheduled_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.momi_proactive_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.momi_chat_interjections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.momi_data_digest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on momi_state" ON public.momi_state;
CREATE POLICY "Allow all on momi_state"
  ON public.momi_state FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on momi_scheduled_tasks" ON public.momi_scheduled_tasks;
CREATE POLICY "Allow all on momi_scheduled_tasks"
  ON public.momi_scheduled_tasks FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on momi_proactive_log" ON public.momi_proactive_log;
CREATE POLICY "Allow all on momi_proactive_log"
  ON public.momi_proactive_log FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on momi_chat_interjections" ON public.momi_chat_interjections;
CREATE POLICY "Allow all on momi_chat_interjections"
  ON public.momi_chat_interjections FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on momi_data_digest" ON public.momi_data_digest;
CREATE POLICY "Allow all on momi_data_digest"
  ON public.momi_data_digest FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);


-- ─────────────────────────────────────────────────────
-- 6. Realtime 实时发布（幂等：先查 pg_publication_tables 再加，绝不重复添加）
--    注意：momi_assistant_messages 已在 publication 中，此处仅为防御性确认
-- ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'momi_chat_interjections'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.momi_chat_interjections;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'momi_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.momi_state;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'momi_scheduled_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.momi_scheduled_tasks;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'momi_assistant_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.momi_assistant_messages;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────
-- 7. Storage Bucket：momi-chat（momi 聊天图片，公开读，双人可见）
--    图片必须先上传再存库，不得只存本地 URI —— 否则另一用户看到破图
-- ─────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('momi-chat', 'momi-chat', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Allow all on momi-chat" ON storage.objects;
CREATE POLICY "Allow all on momi-chat"
  ON storage.objects FOR ALL TO anon, authenticated
  USING (bucket_id = 'momi-chat')
  WITH CHECK (bucket_id = 'momi-chat');


-- ═══════════════════════════════════════════════════════
-- ✅ 迁移完成检查清单
--   □ momi_assistant_messages 出现 image_urls 等 5 个新列
--   □ momi_memory 出现 subject 等新列，momi_memory_dedupe 唯一索引存在
--   □ kitchen_dishes 可插入 category='drink' 的菜品
--   □ 5 张新表均存在且可查
--   □ Storage 中出现 momi-chat 公开 bucket
-- ═══════════════════════════════════════════════════════
