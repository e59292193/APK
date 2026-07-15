-- ═══════════════════════════════════════════════════════
-- 时光胶囊 - 功能扩展字段 (Phase 2 升级)
-- ═══════════════════════════════════════════════════════

-- 1. 扩展 time_capsules 表，新增天气/心情/已读字段
ALTER TABLE time_capsules ADD COLUMN IF NOT EXISTS weather varchar DEFAULT NULL;
ALTER TABLE time_capsules ADD COLUMN IF NOT EXISTS mood varchar DEFAULT NULL;
ALTER TABLE time_capsules ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;

-- 2. 索引
CREATE INDEX IF NOT EXISTS idx_time_capsules_is_read ON time_capsules(is_read);
CREATE INDEX IF NOT EXISTS idx_time_capsules_is_opened ON time_capsules(is_opened);

-- 3. 已有的 RLS 和 Realtime 策略自动覆盖新字段，无需额外配置