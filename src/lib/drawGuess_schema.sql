-- ═══════════════════════════════════════════════════════
-- 你画我猜（Draw & Guess）完整数据库脚本
-- Supabase Dashboard → SQL Editor → New query → 粘贴 → Run
-- 可重复执行；已有项目也会自动补齐 v2 字段、索引与正确的 RLS。
-- ═══════════════════════════════════════════════════════

-- 1. 对局表 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.drawguess_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id varchar NOT NULL,
  invitee_id varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'picking', 'drawing', 'finished')),
  round int NOT NULL DEFAULT 1,
  current_drawer varchar NOT NULL DEFAULT 'creator',
  round_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  word varchar,
  word_choices jsonb,
  winner varchar,
  hint varchar,
  started_at timestamptz,
  deadline_at timestamptz,
  finished_at timestamptz,
  duration_sec int,
  rematch_request_by varchar,
  rematch_game_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'drawguess_games' AND column_name = 'hint'
  ) THEN
    ALTER TABLE public.drawguess_games ADD COLUMN hint varchar;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'drawguess_games' AND column_name = 'duration_sec'
  ) THEN
    ALTER TABLE public.drawguess_games ADD COLUMN duration_sec int;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'drawguess_games' AND column_name = 'rematch_request_by'
  ) THEN
    ALTER TABLE public.drawguess_games ADD COLUMN rematch_request_by varchar;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'drawguess_games' AND column_name = 'rematch_game_id'
  ) THEN
    ALTER TABLE public.drawguess_games ADD COLUMN rematch_game_id uuid;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'drawguess_games' AND column_name = 'round'
  ) THEN
    ALTER TABLE public.drawguess_games ADD COLUMN round int NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'drawguess_games' AND column_name = 'current_drawer'
  ) THEN
    ALTER TABLE public.drawguess_games ADD COLUMN current_drawer varchar NOT NULL DEFAULT 'creator';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'drawguess_games' AND column_name = 'round_results'
  ) THEN
    ALTER TABLE public.drawguess_games ADD COLUMN round_results jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'drawguess_games' AND column_name = 'deadline_at'
  ) THEN
    ALTER TABLE public.drawguess_games ADD COLUMN deadline_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_drawguess_creator
  ON public.drawguess_games (creator_id);
CREATE INDEX IF NOT EXISTS idx_drawguess_invitee
  ON public.drawguess_games (invitee_id);
CREATE INDEX IF NOT EXISTS idx_drawguess_status
  ON public.drawguess_games (status);

-- 2. 画作画廊 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.drawguess_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL,
  drawer_id varchar NOT NULL,
  guesser_id varchar NOT NULL,
  word varchar NOT NULL,
  image_url varchar NOT NULL,
  result varchar NOT NULL DEFAULT 'win'
    CHECK (result IN ('win', 'timeout', 'gaveup')),
  duration_sec int,
  round int,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'drawguess_gallery' AND column_name = 'round'
  ) THEN
    ALTER TABLE public.drawguess_gallery ADD COLUMN round int;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_drawguess_gallery_created
  ON public.drawguess_gallery (created_at DESC);

-- 旧版允许双方同时各存一条。保留每局每轮最早的记录，再加唯一索引从数据库层防重。
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

-- 3. 私房词库 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.drawguess_custom_words (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  word varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drawguess_words_user
  ON public.drawguess_custom_words (user_id);
CREATE INDEX IF NOT EXISTS idx_drawguess_custom_words_user_created
  ON public.drawguess_custom_words (user_id, created_at DESC);

-- 4. 可靠信号队列 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.drawguess_signals (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  game_id uuid NOT NULL,
  type varchar NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  sender_id varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drawguess_signals_game
  ON public.drawguess_signals (game_id, id);

-- 可选的 Supabase Realtime 快速通道；客户端同时保留 IM + DB 轮询兜底。
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.drawguess_signals;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

-- 5. 统计快照 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.drawguess_stats (
  user_id varchar PRIMARY KEY,
  total_games int NOT NULL DEFAULT 0,
  won_games int NOT NULL DEFAULT 0,
  fastest_sec int,
  fastest_word varchar,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. RLS ────────────────────────────────────────────────
-- 当前产品使用 anon key + 应用内昵称，并没有 Supabase Auth 会话。
-- 因此不能用 auth.uid() 与 varchar user_id 比较：auth.uid() 为 NULL，类型也不匹配。
-- 这是仅供两人使用的私密应用，按现有信任模型允许 anon/authenticated 访问，
-- 词库的数据隔离由客户端查询中的 user_id 条件完成。
ALTER TABLE public.drawguess_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawguess_gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawguess_custom_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawguess_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawguess_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on drawguess_games" ON public.drawguess_games;
CREATE POLICY "Allow all on drawguess_games"
  ON public.drawguess_games FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on drawguess_gallery" ON public.drawguess_gallery;
CREATE POLICY "Allow all on drawguess_gallery"
  ON public.drawguess_gallery FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on drawguess_custom_words" ON public.drawguess_custom_words;
CREATE POLICY "Allow all on drawguess_custom_words"
  ON public.drawguess_custom_words FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on drawguess_signals" ON public.drawguess_signals;
CREATE POLICY "Allow all on drawguess_signals"
  ON public.drawguess_signals FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on drawguess_stats" ON public.drawguess_stats;
CREATE POLICY "Allow all on drawguess_stats"
  ON public.drawguess_stats FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- 维护建议：可定期执行以下语句，避免可靠队列表无限增长。
-- DELETE FROM public.drawguess_signals
-- WHERE created_at < now() - interval '1 day';
