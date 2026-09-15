-- ═══════════════════════════════════════════════════════
-- momi厨房「饮品」分类独立迁移 (kitchen_drink_migration.sql)
-- 提示词4 · 3.2 陷阱1：kitchen_dishes.category 的 CHECK 约束
-- 当前仅允许 ('meat','vegetable','snack')，不改约束直接插 'drink' 会被数据库拒绝。
--
-- 说明：本变更也已包含在 momi_upgrade_schema.sql 第 3 节中；
--       若已执行过 momi_upgrade_schema.sql，本文件无需再执行（但重复执行无害）。
--
-- 执行方式：Supabase Dashboard → SQL Editor → 粘贴 → Run（幂等，可反复执行）
-- ═══════════════════════════════════════════════════════

-- 用 DO 块动态查找并删除旧约束，避免写死约束名导致迁移无声失败
DO $$
DECLARE con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.kitchen_dishes'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%category%'
    AND pg_get_constraintdef(oid) NOT ILIKE '%drink%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.kitchen_dishes DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

-- 若已存在同名新约束则先删再加，保证幂等
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kitchen_dishes'::regclass
      AND conname = 'kitchen_dishes_category_check'
  ) THEN
    ALTER TABLE public.kitchen_dishes DROP CONSTRAINT kitchen_dishes_category_check;
  END IF;
END $$;

ALTER TABLE public.kitchen_dishes
  ADD CONSTRAINT kitchen_dishes_category_check
  CHECK (category IN ('meat', 'vegetable', 'snack', 'drink'));
