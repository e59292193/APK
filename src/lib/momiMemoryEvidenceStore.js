// ═══════════════════════════════════════════════════════
// momiMemoryEvidenceStore.js —— Supabase 权威证据账本适配层
//
// 只处理已经持久化的 user message。所有写入先走纯函数 evidence firewall，
// 再调用数据库原子 RPC；迁移/RPC 不可用时安全降级为“不使用长期记忆”。
// Hindsight / Graphiti 仅可把候选交回本层复核，不能直接注入 prompt。
// ═══════════════════════════════════════════════════════

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

function safeRpcError(error, fallbackCode) {
  const wrapped = new Error(safeCode(error) || fallbackCode);
  wrapped.code = safeCode(error) || fallbackCode;
  return wrapped;
}

function withAbort(builder, signal) {
  if (signal && typeof builder?.abortSignal === 'function') return builder.abortSignal(signal);
  return builder;
}

async function callRpc(name, params) {
  return fetchWithTimeout(async (signal) => {
    const result = await withAbort(supabase.rpc(name, params), signal);
    if (result?.error) throw safeRpcError(result.error, 'RPC_FAILED');
    return result?.data;
  }, {
    kind: 'write',
    idempotent: true,
    retries: 2,
    timeout: 12000,
  });
}

async function runRead(buildQuery) {
  return fetchWithTimeout(async (signal) => {
    const result = await withAbort(buildQuery(), signal);
    if (result?.error) throw safeRpcError(result.error, 'READ_FAILED');
    return result?.data || [];
  }, {
    kind: 'read',
    retries: 2,
    timeout: 10000,
  });
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

/**
 * 写入一条已校验候选。禁止非原子 direct insert 兜底：RPC 不可用时宁可不写。
 */
export async function applyMemoryOperation(operation, rawMessage, context = {}) {
  const checked = validateMemoryOperation(operation, rawMessage, context);
  if (!checked.valid) {
    return { status: 'rejected', reason: checked.reason, memory: null };
  }
  if (checked.operation.operation === 'forget') {
    return forgetMemories({ operation: checked.operation, context });
  }

  try {
    const data = await callRpc('apply_verified_momi_memory', toRpcParams(checked.operation));
    const memory = Array.isArray(data) ? data[0] || null : data || null;
    if (!memory) return { status: 'error', reason: 'empty_rpc_result', memory: null };
    return { status: 'saved', reason: null, memory };
  } catch (error) {
    const code = safeCode(error);
    console.warn('[momiMemory] 原子记忆写入失败:', code);
    return {
      status: 'error',
      reason: SCHEMA_ERROR_CODES.has(code) ? 'migration_required' : 'write_failed',
      memory: null,
      errorCode: code,
    };
  }
}

/**
 * 用户忘记请求：RPC 会同事务标记 deleted + 建 pending propagation event。
 * completedPropagation=false 表示尚不能向用户宣称 Hindsight/Graphiti 已彻底删除。
 */
export async function forgetMemories({ operation, context = {} } = {}) {
  const actorId = normalizeMomiActor(context.actorId || context.userId || operation?.source_user_id);
  if (!operation || !actorId) {
    return { status: 'rejected', reason: 'invalid_forget_request', count: 0, completedPropagation: false };
  }
  try {
    const data = await callRpc('forget_verified_momi_memories', {
      p_couple_id: MEMORY_COUPLE_ID,
      p_actor_id: actorId,
      p_subject: operationSubject(operation),
      p_memory_key: operation.memory_key || null,
      p_source_message_id: operation.source_message_id || null,
    });
    const count = Math.max(0, Number(data) || 0);
    return {
      status: count > 0 ? 'pending_propagation' : 'not_found',
      reason: null,
      count,
      completedPropagation: false,
    };
  } catch (error) {
    const code = safeCode(error);
    console.warn('[momiMemory] 忘记请求入账失败:', code);
    return {
      status: 'error',
      reason: SCHEMA_ERROR_CODES.has(code) ? 'migration_required' : 'forget_failed',
      count: 0,
      completedPropagation: false,
      errorCode: code,
    };
  }
}

/**
 * 唯一自动写入入口：调用者必须先成功保存 user message 并传入稳定 id。
 */
export async function processPersistedUserMessage({
  messageId,
  userId,
  content,
  createdAt,
  senderType = 'user',
} = {}) {
  const actorId = normalizeMomiActor(userId);
  const context = {
    actorId,
    userId: actorId,
    senderType,
    sourceMessageId: messageId || null,
  };
  const candidates = extractMemoryOperations(content, context);
  const results = [];
  for (const candidate of candidates) {
    if (candidate.operation === 'none') {
      results.push({ status: 'rejected', reason: candidate.reason, memory: null });
      continue;
    }
    // 顺序执行，保证同一条消息中的纠正/忘记状态稳定。
    const result = await applyMemoryOperation({
      ...candidate,
      event_time: createdAt || new Date().toISOString(),
    }, content, context);
    results.push(result);
  }
  return {
    processed: results.some((item) => item.status !== 'rejected'),
    writes: results.filter((item) => item.status === 'saved').map((item) => item.memory),
    results,
  };
}

function candidateQuery(actorId, limit) {
  return supabase
    .from('momi_memory')
    .select('id,couple_id,subject,subject_type,subject_user_id,visibility_scope,category,memory_type,memory_key,content,confidence,importance,explicitness,status,source_type,source_message_id,source_user_id,evidence_excerpt,valid_from,valid_to,expires_at,last_confirmed_at,created_at,updated_at')
    .eq('couple_id', MEMORY_COUPLE_ID)
    .eq('status', 'active')
    .in('subject', [actorId, 'both'])
    .gte('confidence', MEMORY_MIN_CONFIDENCE)
    .limit(limit);
}

/**
 * Supabase 原始账本 + 外部派生候选统一复核；任何结果都重新过 hard filter/score。
 */
export async function retrieveVerifiedMemories(query, {
  actorId,
  subjectUserId,
  derivedCandidates = [],
  limit = MAX_MEMORY_CANDIDATES,
  now,
  queryKey,
} = {}) {
  const actor = normalizeMomiActor(actorId);
  if (!actor) {
    return {
      state: 'error', entries: [], block: buildVerifiedMemoryBlock([], 'error'),
      grounding: createMemoryGrounding([], 'error'), reason: 'invalid_actor',
    };
  }

  try {
    const rows = await runRead(() => candidateQuery(actor, Math.min(MAX_MEMORY_CANDIDATES, limit)));
    const entries = rankMemoryCandidates([...rows, ...derivedCandidates], query, {
      actorId: actor,
      subjectUserId: normalizeMomiActor(subjectUserId) || actor,
      coupleId: MEMORY_COUPLE_ID,
      now,
      queryKey,
    });
    const state = entries.length ? 'verified' : 'none';
    return {
      state,
      entries,
      block: buildVerifiedMemoryBlock(entries, state),
      grounding: createMemoryGrounding(entries, state),
      reason: null,
    };
  } catch (error) {
    const code = safeCode(error);
    console.warn('[momiMemory] 可信记忆检索降级:', code);
    return {
      state: 'error', entries: [], block: buildVerifiedMemoryBlock([], 'error'),
      grounding: createMemoryGrounding([], 'error'),
      reason: SCHEMA_ERROR_CODES.has(code) ? 'migration_required' : 'retrieval_failed',
      errorCode: code,
    };
  }
}

function buildMessageQuery(actorId, limit, useV5Columns) {
  const columns = useV5Columns
    ? 'id,sender,sender_type,sender_user_id,content,created_at'
    : 'id,sender,content,created_at';
  let query = supabase
    .from('momi_assistant_messages')
    .select(columns)
    .eq('couple_id', MEMORY_COUPLE_ID)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (useV5Columns) {
    query = query.eq('sender_type', 'user').eq('sender_user_id', actorId);
  } else {
    query = query.eq('sender', actorId);
  }
  return query;
}

/**
 * “我说过吗”专用证据查询。V5 未执行时只回退到旧 sender 列，仍不采信 assistant。
 */
export async function findPersistedUserMessageEvidence(query, actorId, limit = MAX_EVIDENCE_MESSAGES) {
  const actor = normalizeMomiActor(actorId);
  if (!actor) return { state: 'error', matches: [], reason: 'invalid_actor' };
  const cappedLimit = Math.min(MAX_EVIDENCE_MESSAGES, Math.max(1, Number(limit) || MAX_EVIDENCE_MESSAGES));

  try {
    const rows = await runRead(() => buildMessageQuery(actor, cappedLimit, true));
    return { ...findUserMessageEvidence(query, actor, rows), reason: null };
  } catch (error) {
    const code = safeCode(error);
    if (!SCHEMA_ERROR_CODES.has(code)) {
      console.warn('[momiMemory] 原始消息证据检索失败:', code);
      return { state: 'error', matches: [], reason: 'evidence_query_failed', errorCode: code };
    }
    console.warn('[momiMemory] V5 消息字段未就绪，使用旧 sender 证据查询:', code);
    try {
      const legacyRows = await runRead(() => buildMessageQuery(actor, cappedLimit, false));
      const normalized = legacyRows.map((row) => ({
        ...row,
        sender_type: row.sender === 'momi' ? 'assistant' : 'user',
        sender_user_id: row.sender === 'momi' ? null : row.sender,
      }));
      return { ...findUserMessageEvidence(query, actor, normalized), reason: 'legacy_schema' };
    } catch (legacyError) {
      const legacyCode = safeCode(legacyError);
      console.warn('[momiMemory] 旧消息证据查询也失败:', legacyCode);
      return { state: 'error', matches: [], reason: 'evidence_query_failed', errorCode: legacyCode };
    }
  }
}

function evidenceBlock(result, actorId) {
  if (result.state !== 'verified' || !result.matches.length) {
    return result.state === 'error'
      ? '【原始用户消息证据：查询失败；禁止使用“你说过”】'
      : '【原始用户消息证据：未找到；必须承认可能记错，禁止强行归因】';
  }
  const lines = ['【原始用户消息证据】'];
  for (const message of result.matches.slice(0, 3)) {
    const excerpt = String(message.content || '').slice(0, 120);
    lines.push(`- 说话人=${actorId}；时间=${message.created_at || '未知'}；原文片段=${excerpt}；allow_user_said=true`);
  }
  return lines.join('\n');
}

/**
 * 对话层唯一读取入口：证据追问与普通个性化走不同路由。
 */
export async function retrieveMemoryContext(query, context = {}) {
  const actorId = normalizeMomiActor(context.actorId || context.userId);
  if (isEvidenceQuery(query)) {
    const evidence = await findPersistedUserMessageEvidence(query, actorId);
    const state = evidence.state === 'verified' ? 'verified' : (evidence.state === 'error' ? 'error' : 'none');
    return {
      state,
      entries: [],
      evidence,
      block: evidenceBlock(evidence, actorId),
      grounding: { state, usedCount: evidence.matches.length, attributionAllowed: state === 'verified' },
    };
  }
  return retrieveVerifiedMemories(query, { ...context, actorId });
}
