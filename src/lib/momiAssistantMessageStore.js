// ═══════════════════════════════════════════════════════
// momiAssistantMessageStore.js —— 助手聊天权威消息存储 / 离线 outbox
//
// 目标：本地先落盘、云端按 client_message_id 幂等、恢复时稳定合并，
// 不让云端快照覆盖尚未同步的本地消息。该层不负责调用模型。
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { normalizeMomiActor } from './momiMemoryOrchestrator';

export const ASSISTANT_COUPLE_ID = 'momo_and_baomi';
export const ASSISTANT_MESSAGE_CACHE_KEY = '@momi_assistant_messages_local';
export const ASSISTANT_MESSAGE_OUTBOX_KEY = '@momi_assistant_messages_outbox_v5';

const MAX_CACHE_MESSAGES = 300;
const MAX_OUTBOX_MESSAGES = 100;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;
const SCHEMA_ERROR_CODES = new Set(['42P01', '42703', 'PGRST204']);
let localMutationQueue = Promise.resolve();

function safeErrorCode(error) {
  return String(error?.code || error?.name || 'UNKNOWN').slice(0, 80);
}

function sanitizedError(error, fallback = 'MESSAGE_STORE_FAILED') {
  const code = safeErrorCode(error) || fallback;
  const wrapped = new Error(code);
  wrapped.code = code;
  return wrapped;
}

function withAbort(builder, signal) {
  if (signal && typeof builder?.abortSignal === 'function') return builder.abortSignal(signal);
  return builder;
}

async function runQuery(buildQuery, options = {}) {
  return fetchWithTimeout(async (signal) => {
    const result = await withAbort(buildQuery(), signal);
    if (result?.error) throw sanitizedError(result.error);
    return result?.data;
  }, options);
}

function serializeLocalMutation(operation) {
  const result = localMutationQueue.then(operation, operation);
  localMutationQueue = result.catch((error) => {
    console.warn('[momiMessageStore] 本地写队列异常:', safeErrorCode(error));
  });
  return result;
}

async function readJsonArray(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[momiMessageStore] 本地数据读取失败:', safeErrorCode(error));
    return [];
  }
}

async function writeJsonArray(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[momiMessageStore] 本地数据写入失败:', safeErrorCode(error));
    throw sanitizedError(error, 'LOCAL_WRITE_FAILED');
  }
}

function randomSuffix() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function createAssistantClientMessageId(sender = 'message') {
  const normalizedSender = sender === 'momi' ? 'momi' : (normalizeMomiActor(sender) || 'message');
  return `${normalizedSender}-${randomSuffix()}`;
}

