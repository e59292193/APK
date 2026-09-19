// Supabase 权威记忆证据账本：RPC 优先，兼容旧库时安全直写降级
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import {
  MEMORY_COUPLE_ID,
  MEMORY_MIN_CONFIDENCE,
  buildVerifiedMemoryBlock,
  createMemoryGrounding,
  extractMemoryOperations,
  findUserMessageEvidence,
  normalizeMomiActor,
  rankMemoryCandidates,
  tokenizeMemoryText,
  validateMemoryOperation,
} from './momiMemoryOrchestrator';

const MAX_MEMORY_CANDIDATES = 80;
const MAX_EVIDENCE_MESSAGES = 80;
const SCHEMA_ERROR_CODES = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204']);
const EVIDENCE_QUERY_PATTERN = /(我(?:什么时候)?说过|我提过|我们聊过|为什么(?:会)?觉得|你为什么觉得)/;

function safeCode(error) {
  return String(error?.code || error?.name || 'UNKNOWN').slice(0, 80);
}
function wrappedError(error, fallback) {
  const value = new Error(safeCode(error) || fallback);
  value.code = safeCode(error) || fallback;
  return value;
}
function withAbort(builder, signal) {
  return signal && typeof builder?.abortSignal === 'function' ? builder.abortSignal(signal) : builder;
}
async function callRpc(name, params) {
  return fetchWithTimeout(async (signal) => {
    const result = await withAbort(supabase.rpc(name, params), signal);
    if (result?.error) throw wrappedError(result.error, 'RPC_FAILED');
    return result?.data;
  }, { kind: 'write', idempotent: true, retries: 2, timeout: 12000 });
}
async function runRead(buildQuery) {
  return fetchWithTimeout(async (signal) => {
    const result = await withAbort(buildQuery(), signal);
    if (result?.error) throw wrappedError(result.error, 'READ_FAILED');
    return result?.data || [];
  }, { kind: 'read', retries: 2, timeout: 10000 });
}
function operationSubject(operation) {
  return operation.subject_type === 'couple' ? 'both' : normalizeMomiActor(operation.subject_user_id);
}
function toRpcParams(operation) {
  return {
    p_operation: operation.operation,
    p_couple_id: MEMORY_COUPLE_ID,
    p_subject: operationSubject(operation),
    p_subject_type: operation.subject_type,
    p_visibility_scope: operation.visibility_scope,
    p_category: operation.category || 'other',
    p_memory_key: operation.memory_key,
    p_content: operation.memory_value,
    p_search_text: operation.memory_value,
    p_keywords: tokenizeMemoryText(`${operation.memory_key} ${operation.memory_value}`).slice(0, 30),
    p_confidence: operation.confidence,
    p_importance: operation.importance,
    p_explicitness: operation.explicitness || 'direct',
    p_source_type: operation.source_type,
    p_source_message_id: operation.source_message_id,
    p_source_user_id: operation.source_user_id,
    p_evidence_excerpt: operation.evidence_excerpt,
    p_valid_from: operation.event_time || new Date().toISOString(),
    p_expires_at: operation.expires_at || null,
  };
}

export function isEvidenceQuery(message) {
  return EVIDENCE_QUERY_PATTERN.test(String(message || ''));
}

/** RPC 未部署时的兼容写入；仍保留原消息 id、说话人和原文证据。 */
async function saveVerifiedMemoryFallback(operation) {
  const subject = operationSubject(operation);
  const now = operation.event_time || new Date().toISOString();
  const keywords = tokenizeMemoryText(`${operation.memory_key} ${operation.memory_value}`).slice(0, 30);
  const fullPayload = {
    couple_id: MEMORY_COUPLE_ID,
    user_id: subject,
    subject,
    subject_type: operation.subject_type,
    subject_user_id: operation.subject_type === 'user' ? operation.subject_user_id : null,
    visibility_scope: operation.visibility_scope,
    memory_type: operation.category || 'fact',
    category: operation.category || 'fact',
    memory_key: operation.memory_key,
    content: operation.memory_value,
    normalized_value: operation.memory_value,
    search_text: operation.memory_value,
    keywords,
    importance: operation.importance,
    confidence: operation.confidence,
    explicitness: operation.explicitness || 'explicit',
    source: operation.source_type === 'explicit_command' ? 'user_explicit' : 'user_message',
    source_type: operation.source_type,
    source_ref: operation.source_message_id,
    source_message_id: operation.source_message_id,
    source_user_id: operation.source_user_id,
    evidence_excerpt: operation.evidence_excerpt,
    status: 'active',
    valid_from: now,
    last_confirmed_at: now,
    is_archived: false,
    updated_at: now,
  };

  try {
    const { data: existing } = await supabase.from('momi_memory')
      .select('id,content')
      .eq('couple_id', MEMORY_COUPLE_ID)
      .eq('subject', subject)
      .eq('memory_key', operation.memory_key)
      .eq('status', 'active')
      .limit(1);
    if (existing?.[0]?.id) {
      const { data, error } = await supabase.from('momi_memory')
        .update(fullPayload)
        .eq('id', existing[0].id)
        .select();
      if (!error && data?.[0]) return data[0];
      if (error && !SCHEMA_ERROR_CODES.has(safeCode(error))) throw error;
    }

    const { data, error } = await supabase.from('momi_memory').insert([fullPayload]).select();
    if (!error && data?.[0]) return data[0];
    if (error && !SCHEMA_ERROR_CODES.has(safeCode(error))) throw error;
  } catch (error) {
    if (!SCHEMA_ERROR_CODES.has(safeCode(error))) throw error;
  }

  // V1-V4 旧表最小列降级，保证“小本本”真实可见，不伪报成功。
  const legacyPayload = {
    couple_id: MEMORY_COUPLE_ID,
    user_id: subject,
    subject,
    memory_type: operation.category || 'fact',
    content: operation.memory_value,
    keywords,
    importance: operation.importance,
    confidence: operation.confidence,
    source: 'user_explicit',
    source_ref: operation.source_message_id,
    is_archived: false,
    updated_at: now,
  };
  const { data, error } = await supabase.from('momi_memory').insert([legacyPayload]).select();
  if (error) throw error;
  return data?.[0] || null;
}

