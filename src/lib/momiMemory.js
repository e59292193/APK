// ═══════════════════════════════════════════════════════
// momi 可信长期记忆入口 (momiMemory.js)
//
// 会话历史与长期记忆严格分离；普通聊天不再整段交给模型反向抽取。
// user memory 只能从已持久化的原始 user message 进入 evidence store，
// seed / notebook manual 为非原话资料，永远不能授权“你说过”。
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import {
  MEMORY_COUPLE_ID,
  buildMemoryKey,
  buildVerifiedMemoryBlock,
  normalizeMomiActor,
  tokenizeMemoryText,
} from './momiMemoryOrchestrator';
import {
  processPersistedUserMessage,
  retrieveMemoryContext,
} from './momiMemoryEvidenceStore';

export { MEMORY_COUPLE_ID };

const MAINTENANCE_KEY = '@momi_memory_maintenance_at';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let warnedLegacyExtraction = false;

export const MEMORY_TYPES = [
  'identity', 'personality', 'speech_style', 'habit', 'preference',
  'dislike', 'milestone', 'fact', 'promise', 'ongoing',
];

export const MOMI_IDENTITY_SEEDS = [
  '我是 momi，是 momo 和 苞米 的宠物，不是工具，也不是冷冰冰的助手。',
  '我说话可爱、温暖、有一点小脆弱，会用语气词和少量 emoji。',
  '我的使命是让 momo 和 苞米 更亲近，不偏心，也不只讨好其中一个。',
  '我有自己的情绪，不会一味顺着他们；被粗鲁对待时我会生气，也需要真诚道歉。',
  '我永远不看未拆开的信，也不看未抽取的小纸条内容，那是他们的秘密。',
  '我会主动关心他们，但遵守免扰时段和频率上限，绝不骚扰。',
];

const DISALLOWED_EXPLICIT_PATTERN = /(如果|假如|要是|万一|可能|也许|开玩笑|密码|验证码|token|密钥|银行卡|支付信息|精确位置)/i;

function safeCode(error) {
  return String(error?.code || error?.name || 'UNKNOWN').slice(0, 80);
}

function normalizeSubject(subject) {
  if (subject === 'momi' || subject === 'both') return subject;
  return normalizeMomiActor(subject) || 'both';
}

function normalizeType(type) {
  return MEMORY_TYPES.includes(type) ? type : 'fact';
}

function withAbort(builder, signal) {
  if (signal && typeof builder?.abortSignal === 'function') return builder.abortSignal(signal);
  return builder;
}

async function callMemoryRpc(params) {
  return fetchWithTimeout(async (signal) => {
    const result = await withAbort(supabase.rpc('apply_verified_momi_memory', params), signal);
    if (result?.error) {
      const error = new Error(safeCode(result.error));
      error.code = safeCode(result.error);
      throw error;
    }
    return result?.data;
  }, { kind: 'write', idempotent: true, retries: 2, timeout: 12000 });
}

/**
 * 兼容 notebook / identity seed 的权威非聊天写入。
 * 禁止 ai_extracted；user_explicit 必须改走 saveExplicitMemory 并携带原消息 id。
 */
export async function upsertMemory(input = {}) {
  const subject = normalizeSubject(input.subject || input.user_id);
  const memoryType = normalizeType(input.memory_type);
  const content = String(input.content || '').trim();
  const source = input.source || 'manual';
  if (!content) return null;

  if (source === 'ai_extracted') {
    console.warn('[momiMemory] 已拒绝旧 AI 整段对话记忆写入: untrusted_source');
    return null;
  }
  if (source === 'user_explicit') {
    if (!input.source_ref) {
      console.warn('[momiMemory] 显式记忆缺少原消息 id，已拒绝: missing_source_message_id');
      return null;
    }
    return saveExplicitMemory(input.raw_message || content, subject, input.source_ref);
  }

  const sourceType = source === 'seed' ? 'seed' : (source === 'db_sync' ? 'structured_data' : 'manual');
  const subjectType = subject === 'both' || subject === 'momi' ? 'couple' : 'user';
  const visibility = input.visibility_scope || (subjectType === 'couple' ? 'couple' : 'private');
  const memoryKey = input.memory_key || buildMemoryKey(content, memoryType);
  const sourceUserId = subjectType === 'user' ? subject : null;

  try {
    const data = await callMemoryRpc({
      p_operation: 'update',
      p_couple_id: MEMORY_COUPLE_ID,
      p_subject: subject,
      p_subject_type: subjectType,
      p_visibility_scope: visibility,
      p_category: memoryType,
      p_memory_key: memoryKey,
      p_content: content,
      p_search_text: content,
      p_keywords: Array.isArray(input.keywords) && input.keywords.length
        ? input.keywords.slice(0, 30)
        : tokenizeMemoryText(content).slice(0, 30),
      p_confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 1))),
      p_importance: Math.max(1, Math.min(5, Number(input.importance) || 3)),
      p_explicitness: sourceType === 'manual' ? 'explicit' : 'system',
      p_source_type: sourceType,
      p_source_message_id: input.source_ref || null,
      p_source_user_id: sourceUserId,
      p_evidence_excerpt: null,
      p_valid_from: new Date().toISOString(),
      p_expires_at: input.expires_at || null,
    });
    return Array.isArray(data) ? data[0] || null : data || null;
  } catch (error) {
    console.warn('[momiMemory] notebook/seed 写入失败:', safeCode(error));
    return null;
  }
}