function senderMetadata(sender) {
  if (sender === 'momi') {
    return { sender: 'momi', sender_type: 'assistant', sender_user_id: null };
  }
  const actor = normalizeMomiActor(sender);
  if (!actor) throw sanitizedError({ code: 'INVALID_MESSAGE_ACTOR' });
  return { sender: actor, sender_type: 'user', sender_user_id: actor };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function normalizeAssistantMessage(message = {}) {
  const sender = message.sender_user_id || message.sender || (message.sender_type === 'assistant' ? 'momi' : null);
  const metadata = senderMetadata(sender);
  const createdAt = message.created_at || new Date().toISOString();
  const clientMessageId = message.client_message_id || createAssistantClientMessageId(metadata.sender);
  const resolvedId = message.id || `local:${clientMessageId}`;
  return {
    ...message,
    couple_id: ASSISTANT_COUPLE_ID,
    ...metadata,
    client_message_id: clientMessageId,
    id: resolvedId,
    cloud_persisted: message.cloud_persisted ?? !String(resolvedId).startsWith('local:'),
    content: String(message.content || ''),
    image_urls: normalizeArray(message.image_urls),
    image_paths: normalizeArray(message.image_paths),
    content_type: message.content_type || (normalizeArray(message.image_urls).length
      ? (message.content ? 'mixed' : 'image')
      : 'text'),
    is_proactive: Boolean(message.is_proactive),
    trigger_source: message.trigger_source || 'assistant',
    status: message.status || 'pending',
    reply_to_message_id: message.reply_to_message_id || null,
    generation_key: message.generation_key || null,
    server_sequence: message.server_sequence ?? null,
    created_at: createdAt,
    updated_at: message.updated_at || createdAt,
  };
}

export function assistantMessageStableKey(message = {}) {
  if (message.generation_key) return `generation:${message.generation_key}`;
  if (message.client_message_id) return `client:${message.client_message_id}`;
  if (message.id) return `id:${message.id}`;
  return `unknown:${message.sender || ''}:${message.created_at || ''}`;
}

function isCloudCanonical(message) {
  return Boolean(message.id && !String(message.id).startsWith('local:'));
}

function chooseCanonicalMessage(left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftCloud = isCloudCanonical(left);
  const rightCloud = isCloudCanonical(right);
  if (leftCloud !== rightCloud) return rightCloud ? { ...left, ...right } : { ...right, ...left };
  const leftUpdated = new Date(left.updated_at || left.created_at || 0).getTime();
  const rightUpdated = new Date(right.updated_at || right.created_at || 0).getTime();
  return rightUpdated >= leftUpdated ? { ...left, ...right } : { ...right, ...left };
}

export function compareAssistantMessages(left, right) {
  const hasLeftSequence = left.server_sequence !== null && left.server_sequence !== undefined;
  const hasRightSequence = right.server_sequence !== null && right.server_sequence !== undefined;
  const leftSequence = Number(left.server_sequence);
  const rightSequence = Number(right.server_sequence);
  if (hasLeftSequence && hasRightSequence
    && Number.isFinite(leftSequence) && Number.isFinite(rightSequence)
    && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  const leftTime = new Date(left.created_at || 0).getTime();
  const rightTime = new Date(right.created_at || 0).getTime();
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return assistantMessageStableKey(left).localeCompare(assistantMessageStableKey(right));
}

/**
 * 云端 canonical 行优先，但会保留本地 pending/error 行；绝不按正文去重。
 */
export function mergeAssistantMessages(...collections) {
  const merged = new Map();
  for (const collection of collections) {
    for (const raw of Array.isArray(collection) ? collection : []) {
      if (!raw || raw.couple_id && raw.couple_id !== ASSISTANT_COUPLE_ID) continue;
      let normalized;
      try {
        normalized = normalizeAssistantMessage(raw);
      } catch (error) {
        console.warn('[momiMessageStore] 跳过无效 actor 消息:', safeErrorCode(error));
        continue;
      }
      const key = assistantMessageStableKey(normalized);
      merged.set(key, chooseCanonicalMessage(merged.get(key), normalized));
    }
  }
  return Array.from(merged.values()).sort(compareAssistantMessages).slice(-MAX_CACHE_MESSAGES);
}

async function mutateLocalMessages(mutator) {
  return serializeLocalMutation(async () => {
    const current = await readJsonArray(ASSISTANT_MESSAGE_CACHE_KEY);
    const next = await mutator(current);
    const normalized = mergeAssistantMessages(next);
    await writeJsonArray(ASSISTANT_MESSAGE_CACHE_KEY, normalized);
    return normalized;
  });
}

async function mutateOutbox(mutator) {
  return serializeLocalMutation(async () => {
    const current = await readJsonArray(ASSISTANT_MESSAGE_OUTBOX_KEY);
    const next = await mutator(current);
    const capped = next.slice(-MAX_OUTBOX_MESSAGES);
    await writeJsonArray(ASSISTANT_MESSAGE_OUTBOX_KEY, capped);
    return capped;
  });
}

export async function cacheAssistantMessage(message) {
  const normalized = normalizeAssistantMessage(message);
  await mutateLocalMessages((current) => mergeAssistantMessages(current, [normalized]));
  return normalized;
}

function toCloudPayload(message) {
  return {
    couple_id: ASSISTANT_COUPLE_ID,
    sender: message.sender,
    sender_type: message.sender_type,
    sender_user_id: message.sender_user_id,
    content: message.content,
    image_urls: message.image_urls,
    image_paths: message.image_paths,
    content_type: message.content_type,
    is_proactive: message.is_proactive,
    trigger_source: message.trigger_source,
    client_message_id: message.client_message_id,
    reply_to_message_id: message.reply_to_message_id,
    generation_key: message.generation_key,
    status: 'synced',
    created_at: message.created_at,
    updated_at: new Date().toISOString(),
  };
}

async function findCanonicalByClientId(clientMessageId) {
  const rows = await runQuery(() => supabase
    .from('momi_assistant_messages')
    .select('*')
    .eq('couple_id', ASSISTANT_COUPLE_ID)
    .eq('client_message_id', clientMessageId)
    .limit(1), { kind: 'read', retries: 2, timeout: 10000 });
  return rows?.[0] || null;
}

async function findCanonicalByGenerationKey(generationKey) {
  if (!generationKey) return null;
  const rows = await runQuery(() => supabase
    .from('momi_assistant_messages')
    .select('*')
    .eq('couple_id', ASSISTANT_COUPLE_ID)
    .eq('generation_key', generationKey)
    .limit(1), { kind: 'read', retries: 2, timeout: 10000 });
  return rows?.[0] || null;
}

async function insertCanonicalMessage(message) {
  try {
    const rows = await runQuery(() => supabase
      .from('momi_assistant_messages')
      .insert([toCloudPayload(message)])
      .select(), { kind: 'write', idempotent: true, retries: 2, timeout: 12000 });
    return rows?.[0] || null;
  } catch (error) {
    if (safeErrorCode(error) === '23505') {
      const byClient = await findCanonicalByClientId(message.client_message_id);
      if (byClient) return byClient;
      const byGeneration = await findCanonicalByGenerationKey(message.generation_key);
      if (byGeneration) return byGeneration;
    }
    throw error;
  }
}

function retryDelay(attemptCount) {
  const exponent = Math.max(0, Math.min(5, Number(attemptCount) || 0));
  return Math.min(MAX_RETRY_DELAY_MS, 1000 * (2 ** exponent));
}

function outboxEntry(message, previous = {}) {
  const attemptCount = Number(previous.attempt_count || 0);
  return {
    message,
    client_message_id: message.client_message_id,
    attempt_count: attemptCount,
    next_retry_at: previous.next_retry_at || null,
    last_error_code: previous.last_error_code || null,
    enqueued_at: previous.enqueued_at || new Date().toISOString(),
  };
}

async function enqueueMessage(message) {
  await mutateOutbox((current) => {
    const index = current.findIndex((entry) => entry.client_message_id === message.client_message_id);
    if (index < 0) return [...current, outboxEntry(message)];
    const next = [...current];
    next[index] = outboxEntry(message, current[index]);
    return next;
  });
}

async function removeFromOutbox(clientMessageId) {
  await mutateOutbox((current) => current.filter((entry) => entry.client_message_id !== clientMessageId));
}

async function markOutboxFailure(clientMessageId, error) {
  await mutateOutbox((current) => current.map((entry) => {
    if (entry.client_message_id !== clientMessageId) return entry;
    const attemptCount = Number(entry.attempt_count || 0) + 1;
    return {
      ...entry,
      attempt_count: attemptCount,
      next_retry_at: new Date(Date.now() + retryDelay(attemptCount)).toISOString(),
      last_error_code: safeErrorCode(error),
    };
  }));
}

async function promoteCanonical(localMessage, canonical) {
  const promoted = normalizeAssistantMessage({
    ...localMessage,
    ...canonical,
    client_message_id: canonical.client_message_id || localMessage.client_message_id,
    status: 'synced',
    cloud_persisted: true,
  });
  await mutateLocalMessages((current) => mergeAssistantMessages(current, [promoted]));
  await removeFromOutbox(localMessage.client_message_id);
  return promoted;
}

/**
 * 先写本地 cache + outbox，再尝试云端；返回 cloud_persisted 明确区分证据 id。
 */
export async function saveDurableAssistantMessage(input = {}) {
  const localMessage = normalizeAssistantMessage({
    ...input,
    image_urls: input.imageUrls || input.image_urls,
    image_paths: input.imagePaths || input.image_paths,
    is_proactive: input.isProactive ?? input.is_proactive,
    trigger_source: input.triggerSource || input.trigger_source,
    client_message_id: input.clientMessageId || input.client_message_id,
    reply_to_message_id: input.replyToMessageId || input.reply_to_message_id,
    generation_key: input.generationKey || input.generation_key,
    status: 'pending',
    cloud_persisted: false,
  });

  await cacheAssistantMessage(localMessage);
  await enqueueMessage(localMessage);

  try {
    const canonical = await insertCanonicalMessage(localMessage);
    if (!canonical) throw sanitizedError({ code: 'EMPTY_INSERT_RESULT' });
    return promoteCanonical(localMessage, canonical);
  } catch (error) {
    await markOutboxFailure(localMessage.client_message_id, error);
    const code = safeErrorCode(error);
    console.warn('[momiMessageStore] 云端保存失败，消息保留待重试:', code);
    return {
      ...localMessage,
      status: 'pending',
      cloud_persisted: false,
      sync_error_code: code,
      migration_required: SCHEMA_ERROR_CODES.has(code),
    };
  }
}

/**
 * 有界补传；同一 client_message_id 多次调用只会得到一条 canonical 行。
 */
export async function flushAssistantMessageOutbox({ limit = 20 } = {}) {
  const entries = await readJsonArray(ASSISTANT_MESSAGE_OUTBOX_KEY);
  const due = entries
    .filter((entry) => !entry.next_retry_at || new Date(entry.next_retry_at).getTime() <= Date.now())
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 20)));
  let synced = 0;
  let failed = 0;

  for (const entry of due) {
    try {
      const message = normalizeAssistantMessage(entry.message);
      const canonical = await insertCanonicalMessage(message);
      if (!canonical) throw sanitizedError({ code: 'EMPTY_INSERT_RESULT' });
      await promoteCanonical(message, canonical);
      synced += 1;
    } catch (error) {
      await markOutboxFailure(entry.client_message_id, error);
      failed += 1;
      console.warn('[momiMessageStore] outbox 补传失败:', safeErrorCode(error));
    }
  }
  return { attempted: due.length, synced, failed, remaining: Math.max(0, entries.length - synced) };
}