export async function applyMemoryOperation(operation, rawMessage, context = {}) {
  const checked = validateMemoryOperation(operation, rawMessage, context);
  if (!checked.valid) return { status: 'rejected', reason: checked.reason, memory: null };
  if (checked.operation.operation === 'forget') return forgetMemories({ operation: checked.operation, context });

  try {
    const data = await callRpc('apply_verified_momi_memory', toRpcParams(checked.operation));
    const memory = Array.isArray(data) ? data[0] || null : data || null;
    if (memory) return { status: 'saved', reason: null, memory };
    throw wrappedError({ code: 'EMPTY_RPC_RESULT' }, 'EMPTY_RPC_RESULT');
  } catch (error) {
    const code = safeCode(error);
    if (!SCHEMA_ERROR_CODES.has(code) && code !== 'EMPTY_RPC_RESULT') {
      console.warn('[momiMemory] 原子记忆写入失败:', code);
      return { status: 'error', reason: 'write_failed', memory: null, errorCode: code };
    }
    try {
      const memory = await saveVerifiedMemoryFallback(checked.operation);
      if (!memory) throw wrappedError({ code: 'EMPTY_FALLBACK_RESULT' }, 'EMPTY_FALLBACK_RESULT');
      console.warn('[momiMemory] RPC 未就绪，已使用兼容写入:', code);
      return { status: 'saved', reason: 'compatibility_fallback', memory };
    } catch (fallbackError) {
      const fallbackCode = safeCode(fallbackError);
      console.warn('[momiMemory] 兼容记忆写入失败:', fallbackCode);
      return { status: 'error', reason: 'write_failed', memory: null, errorCode: fallbackCode };
    }
  }
}

export async function forgetMemories({ operation, context = {} } = {}) {
  const actorId = normalizeMomiActor(context.actorId || context.userId || operation?.source_user_id);
  if (!operation || !actorId) return { status: 'rejected', reason: 'invalid_forget_request', count: 0, completedPropagation: false };
  try {
    const data = await callRpc('forget_verified_momi_memories', {
      p_couple_id: MEMORY_COUPLE_ID,
      p_actor_id: actorId,
      p_subject: operationSubject(operation),
      p_memory_key: operation.memory_key || null,
      p_source_message_id: operation.source_message_id || null,
    });
    const count = Math.max(0, Number(data) || 0);
    return { status: count ? 'pending_propagation' : 'not_found', reason: null, count, completedPropagation: false };
  } catch (error) {
    const code = safeCode(error);
    console.warn('[momiMemory] 忘记请求入账失败:', code);
    return { status: 'error', reason: SCHEMA_ERROR_CODES.has(code) ? 'migration_required' : 'forget_failed', count: 0, completedPropagation: false, errorCode: code };
  }
}

export async function processPersistedUserMessage({ messageId, userId, content, createdAt, senderType = 'user' } = {}) {
  const actorId = normalizeMomiActor(userId);
  const context = { actorId, userId: actorId, senderType, sourceMessageId: messageId || null };
  const candidates = extractMemoryOperations(content, context);
  const results = [];
  for (const candidate of candidates) {
    if (candidate.operation === 'none') {
      results.push({ status: 'rejected', reason: candidate.reason, memory: null });
    } else {
      // eslint-disable-next-line no-await-in-loop
      results.push(await applyMemoryOperation({ ...candidate, event_time: createdAt || new Date().toISOString() }, content, context));
    }
  }
  return {
    processed: results.some((item) => item.status !== 'rejected'),
    writes: results.filter((item) => item.status === 'saved').map((item) => item.memory),
    results,
  };
}

