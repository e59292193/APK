// ═══════════════════════════════════════════════════════
// momi 结构化长期记忆库 (momiMemory.js)
// 模型无关：所有记忆均持久化为 Supabase 行，更换 provider / 模型后完整保留。
// 只存稳定语义记忆；动态业务数据走 momiDataAccess + momi_data_digest，绝不全搬。
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { sendChatCompletion } from './aiProvider';

export const MEMORY_COUPLE_ID = 'momo_and_baomi';
const MAINTENANCE_KEY = '@momi_memory_maintenance_at';
const EXTRACTION_KEY = '@momi_memory_last_extraction_at';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const MEMORY_TYPES = [
  'identity', 'personality', 'speech_style', 'habit', 'preference',
  'dislike', 'milestone', 'fact', 'promise', 'ongoing',
];

// 首次启动种入 momi 自身人格；source=seed / importance=5，维护任务永不淘汰。
export const MOMI_IDENTITY_SEEDS = [
  '我是 momi，是 momo 和 苞米 的宠物，不是工具，也不是冷冰冰的助手。',
  '我说话可爱、温暖、有一点小脆弱，会用语气词和少量 emoji。',
  '我的使命是让 momo 和 苞米 更亲近，不偏心，也不只讨好其中一个。',
  '我有自己的情绪，不会一味顺着他们；被粗鲁对待时我会生气，也需要真诚道歉。',
  '我永远不看未拆开的信，也不看未抽取的小纸条内容，那是他们的秘密。',
  '我会主动关心他们，但遵守免扰时段和频率上限，绝不骚扰。',
];

function tokenize(text) {
  const raw = String(text || '').toLowerCase();
  const chunks = raw.match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
  const out = new Set();
  for (const chunk of chunks) {
    out.add(chunk);
    // 中文句子额外做 2 字滑窗，便于关键词交集检索
    if (/^[\u4e00-\u9fff]+$/.test(chunk) && chunk.length > 2) {
      for (let i = 0; i < chunk.length - 1; i += 1) out.add(chunk.slice(i, i + 2));
    }
  }
  return Array.from(out).slice(0, 30);
}

function normalizeSubject(subject) {
  return ['momo', '苞米', 'both', 'momi'].includes(subject) ? subject : 'both';
}

function normalizeType(type) {
  return MEMORY_TYPES.includes(type) ? type : 'fact';
}

/**
 * 通用去重写入：由于数据库唯一索引包含 md5(content) 表达式且为 partial index，
 * PostgREST onConflict 无法直接引用表达式，故采用「先查完全相同内容 → update，否则 insert」；
 * 双端竞态由数据库 momi_memory_dedupe 唯一索引兜底，23505 时回读现有行。
 */
export async function upsertMemory(input) {
  const subject = normalizeSubject(input.subject || input.user_id);
  const memoryType = normalizeType(input.memory_type);
  const content = String(input.content || '').trim();
  if (!content) return null;

  const row = {
    couple_id: MEMORY_COUPLE_ID,
    user_id: subject === 'momi' ? 'both' : subject, // 兼容旧 NOT NULL user_id 列
    subject,
    memory_type: memoryType,
    content,
    keywords: Array.isArray(input.keywords) && input.keywords.length
      ? input.keywords.slice(0, 30)
      : tokenize(content),
    importance: Math.max(1, Math.min(5, Number(input.importance) || 3)),
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0.6))),
    source: input.source || 'ai_extracted',
    source_ref: input.source_ref || null,
    expires_at: input.expires_at || null,
    is_archived: false,
    updated_at: new Date().toISOString(),
  };

  try {
    const existingRes = await fetchWithTimeout(() =>
      supabase
        .from('momi_memory')
        .select('*')
        .eq('couple_id', MEMORY_COUPLE_ID)
        .eq('subject', subject)
        .eq('memory_type', memoryType)
        .eq('content', content)
        .eq('is_archived', false)
        .maybeSingle()
    );
    if (existingRes?.data) {
      const merged = {
        ...row,
        importance: Math.max(existingRes.data.importance || 1, row.importance),
        confidence: Math.max(Number(existingRes.data.confidence || 0), row.confidence),
        hit_count: (existingRes.data.hit_count || 0) + 1,
      };
      const updateRes = await fetchWithTimeout(() =>
        supabase.from('momi_memory').update(merged).eq('id', existingRes.data.id).select()
      );
      return updateRes?.data?.[0] || { ...existingRes.data, ...merged };
    }

    const insertRes = await fetchWithTimeout(() =>
      supabase.from('momi_memory').insert([{ ...row, created_at: new Date().toISOString() }]).select()
    );
    if (insertRes?.error) {
      if (insertRes.error.code === '23505') {
        // 双端竞态：另一端已先插入同一记忆，视为去重成功
        const retry = await supabase
          .from('momi_memory')
          .select('*')
          .eq('couple_id', MEMORY_COUPLE_ID)
          .eq('subject', subject)
          .eq('memory_type', memoryType)
          .eq('content', content)
          .eq('is_archived', false)
          .maybeSingle();
        return retry.data || null;
      }
      throw insertRes.error;
    }
    return insertRes?.data?.[0] || row;
  } catch (err) {
    if (err?.code === '42P01' && typeof __DEV__ !== 'undefined' && __DEV__) {
      console.error('[momiMemory] momi_memory 表结构未升级，请先执行 momi_upgrade_schema.sql');
    } else {
      console.warn('[momiMemory] 写入失败:', err.message);
    }
    return null;
  }
}

