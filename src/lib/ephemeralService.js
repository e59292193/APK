// ═══════════════════════════════════════════════════════
// ephemeralService —— 小纸条 & 语音信箱 服务层
//
// 职责：
//   - 发送 / 原子抽取 / 消费 / 待抽取数量查询
//   - 私有 Storage 上传与短时 signed URL 生成
//   - 仅发送轻量实时信号（绝不含正文 / 音频地址 / 波形）
//
// 阅后即逝语义：at-most-once。
//   一旦 claim 成功，内容即视为“已送达并消失”，即使客户端随后崩溃
//   不再 consume，该条也不会回到待抽取池。
// ═══════════════════════════════════════════════════════
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { emitSignal } from './realtimeSignal';

// 私有 Storage bucket（需在 Supabase 控制台手动创建，见交付说明）
export const VOICE_BUCKET = 'ephemeral-voice';
// signed URL 有效期（秒）：3~5 分钟
const SIGNED_URL_TTL = 300;

// 实时信号 topic（独立于 chat:message）
export const EPHEMERAL_TOPICS = {
  note: 'ephemeral:note:changed',
  voice: 'ephemeral:voice:changed',
};

// ─── 内部：发送轻量信号（不含任何私密内容）───
function notifyNote(action, itemId) {
  emitSignal(EPHEMERAL_TOPICS.note, {
    action,                       // 'created' | 'consumed'
    item_id: itemId || null,
    timestamp: Date.now(),
  }).catch((e) => console.warn('[ephemeral] note 信号发送失败:', e.message));
}
function notifyVoice(action, itemId) {
  emitSignal(EPHEMERAL_TOPICS.voice, {
    action,
    item_id: itemId || null,
    timestamp: Date.now(),
  }).catch((e) => console.warn('[ephemeral] voice 信号发送失败:', e.message));
}

// ═══════════════════════════════════════════════════════
// 小纸条
// ═══════════════════════════════════════════════════════

/**
 * 发送小纸条
 * @param {Object} p
 * @param {string} p.senderId
 * @param {string} p.receiverId
 * @param {string} p.content
 * @param {string} [p.paperStyle]
 * @param {string} p.clientRequestId  客户端生成的 UUID，防重复发送
 * @returns {Promise<{id:string}>}
 */
export async function sendNote({ senderId, receiverId, content, paperStyle, clientRequestId }) {
  if (!content || !content.trim()) throw new Error('内容不能为空');
  if (!clientRequestId) throw new Error('缺少 client_request_id');

  const row = {
    sender_id: senderId,
    receiver_id: receiverId,
    content: content.trim(),
    paper_style: paperStyle || null,
    client_request_id: clientRequestId,
  };

  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase.from('ephemeral_notes').insert([row]).select().single()
    );
    if (error) throw error;
    notifyNote('created', data.id);
    return { id: data.id };
  } catch (e) {
    // 23505 = unique violation（client_request_id 重复）→ 视为已发送成功
    if (e && e.code === '23505') {
      const { data: existing } = await fetchWithTimeout(() =>
        supabase
          .from('ephemeral_notes')
          .select('id')
          .eq('client_request_id', clientRequestId)
          .maybeSingle()
      );
      if (existing) return { id: existing.id };
    }
    throw e;
  }
}

/**
 * 原子随机抽取一张发给当前用户、尚未查看的小纸条
 * @param {string} receiverId
 * @returns {Promise<Object|null>} { id, sender_id, content, paper_style, claim_token, created_at }
 */
export async function claimNote(receiverId) {
  const { data, error } = await fetchWithTimeout(() =>
    supabase.rpc('claim_ephemeral_note', { p_receiver: receiverId })
  );
  if (error) throw error;
  // RPC 返回数组（RETURNS TABLE）；取第一条
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return row || null;
}

/**
 * 消费小纸条（阅后即逝，删除整行）
 * @param {string} id
 * @param {string} claimToken
 * @returns {Promise<boolean>} 是否成功
 */
export async function consumeNote(id, claimToken) {
  const { data, error } = await fetchWithTimeout(() =>
    supabase.rpc('consume_ephemeral_note', { p_id: id, p_claim_token: claimToken })
  );
  if (error) throw error;
  const ok = !!data;
  if (ok) notifyNote('consumed', id);
  return ok;
}

/**
 * 当前待抽取的小纸条数量
 * @param {string} receiverId
 * @returns {Promise<number>}
 */
export async function countPendingNotes(receiverId) {
  const { count, error } = await fetchWithTimeout(() =>
    supabase
      .from('ephemeral_notes')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', receiverId)
      .eq('status', 'pending')
  );
  if (error) throw error;
  return count || 0;
}

// ═══════════════════════════════════════════════════════
// 语音信箱
// ═══════════════════════════════════════════════════════

/**
 * 发送语音：先上传私有 Storage，再写库
 * @param {Object} p
 * @returns {Promise<{id:string, storagePath:string}>}
 */
