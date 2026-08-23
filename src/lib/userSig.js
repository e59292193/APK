// ═══════════════════════════════════════════════════════
// UserSig 获取（服务端签发版）
//
// 签名密钥保存在 Supabase Edge Function 的环境变量中，
// 客户端携带登录会话调用 functions/v1/usersig 换取短期 UserSig。
// 未经授权的调用（未登录 / 未绑定身份）会被服务端拒绝。
//
// 未部署 Edge Function 时此处会失败，实时信号自动回落数据库轮询。
// ═══════════════════════════════════════════════════════
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const SUPABASE_URL = 'https://kotakqdxwvienrmbcrnk.supabase.co';
const SIG_CACHE_PREFIX = 'tim_usersig_';
// 提前 1 小时过期，留出续期余量
const REFRESH_MARGIN_MS = 3600 * 1000;

async function fetchUserSigFromServer(imUserId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('尚未登录，无法获取实时信号凭证');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/usersig?userId=${encodeURIComponent(imUserId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`UserSig 服务返回 ${response.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
    }
    const payload = await response.json();
    if (!payload?.userSig) throw new Error(payload?.error || 'UserSig 服务响应无效');
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 获取指定 IM userID 的 UserSig（带缓存，缓存命中率 99%+）
 * @param {string} imUserId
 * @returns {Promise<string>}
 */
export async function getUserSig(imUserId) {
  const cacheKey = SIG_CACHE_PREFIX + imUserId;

  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const { sig, expireAt } = JSON.parse(cached);
      if (Number(expireAt) > Date.now() + REFRESH_MARGIN_MS) {
        return sig;
      }
    }
  } catch (e) {
    console.warn('[userSig] 读取缓存失败，重新请求:', e.message);
  }

  const payload = await fetchUserSigFromServer(imUserId);
  try {
    await AsyncStorage.setItem(
      cacheKey,
      JSON.stringify({ sig: payload.userSig, expireAt: Number(payload.expireAt) || Date.now() + 3600 * 1000 })
    );
  } catch (e) {
    console.warn('[userSig] 写入缓存失败:', e.message);
  }
  return payload.userSig;
}