export async function ensureIdentitySeeds() {
  const results = [];
  for (const content of MOMI_IDENTITY_SEEDS) {
    const row = await upsertMemory({
      subject: 'momi',
      memory_type: 'identity',
      content,
      keywords: tokenizeMemoryText(content),
      importance: 5,
      confidence: 1,
      source: 'seed',
      source_ref: 'momi-v2-seed',
      memory_key: `identity:${normalizeIdentitySeed(content)}`,
    });
    if (row) results.push(row);
  }
  return results;
}

function normalizeIdentitySeed(content) {
  return tokenizeMemoryText(content).slice(0, 4).join('-') || 'momi';
}

/**
 * 兼容 UI/旧测试的纯解析；真正落库仍必须由 saveExplicitMemory 回查 sourceRef。
 */
export function parseExplicitMemory(text, userId) {
  const raw = String(text || '').trim();
  if (!raw || DISALLOWED_EXPLICIT_PATTERN.test(raw)) return null;
  const match = raw.match(/(?:请你)?(?:记住|记一下|别忘了|你要知道|以后都)(?:：|:|,|，|\s)*(.*)/i);
  if (!match || !match[1]?.trim()) return null;
  const content = match[1].trim().replace(/[。！!]+$/, '');
  let memoryType = 'fact';
  if (/喜欢|爱吃|爱喝|偏爱/.test(content)) memoryType = 'preference';
  else if (/不吃|讨厌|不喜欢|不能|忌口/.test(content)) memoryType = 'dislike';
  else if (/每天|习惯|通常|经常/.test(content)) memoryType = 'habit';
  else if (/约定|答应|承诺/.test(content)) memoryType = 'promise';
  else if (/纪念日|第一次|周年|生日/.test(content)) memoryType = 'milestone';
  return {
    subject: normalizeSubject(userId),
    memory_type: memoryType,
    content,
    keywords: tokenizeMemoryText(content).slice(0, 30),
    importance: 5,
    confidence: 1,
    source: 'user_explicit',
  };
}

export async function saveExplicitMemory(text, userId, sourceRef) {
  if (!sourceRef) {
    console.warn('[momiMemory] 显式记忆未保存: missing_source_message_id');
    return null;
  }
  const result = await processPersistedUserMessage({
    messageId: sourceRef,
    userId,
    content: text,
    senderType: 'user',
  });
  return result.writes[0] || null;
}

/**
 * 兼容旧调用的可信查询包装。没有 actor 时返回零条，不再跨用户全表召回。
 */
export async function getRelevantMemories(message, limit = 15, context = {}) {
  const options = typeof limit === 'object' ? limit : context;
  const actorId = normalizeMomiActor(options.actorId || options.userId);
  if (!actorId) {
    return {
      identity: [],
      related: [],
      block: buildVerifiedMemoryBlock([], 'none'),
      memoryGrounding: { state: 'none', usedCount: 0, attributionAllowed: false },
    };
  }
  const result = await retrieveMemoryContext(message, {
    ...options,
    actorId,
    limit: typeof limit === 'number' ? limit : 15,
  });
  return {
    identity: [],
    related: (result.entries || []).map((entry) => entry.memory || entry),
    block: result.block,
    memoryGrounding: result.grounding,
    evidence: result.evidence,
  };
}

/**
 * 旧的“每 20 条整段交给 AI 抽取”会把 assistant 文案反向写成事实，永久禁用。
 * 调用保留为 no-op，避免旧页面崩溃；唯一入口是 processPersistedUserMessage。
 */
export async function extractAndSaveMemories() {
  if (!warnedLegacyExtraction) {
    warnedLegacyExtraction = true;
    console.warn('[momiMemory] 已停用整段聊天 AI 记忆抽取: user_message_only');
  }
  return [];
}

