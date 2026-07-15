-- ═══════════════════════════════════════════════════════
-- 五子棋 (Gomoku) - 对局表
-- 执行方式：Supabase Dashboard → SQL Editor → New query → 粘贴 → Run
-- 注意：所有语句均带 IF NOT EXISTS，可重复执行
-- ═══════════════════════════════════════════════════════

-- 1. 五子棋对局表 ──────────────────────────────────────
-- moves 为唯一数据源：[{x, y, p}, ...]  p=1 黑(邀请方) p=2 白(受邀方)
-- 棋盘状态由客户端从 moves 推导，避免冗余存储
CREATE TABLE IF NOT EXISTS gomoku_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id varchar NOT NULL,            -- 邀请方 (黑棋)
  invitee_id varchar NOT NULL,            -- 受邀方 (白棋)
  status varchar NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'playing', 'finished')),
  moves jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_turn varchar NOT NULL,          -- 'creator' | 'invitee'，初始 creator
  winner varchar,                         -- null 进行中 / 'creator' / 'invitee' / 'draw'
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  rematch_request_by varchar,             -- 再来一局请求方 user_id (null=无请求)
  rematch_game_id uuid,                   -- 再来一局新建的对局 ID (同意后设置)
  resigned_by varchar                     -- 认输方 user_id (null=非认输结束)
);

-- 1b. 为已存在的表添加新列（可重复执行）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gomoku_games' AND column_name = 'rematch_request_by') THEN
    ALTER TABLE gomoku_games ADD COLUMN rematch_request_by varchar;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gomoku_games' AND column_name = 'rematch_game_id') THEN
    ALTER TABLE gomoku_games ADD COLUMN rematch_game_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gomoku_games' AND column_name = 'resigned_by') THEN
    ALTER TABLE gomoku_games ADD COLUMN resigned_by varchar;
  END IF;
END $$;

-- 2. 索引
CREATE INDEX IF NOT EXISTS idx_gomoku_games_creator ON gomoku_games(creator_id);
CREATE INDEX IF NOT EXISTS idx_gomoku_games_invitee ON gomoku_games(invitee_id);
CREATE INDEX IF NOT EXISTS idx_gomoku_games_status ON gomoku_games(status);

-- 3. RLS 策略 (私密二人 App，允许全部访问)
ALTER TABLE gomoku_games ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on gomoku_games') THEN
    CREATE POLICY "Allow all on gomoku_games" ON gomoku_games FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4. Realtime 发布
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'gomoku_games'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE gomoku_games;
  END IF;
END $$;

-- 5. 手动胜场记录表（用于迁移其他平台的历史战绩）─────────
-- 计分板显示 = 数据库自动统计 + 此表的手动值
CREATE TABLE IF NOT EXISTS gomoku_manual_wins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar UNIQUE NOT NULL,
  wins int NOT NULL DEFAULT 0,
  draws int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gomoku_manual_wins ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on gomoku_manual_wins') THEN
    CREATE POLICY "Allow all on gomoku_manual_wins" ON gomoku_manual_wins FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
