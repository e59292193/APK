// ═══════════════════════════════════════════════════════
// mediaResolver —— 统一的私密媒体地址解析
//
// photos bucket 迁移为私有后，数据库中保存的是 bucket 内路径
// （如 uploads/photo_123.jpg）；历史数据里可能是旧的公开 URL。
// 渲染层统一通过本模块换取短时 signed URL，并做内存级缓存。
//
// 兼容窗口：bucket 尚未私有化时 signed URL 依旧可用（策略放行 anon），
// 私有化后需要已登录会话——与正式登录流程一致。
// ═══════════════════════════════════════════════════════
import { supabase } from './supabase';

export const PHOTOS_BUCKET = 'photos';
export const KITCHEN_BUCKET = 'kitchen-images';

const SUPABASE_URL = 'https://kotakqdxwvienrmbcrnk.supabase.co';
const LEGACY_PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${PHOTOS_BUCKET}/`;
const LEGACY_SIGNED_PREFIX = `${SUPABASE_URL}/storage/v1/object/sign/${PHOTOS_BUCKET}/`;
const LEGACY_AUTH_PREFIX = `${SUPABASE_URL}/storage/v1/object/authenticated/${PHOTOS_BUCKET}/`;

const KITCHEN_PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${KITCHEN_BUCKET}/`;
const KITCHEN_SIGNED_PREFIX = `${SUPABASE_URL}/storage/v1/object/sign/${KITCHEN_BUCKET}/`;

// signed URL 有效期（秒）。Supabase 单次签名上限 7 天。
const SIGNED_TTL = 7 * 24 * 3600;
// 提前 1 小时刷新，避免渲染时刚好过期
const REFRESH_MARGIN_MS = 3600 * 1000;

// path -> { url, expireAt }
const cache = new Map();
// path -> Promise<string>，进行中的请求去重
const inFlight = new Map();

/**
 * 把数据库中存的媒体值归一化为 photos 或 kitchen-images bucket 内路径。
 * 支持：bucket 路径、旧公开 URL、旧签名 URL、authenticated URL。
 * 返回 null 表示不是支持的 Storage 内容（如 data: URI、外链）。
 */
export function normalizeToPhotosPath(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(LEGACY_PUBLIC_PREFIX)) {
    return decodeURIComponent(trimmed.slice(LEGACY_PUBLIC_PREFIX.length));
  }
  if (trimmed.startsWith(LEGACY_SIGNED_PREFIX)) {
    return decodeURIComponent(trimmed.slice(LEGACY_SIGNED_PREFIX.length).split('?')[0]);
  }
  if (trimmed.startsWith(LEGACY_AUTH_PREFIX)) {
    return decodeURIComponent(trimmed.slice(LEGACY_AUTH_PREFIX.length).split('?')[0]);
  }
  if (trimmed.startsWith(KITCHEN_PUBLIC_PREFIX)) {
    return `kitchen-images/${decodeURIComponent(trimmed.slice(KITCHEN_PUBLIC_PREFIX.length))}`;
  }
  if (trimmed.startsWith(KITCHEN_SIGNED_PREFIX)) {
    return `kitchen-images/${decodeURIComponent(trimmed.slice(KITCHEN_SIGNED_PREFIX.length).split('?')[0])}`;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return null; // 外链或内联数据，原样使用
  }
  // 纯路径（可能带 query 的旧写法兜底）
  return trimmed.split('?')[0];
}

async function createSignedUrl(path) {
  const isKitchen = path.startsWith('kitchen-images/') || path.includes('dish_');
  const bucket = isKitchen ? KITCHEN_BUCKET : PHOTOS_BUCKET;
  const cleanPath = path.startsWith('kitchen-images/')
    ? path.slice('kitchen-images/'.length)
    : path;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(cleanPath, SIGNED_TTL);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('生成图片链接失败');
  return data.signedUrl;
}

/**
 * 解析为可渲染的 URL。带缓存与请求去重。
 * @returns {Promise<string|null>}
 */
export async function resolvePhotosUrl(value) {
  const path = normalizeToPhotosPath(value);
  if (path === null) return value || null;

  const hit = cache.get(path);
  if (hit && hit.expireAt > Date.now() + REFRESH_MARGIN_MS) {
    return hit.url;
  }

  let pending = inFlight.get(path);
  if (!pending) {
    pending = createSignedUrl(path)
      .then((url) => {
        cache.set(path, { url, expireAt: Date.now() + SIGNED_TTL * 1000 });
        return url;
      })
      .finally(() => {
        inFlight.delete(path);
      });
    inFlight.set(path, pending);
  }
  return pending;
}