export async function sendVoice({
  senderId,
  receiverId,
  localUri,
  durationMs,
  waveform,
  mimeType = 'audio/m4a',
  fileSize,
  clientRequestId,
}) {
  if (!localUri) throw new Error('缺少录音文件');
  if (!clientRequestId) throw new Error('缺少 client_request_id');

  // 1. 上传到私有 bucket：senderId/uuid.m4a
  const ext = mimeType === 'audio/m4a' ? 'm4a' : 'm4a';
  const storagePath = `${senderId}/${clientRequestId}.${ext}`;

  // RN: fetch file:// uri → blob
  let body;
  try {
    body = await (await fetch(localUri)).blob();
  } catch (e) {
    throw new Error('读取录音文件失败: ' + e.message);
  }

  const { error: upErr } = await fetchWithTimeout(() =>
    supabase.storage
      .from(VOICE_BUCKET)
      .upload(storagePath, body, { contentType: mimeType, upsert: false })
  );
  if (upErr) throw upErr;

  // 2. 写库（仅存 storage_path，不存公共 URL）
  const row = {
    sender_id: senderId,
    receiver_id: receiverId,
    storage_path: storagePath,
    duration_ms: Math.max(0, Math.round(durationMs || 0)),
    waveform: waveform || null,
    mime_type: mimeType,
    file_size: fileSize || null,
    client_request_id: clientRequestId,
  };

  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase.from('ephemeral_voice_messages').insert([row]).select().single()
    );
    if (error) throw error;
    notifyVoice('created', data.id);
    return { id: data.id, storagePath };
  } catch (e) {
    if (e && e.code === '23505') {
      // 库已存在（重复发送），回滚刚才的上传避免孤儿文件
      supabase.storage.from(VOICE_BUCKET).remove([storagePath]).catch(() => {});
      const { data: existing } = await fetchWithTimeout(() =>
        supabase
          .from('ephemeral_voice_messages')
          .select('id, storage_path')
          .eq('client_request_id', clientRequestId)
          .maybeSingle()
      );
      if (existing) return { id: existing.id, storagePath: existing.storage_path };
    }
    // 写库失败：尽力删除已上传的孤儿文件
    supabase.storage.from(VOICE_BUCKET).remove([storagePath]).catch(() => {});
    throw e;
  }
}

/**
 * 原子随机抽取一段语音
 * @param {string} receiverId
 * @returns {Promise<Object|null>}
 */
export async function claimVoice(receiverId) {
  const { data, error } = await fetchWithTimeout(() =>
    supabase.rpc('claim_ephemeral_voice', { p_receiver: receiverId })
  );
  if (error) throw error;
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return row || null;
}

/**
 * 生成短时 signed URL（接收方 claim 成功后才生成）
 * @param {string} storagePath
 * @returns {Promise<string>}
 */
export async function createSignedVoiceUrl(storagePath) {
  const { data, error } = await fetchWithTimeout(() =>
    supabase.storage.from(VOICE_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL)
  );
  if (error) throw error;
  if (!data || !data.signedUrl) throw new Error('生成音频链接失败');
  return data.signedUrl;
}

/**
 * 消费语音：标记 consumed，并尽力删除 Storage 对象
 * @param {string} id
 * @param {string} claimToken
 * @param {string} storagePath  客户端持有的路径（兜底删除）
 * @returns {Promise<boolean>}
 */
export async function consumeVoice(id, claimToken, storagePath) {
  const { data, error } = await fetchWithTimeout(() =>
    supabase.rpc('consume_ephemeral_voice', { p_id: id, p_claim_token: claimToken })
  );
  if (error) throw error;

  // RPC 返回 { ok, storage_path }
  const ok = !!(data && data.ok);
  const pathToDelete = (data && data.storage_path) || storagePath;

  if (ok) {
    notifyVoice('consumed', id);
    // 尽力删除私有 Storage 对象（DB 与 Storage 非原子，此处为即时清理）
    if (pathToDelete) {
      supabase.storage.from(VOICE_BUCKET).remove([pathToDelete]).catch(() => {});
    }
  }
  return ok;
}

/**
 * 释放语音 claim（音频加载失败、尚未播放时回退到 pending，便于安全重试）
 * @param {string} id
 * @param {string} claimToken
 * @returns {Promise<boolean>}
 */
export async function releaseVoiceClaim(id, claimToken) {
  const { data, error } = await fetchWithTimeout(() =>
    supabase.rpc('release_ephemeral_voice_claim', { p_id: id, p_claim_token: claimToken })
  );
  if (error) throw error;
  return !!data;
}

/**
 * 当前待抽取的语音数量
 * @param {string} receiverId
 * @returns {Promise<number>}
 */
export async function countPendingVoice(receiverId) {
  const { count, error } = await fetchWithTimeout(() =>
    supabase
      .from('ephemeral_voice_messages')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', receiverId)
      .eq('status', 'pending')
  );
  if (error) throw error;
  return count || 0;
}

/**
 * 生成客户端去重 UUID（不依赖 crypto-js 的复杂用法）
 */
export function newClientRequestId() {
  // react-native-get-random-values 已在 App.js 顶部 import，polyfill UUID
  // 使用 crypto.getRandomValues 构造 v4 UUID
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

/**
 * 把录音 metering（dB，通常 -160 ~ 0）采样归一化为 [0..1] 波形点
 * @param {number[]} samples  原始 metering 采样
 * @param {number} targetLen  目标点数（32~64）
 * @returns {number[]}
 */
export function normalizeWaveform(samples, targetLen = 40) {
  if (!samples || samples.length === 0) return new Array(targetLen).fill(0.06);
  // 归一化：-50dB → 0，0dB → 1
  const norm = samples.map((db) => {
    const v = (db + 50) / 50; // -50..0 → 0..1
    return Math.max(0.04, Math.min(1, v));
  });
  // 压缩/重采样到 targetLen
  const out = [];
  const step = norm.length / targetLen;
  for (let i = 0; i < targetLen; i++) {
    const start = Math.floor(i * step);
    const end = Math.min(norm.length, Math.floor((i + 1) * step));
    const slice = norm.slice(start, end || start + 1);
    const peak = slice.reduce((m, x) => Math.max(m, x), 0.04);
    out.push(Number(peak.toFixed(3)));
  }
  return out;
}