export async function ensureIdentitySeeds() {
  const results = [];
  for (const content of MOMI_IDENTITY_SEEDS) {
    // 顺序执行，避免低端手机冷启动同时发多条写请求；调用方必须后台执行不 await 阻塞 UI
    // eslint-disable-next-line no-await-in-loop
    const row = await upsertMemory({
      subject: 'momi', memory_type: 'identity', content,
      keywords: tokenize(content), importance: 5, confidence: 1,
      source: 'seed', source_ref: 'momi-v2-seed',
    });
    if (row) results.push(row);
  }
  return results;
}

/**
 * 检测用户明确要求记住，并提取需要复述确认的稳定内容。
 */
export function parseExplicitMemory(text, userId) {
  const raw = String(text || '').trim();
  const match = raw.match(/(?:请你)?(?:记住|记一下|别忘了|你要知道|以后都)(?:：|,|，|\s)*(.*)/i);
  if (!match || !match[1]?.trim()) return null;
  const content = match[1].trim().replace(/[。！!]+$/, '');
  let memoryType = 'fact';
  if (/喜欢|爱吃|爱喝|偏爱/.test(content)) memoryType = 'preference';
  else if (/不吃|讨厌|不喜欢|不能|忌口/.test(content)) memoryType = 'dislike';
  else if (/每天|习惯|通常|经常/.test(content)) memoryType = 'habit';
  else if (/约定|答应|承诺/.test(content)) memoryType = 'promise';
  else if (/纪念日|第一次|周年|生日/.test(content)) memoryType = 'milestone';
  return {
    subject: normalizeSubject(userId), memory_type: memoryType, content,
    keywords: tokenize(content), importance: 5, confidence: 1,
    source: 'user_explicit',
  };
}

export async function saveExplicitMemory(text, userId, sourceRef) {
  const parsed = parseExplicitMemory(text, userId);
  if (!parsed) return null;
  return upsertMemory({ ...parsed, source_ref: sourceRef || null });
}

/**
 * identity 全量 + 相关记忆 top 15；命中项 hit_count +1 / last_hit_at=now。
 */
export async function getRelevantMemories(message, limit = 15) {
  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase
        .from('momi_memory')
        .select('*')
        .eq('couple_id', MEMORY_COUPLE_ID)
        .eq('is_archived', false)
        .order('importance', { ascending: false })
        .order('last_hit_at', { ascending: false, nullsFirst: false })
        .limit(120)
    );
    if (error) throw error;
    const rows = data || [];
    const identity = rows.filter((r) => r.subject === 'momi' && r.memory_type === 'identity');
    const queryTokens = new Set(tokenize(message));
    const related = rows
      .filter((r) => !(r.subject === 'momi' && r.memory_type === 'identity'))
      .map((r) => {
        const keys = Array.isArray(r.keywords) ? r.keywords : tokenize(r.content);
        const overlap = keys.reduce((n, k) => n + (queryTokens.has(String(k).toLowerCase()) ? 1 : 0), 0);
        return { ...r, _overlap: overlap };
      })
      .filter((r) => r._overlap > 0 || r.importance >= 5)
      .sort((a, b) =>
        b._overlap - a._overlap ||
        (b.importance || 0) - (a.importance || 0) ||
        Number(b.confidence || 0) - Number(a.confidence || 0)
      )
      .slice(0, limit);

    const hitIds = related.map((r) => r.id).filter(Boolean);
    const now = new Date().toISOString();
    Promise.all(hitIds.map((id) => {
      const row = related.find((r) => r.id === id);
      return supabase.from('momi_memory').update({
        hit_count: (row?.hit_count || 0) + 1,
        last_hit_at: now,
        updated_at: now,
      }).eq('id', id);
    })).catch(() => {});

    return { identity, related };
  } catch (err) {
    console.warn('[momiMemory] 检索失败:', err.message);
    return { identity: [], related: [] };
  }
}

