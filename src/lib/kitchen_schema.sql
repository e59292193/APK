-- ═══════════════════════════════════════════════════════
-- momi厨房 (Momi Kitchen) & 五子棋悔棋 数据库脚本
-- 可重复执行；通过 Supabase CLI 或 Dashboard SQL Editor 执行
-- ═══════════════════════════════════════════════════════

-- 1. 菜品库表 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kitchen_dishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  category text NOT NULL CHECK (category IN ('meat', 'vegetable', 'snack')),
  title varchar(40) NOT NULL,
  image_path text NOT NULL,
  recipe_text text DEFAULT '',
  recipe_images jsonb DEFAULT '[]'::jsonb,
  created_by varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 索引加速分类筛选与情侣查询
CREATE INDEX IF NOT EXISTS idx_kitchen_dishes_couple ON public.kitchen_dishes (couple_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_dishes_category ON public.kitchen_dishes (couple_id, category);
CREATE INDEX IF NOT EXISTS idx_kitchen_dishes_created ON public.kitchen_dishes (created_at DESC);

-- 2. 本周想吃清单表 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kitchen_weekly_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  dish_id uuid NOT NULL REFERENCES public.kitchen_dishes(id) ON DELETE CASCADE,
  picked_by varchar NOT NULL,
  week_start date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_kitchen_weekly_pick UNIQUE (couple_id, dish_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_kitchen_weekly_picks_lookup 
  ON public.kitchen_weekly_picks (couple_id, week_start);

-- 3. 五子棋对局表补充 undo_request_by 列（悔棋功能）─────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'gomoku_games' 
      AND column_name = 'undo_request_by'
  ) THEN
    ALTER TABLE public.gomoku_games ADD COLUMN undo_request_by varchar;
  END IF;
END $$;

-- 4. RLS 行级安全策略 ────────────────────────────────────
ALTER TABLE public.kitchen_dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_weekly_picks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on kitchen_dishes" ON public.kitchen_dishes;
CREATE POLICY "Allow all on kitchen_dishes"
  ON public.kitchen_dishes FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on kitchen_weekly_picks" ON public.kitchen_weekly_picks;
CREATE POLICY "Allow all on kitchen_weekly_picks"
  ON public.kitchen_weekly_picks FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- 5. Realtime 实时发布 ───────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'kitchen_dishes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.kitchen_dishes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'kitchen_weekly_picks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.kitchen_weekly_picks;
  END IF;
END $$;

-- 6. Storage Bucket: kitchen-images ──────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('kitchen-images', 'kitchen-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Allow all on kitchen-images" ON storage.objects;
CREATE POLICY "Allow all on kitchen-images"
  ON storage.objects FOR ALL TO anon, authenticated
  USING (bucket_id = 'kitchen-images')
  WITH CHECK (bucket_id = 'kitchen-images');