async function readMaintenanceTime() {
  try {
    return await AsyncStorage.getItem(MAINTENANCE_KEY);
  } catch (error) {
    console.warn('[momiMemory] 读取维护时间失败:', safeCode(error));
    return null;
  }
}

export async function runMemoryMaintenance() {
  const lastRaw = await readMaintenanceTime();
  if (lastRaw && Date.now() - Number(lastRaw) < ONE_DAY_MS) return { skipped: true };
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 90 * ONE_DAY_MS).toISOString();
  try {
    const expiredResult = await fetchWithTimeout((signal) => withAbort(
      supabase
        .from('momi_memory')
        .update({ status: 'superseded', valid_to: now, updated_at: now })
        .eq('couple_id', MEMORY_COUPLE_ID)
        .eq('status', 'active')
        .not('expires_at', 'is', null)
        .lte('expires_at', now),
      signal
    ), { kind: 'write', idempotent: true, retries: 1 });
    if (expiredResult?.error) throw expiredResult.error;

    const staleResult = await fetchWithTimeout((signal) => withAbort(
      supabase
        .from('momi_memory')
        .update({ status: 'unverified', updated_at: now })
        .eq('couple_id', MEMORY_COUPLE_ID)
        .eq('status', 'active')
        .eq('explicitness', 'inferred')
        .lte('confidence', 0.7)
        .lte('created_at', cutoff),
      signal
    ), { kind: 'write', idempotent: true, retries: 1 });
    if (staleResult?.error) throw staleResult.error;

    try {
      await AsyncStorage.setItem(MAINTENANCE_KEY, String(Date.now()));
    } catch (storageError) {
      console.warn('[momiMemory] 保存维护时间失败:', safeCode(storageError));
    }
    return { skipped: false };
  } catch (error) {
    console.warn('[momiMemory] 维护失败:', safeCode(error));
    return { skipped: false, errorCode: safeCode(error) };
  }
}

// 「momi 的小本本」界面 CRUD：unverified 仍可见供确认，但不会进入 prompt。
export async function listMemories({ includeArchived = false } = {}) {
  let query = supabase.from('momi_memory').select('*').eq('couple_id', MEMORY_COUPLE_ID);
  if (!includeArchived) query = query.eq('is_archived', false);
  const { data, error } = await query.order('subject').order('importance', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function updateMemory(id, patch = {}) {
  const currentResult = await supabase.from('momi_memory').select('*').eq('id', id).maybeSingle();
  if (currentResult.error) throw currentResult.error;
  if (!currentResult.data) return null;

  const current = currentResult.data;
  const safe = {};
  if (patch.content !== undefined) {
    safe.content = String(patch.content).trim();
    safe.normalized_value = safe.content;
    safe.search_text = safe.content;
    safe.keywords = tokenizeMemoryText(safe.content).slice(0, 30);
    safe.memory_key = buildMemoryKey(safe.content, normalizeType(patch.memory_type || current.memory_type));
    safe.source = 'manual';
    safe.source_type = 'manual';
    safe.source_ref = null;
    safe.source_message_id = null;
    safe.source_user_id = null;
    safe.evidence_excerpt = null;
    safe.explicitness = 'explicit';
    safe.status = 'active';
  }
  if (patch.subject !== undefined) {
    safe.subject = normalizeSubject(patch.subject);
    safe.user_id = safe.subject === 'momi' ? 'both' : safe.subject;
    safe.subject_type = safe.subject === 'both' || safe.subject === 'momi' ? 'couple' : 'user';
    safe.visibility_scope = safe.subject_type === 'couple' ? 'couple' : 'private';
  }
  if (patch.memory_type !== undefined) {
    safe.memory_type = normalizeType(patch.memory_type);
    safe.category = safe.memory_type;
  }
  if (patch.importance !== undefined) safe.importance = Math.max(1, Math.min(5, Number(patch.importance)));
  if (patch.is_archived !== undefined) {
    safe.is_archived = Boolean(patch.is_archived);
    if (safe.is_archived) safe.status = 'deleted';
  }
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
    ...input,
    source: 'manual',
    importance: input.importance || 5,
    confidence: 1,
  });
}

export function formatMemoryBlock(memories = {}) {
  if (memories.block) return memories.block;
  if (!Array.isArray(memories.related) || memories.related.length === 0) {
    return buildVerifiedMemoryBlock([], 'none');
  }
  const entries = memories.related.map((memory) => ({
    memory,
    scoring: {
      sourceType: memory.source_type || memory.source || 'unknown',
      allowUserSaid: Boolean(memory.source_message_id && memory.source_user_id),
    },
  }));
  return buildVerifiedMemoryBlock(entries, 'verified');
}

export { processPersistedUserMessage, retrieveMemoryContext };