function candidateQuery(actorId, limit) {
  return supabase.from('momi_memory')
    .select('id,couple_id,subject,subject_type,subject_user_id,visibility_scope,category,memory_type,memory_key,content,confidence,importance,explicitness,status,source_type,source_message_id,source_user_id,evidence_excerpt,valid_from,valid_to,expires_at,last_confirmed_at,created_at,updated_at')
    .eq('couple_id', MEMORY_COUPLE_ID).eq('status', 'active').in('subject', [actorId, 'both'])
    .gte('confidence', MEMORY_MIN_CONFIDENCE).limit(limit);
}

export async function retrieveVerifiedMemories(query, { actorId, subjectUserId, derivedCandidates = [], limit = MAX_MEMORY_CANDIDATES, now, queryKey } = {}) {
  const actor = normalizeMomiActor(actorId);
  if (!actor) return { state: 'error', entries: [], block: buildVerifiedMemoryBlock([], 'error'), grounding: createMemoryGrounding([], 'error'), reason: 'invalid_actor' };
  try {
    const rows = await runRead(() => candidateQuery(actor, Math.min(MAX_MEMORY_CANDIDATES, limit)));
    const entries = rankMemoryCandidates([...rows, ...derivedCandidates], query, {
      actorId: actor, subjectUserId: normalizeMomiActor(subjectUserId) || actor,
      coupleId: MEMORY_COUPLE_ID, now, queryKey,
    });
    const state = entries.length ? 'verified' : 'none';
    return { state, entries, block: buildVerifiedMemoryBlock(entries, state), grounding: createMemoryGrounding(entries, state), reason: null };
  } catch (error) {
    const code = safeCode(error);
    console.warn('[momiMemory] 可信记忆检索降级:', code);
    return { state: 'error', entries: [], block: buildVerifiedMemoryBlock([], 'error'), grounding: createMemoryGrounding([], 'error'), reason: SCHEMA_ERROR_CODES.has(code) ? 'migration_required' : 'retrieval_failed', errorCode: code };
  }
}

function buildMessageQuery(actorId, limit, useV5Columns) {
  const columns = useV5Columns ? 'id,sender,sender_type,sender_user_id,content,created_at' : 'id,sender,content,created_at';
  let query = supabase.from('momi_assistant_messages').select(columns)
    .eq('couple_id', MEMORY_COUPLE_ID).order('created_at', { ascending: false }).limit(limit);
  return useV5Columns ? query.eq('sender_type', 'user').eq('sender_user_id', actorId) : query.eq('sender', actorId);
}

export async function findPersistedUserMessageEvidence(query, actorId, limit = MAX_EVIDENCE_MESSAGES) {
  const actor = normalizeMomiActor(actorId);
  if (!actor) return { state: 'error', matches: [], reason: 'invalid_actor' };
  const capped = Math.min(MAX_EVIDENCE_MESSAGES, Math.max(1, Number(limit) || MAX_EVIDENCE_MESSAGES));
  try {
    const rows = await runRead(() => buildMessageQuery(actor, capped, true));
    return { ...findUserMessageEvidence(query, actor, rows), reason: null };
  } catch (error) {
    const code = safeCode(error);
    if (!SCHEMA_ERROR_CODES.has(code)) return { state: 'error', matches: [], reason: 'evidence_query_failed', errorCode: code };
    try {
      const rows = await runRead(() => buildMessageQuery(actor, capped, false));
      const normalized = rows.map((row) => ({ ...row, sender_type: row.sender === 'momi' ? 'assistant' : 'user', sender_user_id: row.sender === 'momi' ? null : row.sender }));
      return { ...findUserMessageEvidence(query, actor, normalized), reason: 'legacy_schema' };
    } catch (legacyError) {
      return { state: 'error', matches: [], reason: 'evidence_query_failed', errorCode: safeCode(legacyError) };
    }
  }
}

function evidenceBlock(result, actorId) {
  if (result.state !== 'verified' || !result.matches.length) {
    return result.state === 'error' ? '【原始用户消息证据：查询失败；禁止使用“你说过”】' : '【原始用户消息证据：未找到；必须承认可能记错，禁止强行归因】';
  }
  return ['【原始用户消息证据】', ...result.matches.slice(0, 3).map((item) => `- 说话人=${actorId}；时间=${item.created_at || '未知'}；原文片段=${String(item.content || '').slice(0, 120)}；allow_user_said=true`)].join('\n');
}

export async function retrieveMemoryContext(query, context = {}) {
  const actorId = normalizeMomiActor(context.actorId || context.userId);
  if (isEvidenceQuery(query)) {
    const evidence = await findPersistedUserMessageEvidence(query, actorId);
    const state = evidence.state === 'verified' ? 'verified' : (evidence.state === 'error' ? 'error' : 'none');
    return { state, entries: [], evidence, block: evidenceBlock(evidence, actorId), grounding: { state, usedCount: evidence.matches.length, attributionAllowed: state === 'verified' } };
  }
  return retrieveVerifiedMemories(query, { ...context, actorId });
}