async function fetchCloudMessages(limit) {
  try {
    return await runQuery(() => supabase
      .from('momi_assistant_messages')
      .select('*')
      .eq('couple_id', ASSISTANT_COUPLE_ID)
      .order('server_sequence', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(limit), { kind: 'read', retries: 2, timeout: 12000 });
  } catch (error) {
    if (safeErrorCode(error) !== '42703') throw error;
    console.warn('[momiMessageStore] server_sequence 未就绪，回退 created_at 排序:', safeErrorCode(error));
    return runQuery(() => supabase
      .from('momi_assistant_messages')
      .select('*')
      .eq('couple_id', ASSISTANT_COUPLE_ID)
      .order('created_at', { ascending: true })
      .limit(limit), { kind: 'read', retries: 2, timeout: 12000 });
  }
}

/**
 * 本地快照立即可恢复；云端成功后做 union，不覆盖 pending 行。
 */
export async function loadDurableAssistantMessages(limit = 80) {
  const cappedLimit = Math.max(1, Math.min(MAX_CACHE_MESSAGES, Number(limit) || 80));
  const local = await readJsonArray(ASSISTANT_MESSAGE_CACHE_KEY);
  try {
    const cloud = await fetchCloudMessages(cappedLimit);
    const merged = mergeAssistantMessages(cloud || [], local).slice(-cappedLimit);
    await serializeLocalMutation(() => writeJsonArray(ASSISTANT_MESSAGE_CACHE_KEY, merged));
    return merged;
  } catch (error) {
    console.warn('[momiMessageStore] 云端历史读取失败，使用本地快照:', safeErrorCode(error));
    const normalizedLocal = mergeAssistantMessages(local).slice(-cappedLimit);
    try {
      await serializeLocalMutation(() => writeJsonArray(ASSISTANT_MESSAGE_CACHE_KEY, normalizedLocal));
    } catch (storageError) {
      console.warn('[momiMessageStore] 规范化旧本地缓存失败:', safeErrorCode(storageError));
    }
    return normalizedLocal;
  }
}

/**
 * Realtime 只订阅同一 couple；INSERT/UPDATE 都并入本地，避免重连重复。
 */
export function subscribeDurableAssistantMessages({ onMessage, onError } = {}) {
  const channelName = `momi_assistant_v5_${randomSuffix().slice(-8)}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'momi_assistant_messages',
      filter: `couple_id=eq.${ASSISTANT_COUPLE_ID}`,
    }, async (payload) => {
      const row = payload.new;
      if (!row || row.couple_id !== ASSISTANT_COUPLE_ID) return;
      try {
        const cached = await cacheAssistantMessage({ ...row, cloud_persisted: true });
        if (onMessage) onMessage(cached, payload.eventType);
      } catch (error) {
        console.warn('[momiMessageStore] Realtime 消息合并失败:', safeErrorCode(error));
        if (onError) onError(safeErrorCode(error));
      }
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[momiMessageStore] Realtime 订阅异常:', status);
        if (onError) onError(status);
      }
    });

  return () => {
    try {
      const removal = supabase.removeChannel(channel);
      if (removal?.catch) {
        removal.catch((error) => console.warn('[momiMessageStore] Realtime 退订失败:', safeErrorCode(error)));
      }
    } catch (error) {
      console.warn('[momiMessageStore] Realtime 退订异常:', safeErrorCode(error));
    }
  };
}
