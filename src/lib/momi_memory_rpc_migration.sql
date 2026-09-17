-- ═══════════════════════════════════════════════════════
-- momi 记忆并发安全 RPC 补丁
-- 必须在 momi_upgrade_schema.sql 之后执行；幂等，可反复执行。
-- 原因：momi_memory_dedupe 是「表达式 + 部分条件」唯一索引，PostgREST 客户端
-- onConflict 字符串无法可靠表达 md5(content) + WHERE is_archived=false，故下沉数据库。
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_momi_memory(
  p_couple_id varchar,
  p_subject varchar,
  p_memory_type varchar,
  p_content text,
  p_keywords text[] DEFAULT NULL,
  p_importance int DEFAULT 3,
  p_confidence numeric DEFAULT 0.60,
  p_source varchar DEFAULT 'ai_extracted',
  p_source_ref text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS SETOF public.momi_memory
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.momi_memory (
    couple_id, user_id, subject, memory_type, content, keywords,
    importance, confidence, source, source_ref, expires_at,
    is_archived, created_at, updated_at
  ) VALUES (
    p_couple_id, p_subject, p_subject, p_memory_type, trim(p_content), p_keywords,
    greatest(1, least(5, p_importance)),
    greatest(0, least(1, p_confidence)),
    p_source, p_source_ref, p_expires_at,
    false, now(), now()
  )
  ON CONFLICT (couple_id, subject, memory_type, md5(content))
    WHERE is_archived = false
  DO UPDATE SET
    keywords = COALESCE(EXCLUDED.keywords, momi_memory.keywords),
    importance = GREATEST(momi_memory.importance, EXCLUDED.importance),
    confidence = GREATEST(momi_memory.confidence, EXCLUDED.confidence),
    source = CASE
      WHEN EXCLUDED.source = 'user_explicit' THEN 'user_explicit'
      ELSE momi_memory.source
    END,
    source_ref = COALESCE(EXCLUDED.source_ref, momi_memory.source_ref),
    expires_at = COALESCE(EXCLUDED.expires_at, momi_memory.expires_at),
    updated_at = now()
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_momi_memories(p_ids uuid[])
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.momi_memory
  SET hit_count = hit_count + 1,
      last_hit_at = now(),
      updated_at = now()
  WHERE id = ANY(p_ids) AND is_archived = false;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_momi_memory(
  varchar, varchar, varchar, text, text[], int, numeric, varchar, text, timestamptz
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_momi_memories(uuid[]) TO anon, authenticated;