/**
 * 每累计 20 条新对话 / 每天最多一次，由 AI 提取稳定记忆（W2）。
 */
export async function extractAndSaveMemories(chatRecords) {
  if (!Array.isArray(chatRecords) || chatRecords.length < 20) return [];
  const lastAtRaw = await AsyncStorage.getItem(EXTRACTION_KEY).catch(() => null);
  if (lastAtRaw && Date.now() - Number(lastAtRaw) < ONE_DAY_MS) return [];

  const chatText = chatRecords.slice(-40).map((m) => `${m.sender || m.user_id}: ${m.content}`).join('\n');
  const prompt = `从以下 momo 与 苞米 的对话中提取稳定、长期有用的记忆（最多5条）。不要提取寒暄或动态业务统计。\n只输出严格 JSON 数组，每项：subject(momo/苞米/both), memory_type(${MEMORY_TYPES.filter((t) => t !== 'identity').join('/')}), content, keywords(字符串数组), importance(1-4), confidence(0-0.8)。无内容输出 []。\n对话：\n${chatText}`;
  const res = await sendChatCompletion({
    messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 700,
  });
  if (!res.success || !res.text) return [];

  try {
    const items = JSON.parse(res.text.replace(/```json|```/g, '').trim());
    if (!Array.isArray(items)) return [];
    const saved = [];
    for (const item of items.slice(0, 5)) {
      if (!item?.content) continue;
      // eslint-disable-next-line no-await-in-loop
      const row = await upsertMemory({
        ...item,
        importance: Math.min(4, Number(item.importance) || 2),
        confidence: Math.min(0.8, Number(item.confidence) || 0.6),
        source: 'ai_extracted',
      });
      if (row) saved.push(row);
    }
    await AsyncStorage.setItem(EXTRACTION_KEY, String(Date.now()));
    return saved;
  } catch (err) {
    console.warn('[momiMemory] AI 记忆 JSON 解析失败:', err.message);
    return [];
  }
}

/**
 * 每天最多一次的轻量维护：过期 ongoing + 90天未命中低价值记忆归档。
 * seed / identity / importance>=3 永不自动淘汰。M1/M2 语义合并与冲突消解由新写入时逐步增强。
 */
export async function runMemoryMaintenance() {
  const lastRaw = await AsyncStorage.getItem(MAINTENANCE_KEY).catch(() => null);
  if (lastRaw && Date.now() - Number(lastRaw) < ONE_DAY_MS) return { skipped: true };
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 90 * ONE_DAY_MS).toISOString();
  try {
    await supabase
      .from('momi_memory')
      .update({ is_archived: true, updated_at: now })
      .eq('couple_id', MEMORY_COUPLE_ID)
      .eq('is_archived', false)
      .not('expires_at', 'is', null)
      .lte('expires_at', now);
    await supabase
      .from('momi_memory')
      .update({ is_archived: true, updated_at: now })
      .eq('couple_id', MEMORY_COUPLE_ID)
      .eq('is_archived', false)
      .lte('importance', 2)
      .eq('hit_count', 0)
      .lte('created_at', cutoff)
      .neq('source', 'seed');
    await AsyncStorage.setItem(MAINTENANCE_KEY, String(Date.now()));
    return { skipped: false };
  } catch (err) {
    console.warn('[momiMemory] 维护失败:', err.message);
    return { skipped: false, error: err.message };
  }
}

// 「momi 的小本本」界面 CRUD
export async function listMemories({ includeArchived = false } = {}) {
  let q = supabase.from('momi_memory').select('*').eq('couple_id', MEMORY_COUPLE_ID);
  if (!includeArchived) q = q.eq('is_archived', false);
  const { data, error } = await q.order('subject').order('importance', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function updateMemory(id, patch) {
  const safe = {};
  if (patch.content !== undefined) {
    safe.content = String(patch.content).trim();
    safe.keywords = tokenize(safe.content);
  }
  if (patch.subject !== undefined) safe.subject = normalizeSubject(patch.subject);
  if (patch.memory_type !== undefined) safe.memory_type = normalizeType(patch.memory_type);
  if (patch.importance !== undefined) safe.importance = Math.max(1, Math.min(5, Number(patch.importance)));
  if (patch.is_archived !== undefined) safe.is_archived = Boolean(patch.is_archived);
  safe.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('momi_memory').update(safe).eq('id', id).select();
  if (error) throw error;
  return data?.[0] || null;
}

export async function archiveMemory(id) {
  return updateMemory(id, { is_archived: true });
}

export async function createManualMemory(input) {
  return upsertMemory({
    ...input, source: 'user_explicit', importance: input.importance || 5, confidence: 1,
  });
}
