-- ═══════════════════════════════════════════════════════
-- momi V5 迁移脚本 (momi_v5_migration.sql)
-- 提示词9：可信记忆证据链 + 聊天消息幂等持久化
-- 执行顺序：momi_upgrade_schema.sql → momi_v2_corrective_migration.sql
--           → momi_v3_migration.sql → momi_v4_migration.sql → 本文件
-- 执行方式：Supabase Dashboard → SQL Editor → 粘贴执行
-- 全部语句幂等，可安全重复执行；不删除任何用户数据。
-- ═══════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────
-- 1. momi_memory 证据与生命周期字段
--    status: active(可检索) | superseded(已被新事实替代) | unverified(待核验，不检索) | deleted(用户要求忘记，不检索)
-- ─────────────────────────────────────────────────────
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'active';
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS memory_key text;          -- 稳定归一化事实键，如 dislike:不吃香菜
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS source_message_id text;   -- 证据：来源 user 消息 id
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS evidence_excerpt text;    -- 证据：原文连续片段
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS visibility_scope varchar(16) NOT NULL DEFAULT 'couple'; -- private | couple
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS valid_from timestamptz;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS valid_to timestamptz;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS supersedes_id uuid;
ALTER TABLE public.momi_memory ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz;

-- ─────────────────────────────────────────────────────
-- 2. 旧记忆隔离（不删除，只降级）
--    来源是 AI 抽取且无法追溯到具体用户消息的，一律 unverified，不再注入模型；
--    user_explicit / seed / db_sync 保持 active。
-- ─────────────────────────────────────────────────────
UPDATE public.momi_memory
SET status = 'unverified', updated_at = now()
WHERE status = 'active'
  AND source = 'ai_extracted'
  AND (source_ref IS NULL OR btrim(source_ref) = '');

-- ─────────────────────────────────────────────────────
-- 3. 检索与幂等索引
-- ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS momi_memory_evidence_idx
  ON public.momi_memory (couple_id, subject, status);

-- 同一主体同一事实键的同一条来源消息只允许一条 active，重试不产生重复记忆
CREATE UNIQUE INDEX IF NOT EXISTS momi_memory_source_msg_key_unique
  ON public.momi_memory (couple_id, subject, memory_key, source_message_id)
  WHERE source_message_id IS NOT NULL AND memory_key IS NOT NULL AND status = 'active';

-- ─────────────────────────────────────────────────────
-- 4. momi_assistant_messages 幂等键与回复链
--    client_message_id：客户端发送前生成，重试/断网重连时用 upsert 幂等；
--    reply_to_message_id：assistant 回复指向对应 user 消息。
-- ─────────────────────────────────────────────────────
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS client_message_id text;
ALTER TABLE public.momi_assistant_messages ADD COLUMN IF NOT EXISTS reply_to_message_id text;

-- 旧行 client_message_id 全为 NULL，部分唯一索引天然只约束新数据，创建必成功
CREATE UNIQUE INDEX IF NOT EXISTS momi_assistant_messages_client_id_unique
  ON public.momi_assistant_messages (couple_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_momi_assistant_messages_reply_to
  ON public.momi_assistant_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════
-- ✅ 迁移完成检查清单
--   □ momi_memory 出现 status / memory_key / source_message_id / evidence_excerpt 等新列
--   □ 无证据的 ai_extracted 旧记忆已变为 unverified（SELECT status, count(*) FROM momi_memory GROUP BY status 自查）
--   □ momi_assistant_messages 出现 client_message_id / reply_to_message_id 与唯一索引
-- ═══════════════════════════════════════════════════════
