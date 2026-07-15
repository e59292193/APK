-- ═══════════════════════════════════════════════════════
-- 你画我猜 (Draw & Guess)
-- 执行方式：Supabase Dashboard → SQL Editor → New query → 粘贴 → Run
-- 所有语句均带 IF NOT EXISTS，可重复执行
-- ═══════════════════════════════════════════════════════

-- 1. 对局表 ────────────────────────────────────────────
-- 一局游戏共 6 轮，双方轮流画/猜（奇数轮 creator 画，偶数轮 invitee 画）
-- strokes 只在内存中按笔同步给对方，不落库（保证速度）；
-- 每轮结束时光栅化成图片上传到 Storage，存入 drawguess_gallery。
CREATE TABLE IF NOT EXISTS drawguess_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id varchar NOT NULL,            -- 发起方
  invitee_id varchar NOT NULL,            -- 受邀方
  status varchar NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'picking', 'drawing', 'finished')),
  round int NOT NULL DEFAULT 1,           -- 当前轮次 1~6
  current_drawer varchar NOT NULL DEFAULT 'creator',  -- 本轮画题人 'creator'/'invitee'
  round_results jsonb NOT NULL DEFAULT '[]'::jsonb,   -- 每轮结果 [{round,drawer,word,winner,duration}, ...]
  word varchar,                           -- 本轮选中的词
  word_choices jsonb,                     -- 三选一候选词 [{word}, ...]
  winner varchar,                         -- 本轮结果：null/'win'/'timeout'/'gaveup'
  hint varchar,                           -- 画题人给出的文字提示
  started_at timestamptz,                 -- 进入画画阶段的时间
  finished_at timestamptz,                -- 全部 6 轮结束时间
  duration_sec int,                       -- 本轮猜中用时（秒）
  rematch_request_by varchar,
  rematch_game_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1b. 补列（可重复执行）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drawguess_games' AND column_name = 'hint') THEN
    ALTER TABLE drawguess_games ADD COLUMN hint varchar;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drawguess_games' AND column_name = 'duration_sec') THEN
    ALTER TABLE drawguess_games ADD COLUMN duration_sec int;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drawguess_games' AND column_name = 'rematch_request_by') THEN
    ALTER TABLE drawguess_games ADD COLUMN rematch_request_by varchar;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drawguess_games' AND column_name = 'rematch_game_id') THEN
    ALTER TABLE drawguess_games ADD COLUMN rematch_game_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drawguess_games' AND column_name = 'round') THEN
    ALTER TABLE drawguess_games ADD COLUMN round int NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drawguess_games' AND column_name = 'current_drawer') THEN
    ALTER TABLE drawguess_games ADD COLUMN current_drawer varchar NOT NULL DEFAULT 'creator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drawguess_games' AND column_name = 'round_results') THEN
    ALTER TABLE drawguess_games ADD COLUMN round_results jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_drawguess_creator ON drawguess_games(creator_id);
CREATE INDEX IF NOT EXISTS idx_drawguess_invitee ON drawguess_games(invitee_id);
CREATE INDEX IF NOT EXISTS idx_drawguess_status ON drawguess_games(status);

-- 2. 画作画廊（每局结束自动保存一幅画）─────────────────
CREATE TABLE IF NOT EXISTS drawguess_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL,
  drawer_id varchar NOT NULL,             -- 画题人
  guesser_id varchar NOT NULL,            -- 猜题人
  word varchar NOT NULL,                  -- 本局关键词
  image_url varchar NOT NULL,             -- 渲染后的图片公开 URL
  result varchar NOT NULL DEFAULT 'win'   -- 'win' 猜中 / 'timeout' 超时 / 'gaveup' 放弃
    CHECK (result IN ('win', 'timeout', 'gaveup')),
  duration_sec int,                       -- 用时（猜中时有值）
  round int,                              -- 第几轮（1~6）
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drawguess_gallery_created ON drawguess_gallery(created_at DESC);

-- 2b. 画廊补列（可重复执行）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drawguess_gallery' AND column_name = 'round') THEN
    ALTER TABLE drawguess_gallery ADD COLUMN round int;
  END IF;
END $$;

-- 3. 自定义词库（仅上传者本人能抽到）────────────────────
CREATE TABLE IF NOT EXISTS drawguess_custom_words (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,               -- 添加者；抽词时仅对该用户可见
  word varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drawguess_words_user ON drawguess_custom_words(user_id);

-- 3b. 实时信号队列表（笔画/弹幕/撤销/清空 通过 DB 轮询同步，不依赖 IM 信号）──
-- 每条信号是一行，双方按 id > lastSeenId 增量拉取，保证跨设备可靠同步
CREATE TABLE IF NOT EXISTS drawguess_signals (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  game_id uuid NOT NULL,
  type varchar NOT NULL,              -- 'stroke_begin'/'stroke_pts'/'stroke_end'/'danmaku'/'undo'/'clear'/'guess'
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  sender_id varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drawguess_signals_game ON drawguess_signals(game_id, id);

ALTER TABLE drawguess_signals ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on drawguess_signals') THEN
    CREATE POLICY "Allow all on drawguess_signals" ON drawguess_signals FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 启用 Realtime（WebSocket 实时推送 INSERT 事件，让笔画同步丝滑无延迟）
-- 将 drawguess_signals 表加入 supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE drawguess_signals;

-- 4. 统计快照表（轻量统计：总局数/猜中数/最快记录）──────
CREATE TABLE IF NOT EXISTS drawguess_stats (
  user_id varchar PRIMARY KEY,
  total_games int NOT NULL DEFAULT 0,
  won_games int NOT NULL DEFAULT 0,
  fastest_sec int,
  fastest_word varchar,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. RLS（私密二人 App，允许全部访问）
ALTER TABLE drawguess_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawguess_gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawguess_custom_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawguess_stats ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on drawguess_games') THEN
    CREATE POLICY "Allow all on drawguess_games" ON drawguess_games FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on drawguess_gallery') THEN
    CREATE POLICY "Allow all on drawguess_gallery" ON drawguess_gallery FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on drawguess_custom_words') THEN
    -- 仅本人可读写自己的自定义词（user_id 字段已强制隔离）
    CREATE POLICY "Allow all on drawguess_custom_words" ON drawguess_custom_words
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on drawguess_stats') THEN
    CREATE POLICY "Allow all on drawguess_stats" ON drawguess_stats FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
