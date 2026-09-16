// ═══════════════════════════════════════════════════════
// momiChatImages.js —— 主聊天图片上下文收集与 AI 签名 URL 解析
// 纯函数提取上下文图片引用 + 批量换取短时可访问 signed URL，
// 支持引用图片第一顺位、去重与数量预算控制。
// ═══════════════════════════════════════════════════════

import { supabase } from './supabase';
import { normalizeToPhotosPath, PHOTOS_BUCKET, KITCHEN_BUCKET } from './mediaResolver';

/**
 * 提取单条消息中的图片路径/URL
 */
function extractImagePath(message) {
  if (!message) return null;
  const directPath = message.image_path || message.path || null;
  if (directPath) return directPath;

  const url = message.metadata?.image_url || message.image_url || message.url;
  if (url && typeof url === 'string') {
    const normalized = normalizeToPhotosPath(url);
    return normalized || url;
  }

  // 消息 content 自身可能是图片路径
  if (message.type === 'image' || message.content_type === 'image') {
    const content = String(message.content || '').trim();
    if (content.startsWith('http://') || content.startsWith('https://') || content.includes('/')) {
      const normalized = normalizeToPhotosPath(content);
      return normalized || content;
    }
  }

  return null;
}

/**
 * 纯函数：从当前聊天列表与引用状态中提取待供 AI 识图的图片引用
 * @param {object} params
 * @param {Array} params.messages - 聊天消息数组（时间新到旧或旧到新）
 * @param {object} [params.quotedMessage] - 当前被引用的消息
 * @param {Date} [params.now=new Date()] - 当前判定时间
 * @param {number} [params.windowMinutes=10] - 时间窗口（分钟）
 * @param {number} [params.maxImages=4] - 最大收集张数
 * @returns {Array<{ messageId: string|number, sender: string, path: string, createdAt: string, isQuoted: boolean }>}
 */
export function collectMomiContextImageRefs({
  messages = [],
  quotedMessage = null,
  now = new Date(),
  windowMinutes = 10,
  maxImages = 4,
} = {}) {
  const result = [];
  const seenPaths = new Set();
  const windowMs = windowMinutes * 60 * 1000;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  // a) 被引用的图片消息必须排第一且一定包含
  if (quotedMessage) {
    const isImageQuote =
      quotedMessage.type === 'image' ||
      quotedMessage.content_type === 'image' ||
      Boolean(quotedMessage.metadata?.image_url || quotedMessage.image_url);

    if (isImageQuote) {
      const quotePath = extractImagePath(quotedMessage);
      if (quotePath) {
        seenPaths.add(quotePath);
        result.push({
          messageId: quotedMessage.id,
          sender: quotedMessage.user_id || quotedMessage.sender || '用户',
          path: quotePath,
          createdAt: quotedMessage.created_at || new Date(nowMs).toISOString(),
          isQuoted: true,
        });
      }
    }
  }

  // b) 其余取 content_type 为 image 且在 now 往前 windowMinutes 分钟内的消息，按时间从新到旧
  const timeSorted = [...messages].sort((a, b) => {
    const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tB - tA; // 新到旧
  });

  for (const m of timeSorted) {
    if (result.length >= maxImages) break;

    const isImg =
      m.content_type === 'image' ||
      m.type === 'image' ||
      Boolean(m.metadata?.image_url || m.image_url);

    if (!isImg) continue;

    const msgTime = m.created_at ? new Date(m.created_at).getTime() : nowMs;
    // 超过窗口期跳过
    if (nowMs - msgTime > windowMs) continue;

    const path = extractImagePath(m);
    if (!path) continue;

    // c) 按对象路径去重
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);

    result.push({
      messageId: m.id,
      sender: m.user_id || m.sender || '用户',
      path,
      createdAt: m.created_at || new Date(msgTime).toISOString(),
      isQuoted: false,
    });
  }

  return result;
}

/**
 * 批量解析图片引用为可访问的 https URL
 * @param {Array} refs - collectMomiContextImageRefs 返回的引用列表
 * @param {object} [options]
 * @param {number} [options.expiresIn=3600] - 签名过期秒数
 * @returns {Promise<{ urls: string[], failed: Array<{ path: string, reason: string }> }>}
 */
export async function resolveImageRefsForAI(refs = [], { expiresIn = 3600 } = {}) {
  const urls = [];
  const failed = [];

  for (const ref of refs) {
    const rawPath = ref.path;
    if (!rawPath) continue;

    // 已经是外链或 data URL 直接使用
    if (
      rawPath.startsWith('data:') ||
      ((rawPath.startsWith('http://') || rawPath.startsWith('https://')) &&
        !rawPath.includes('supabase.co/storage/v1/object/'))
    ) {
      urls.push(rawPath);
      continue;
    }

    const cleanPath = normalizeToPhotosPath(rawPath) || rawPath;
    const isKitchen = cleanPath.startsWith('kitchen-images/');
    const bucket = isKitchen ? KITCHEN_BUCKET : PHOTOS_BUCKET;
    const storagePath = isKitchen ? cleanPath.slice('kitchen-images/'.length) : cleanPath;

    try {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(storagePath, expiresIn);

      if (error) throw error;
      if (!data?.signedUrl) throw new Error('未取得有效 signedUrl');

      urls.push(data.signedUrl);
    } catch (err) {
      console.warn(`[momiChatImages] 图片签名生成失败 (${storagePath}):`, err.message);
      failed.push({ path: storagePath, reason: err.message });
    }
  }

  return { urls, failed };
}
