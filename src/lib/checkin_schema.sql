-- ═══════════════════════════════════════════════════════
-- momo和苞米的小世界 - 完整数据库初始化 (All Tables)
-- 适用：全新空项目，或需要补全缺失表的项目
-- 执行方式：Supabase Dashboard → SQL Editor → New query → 粘贴 → Run
-- 注意：所有语句均带 IF NOT EXISTS，可重复执行
-- ═══════════════════════════════════════════════════════

-- 0. 主聊天消息表 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  content text DEFAULT '',
  type varchar NOT NULL DEFAULT 'text',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1. 打卡主题表 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkin_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id varchar NOT NULL,
  partner_id varchar NOT NULL,
  title varchar(10) NOT NULL,
  icon varchar DEFAULT '✨',
  cover_url varchar,
  status varchar NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. 打卡记录表 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkin_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id uuid NOT NULL REFERENCES checkin_themes(id) ON DELETE CASCADE,
  user_id varchar NOT NULL,
  content text DEFAULT '',
  media_urls jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. 时光胶囊表 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_capsules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id varchar NOT NULL,
  content text NOT NULL DEFAULT '',
  unlock_time timestamptz NOT NULL,
  is_opened boolean NOT NULL DEFAULT false,
  is_read boolean NOT NULL DEFAULT false,
  photo_url varchar,
  weather varchar,
  mood varchar,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. 愿望清单表 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id varchar NOT NULL,
  title varchar(30) NOT NULL,
  image_url varchar,
  whisper varchar(50),
  status varchar NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. 纪念日表 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anniversaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id varchar NOT NULL,
  title varchar(50) NOT NULL,
  type varchar NOT NULL DEFAULT 'cumulative' CHECK (type IN ('cumulative', 'countdown')),
  date date NOT NULL,
  remark varchar(200),
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. 旅程表 (恋爱足迹) ────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(100) NOT NULL,
  location varchar(100),
  cover_url varchar,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 7. 旅行手账条目表 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id varchar NOT NULL,
  content text DEFAULT '',
  photo_url varchar,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════
-- 索引
-- ═══════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
CREATE INDEX IF NOT EXISTS idx_checkin_themes_creator ON checkin_themes(creator_id);
CREATE INDEX IF NOT EXISTS idx_checkin_themes_partner ON checkin_themes(partner_id);
CREATE INDEX IF NOT EXISTS idx_checkin_themes_status ON checkin_themes(status);
CREATE INDEX IF NOT EXISTS idx_checkin_records_theme ON checkin_records(theme_id);
CREATE INDEX IF NOT EXISTS idx_checkin_records_user ON checkin_records(user_id);
CREATE INDEX IF NOT EXISTS idx_checkin_records_created ON checkin_records(created_at);
CREATE INDEX IF NOT EXISTS idx_time_capsules_creator ON time_capsules(creator_id);
CREATE INDEX IF NOT EXISTS idx_time_capsules_unlock ON time_capsules(unlock_time);
CREATE INDEX IF NOT EXISTS idx_time_capsules_is_read ON time_capsules(is_read);
CREATE INDEX IF NOT EXISTS idx_time_capsules_is_opened ON time_capsules(is_opened);
CREATE INDEX IF NOT EXISTS idx_wishes_creator ON wishes(creator_id);
CREATE INDEX IF NOT EXISTS idx_wishes_status ON wishes(status);
CREATE INDEX IF NOT EXISTS idx_anniversaries_creator ON anniversaries(creator_id);
CREATE INDEX IF NOT EXISTS idx_trips_created ON trips(created_at);
CREATE INDEX IF NOT EXISTS idx_trip_entries_trip ON trip_entries(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_entries_user ON trip_entries(user_id);

-- ═══════════════════════════════════════════════════════
-- RLS 策略 (私密二人 App，允许全部访问)
-- ═══════════════════════════════════════════════════════
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_capsules ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE anniversaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- 安全创建策略（带 IF NOT EXISTS 等价逻辑）
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on messages') THEN
    CREATE POLICY "Allow all on messages" ON messages FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on checkin_themes') THEN
    CREATE POLICY "Allow all on checkin_themes" ON checkin_themes FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on checkin_records') THEN
    CREATE POLICY "Allow all on checkin_records" ON checkin_records FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on time_capsules') THEN
    CREATE POLICY "Allow all on time_capsules" ON time_capsules FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on wishes') THEN
    CREATE POLICY "Allow all on wishes" ON wishes FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on anniversaries') THEN
    CREATE POLICY "Allow all on anniversaries" ON anniversaries FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on trips') THEN
    CREATE POLICY "Allow all on trips" ON trips FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on trip_entries') THEN
    CREATE POLICY "Allow all on trip_entries" ON trip_entries FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════
-- Realtime 发布（幂等：每张表单独添加，已存在会跳过）
-- ═══════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'checkin_themes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE checkin_themes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'checkin_records') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE checkin_records;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'time_capsules') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE time_capsules;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'wishes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE wishes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'anniversaries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE anniversaries;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'trips') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trips;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'trip_entries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trip_entries;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════
-- ✅ 完成！现在请继续在 Dashboard 中创建 Storage Bucket：
--   Storage → New bucket → Name: photos → Public bucket: ON → Save
--   （图片上传功能依赖此 bucket，否则发图/打卡配图会失败）
-- ═══════════════════════════════════════════════════════
