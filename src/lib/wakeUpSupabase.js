// ═══════════════════════════════════════════════════════
// Supabase 免费项目唤醒工具（非阻塞版）
// 免费项目长时间不访问会自动休眠，唤醒需要 30s~2min
// 此模块在 APP 启动时后台静默唤醒，不阻塞 UI
// ═══════════════════════════════════════════════════════

import { supabase } from './supabase';

// 唤醒状态
let wakeUpPromise = null;
let awake = false;

/**
 * 查询 Supabase 是否已唤醒
 */
export function isSupabaseAwake() {
  return awake;
}

/**
 * 唤醒 Supabase：发送一个轻量请求，等待响应
 * 如果失败则自动重试，最多等待 3 分钟
 * 非阻塞：调用方不需要等待结果即可使用 App
 * @returns {Promise<void>}
 */
export async function wakeUpSupabase() {
  // 如果已经在唤醒中，复用同一个 Promise
  if (wakeUpPromise) return wakeUpPromise;

  // 如果已经唤醒成功，直接返回
  if (awake) return Promise.resolve();

  wakeUpPromise = (async () => {
    const MAX_WAIT = 180000; // 最多等 3 分钟
    const RETRY_DELAY = 3000; // 每次重试间隔 3 秒
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_WAIT) {
      try {
        // 发送一个极轻量的请求来唤醒数据库
        const { error } = await supabase
          .from('messages')
          .select('id')
          .limit(1);

        if (!error) {
          console.log('[wakeUpSupabase] ✅ Supabase 已唤醒');
          awake = true;
          return;
        }

        // 检查是否是连接错误（休眠中）
        const isConnectionError =
          error.message?.includes('Connection') ||
          error.message?.includes('timeout') ||
          error.message?.includes('refused') ||
          error.message?.includes('503') ||
          error.message?.includes('502') ||
          error.message?.includes('500');

        if (!isConnectionError) {
          // 其他错误（如 RLS 等），说明数据库已经在线了
          console.log('[wakeUpSupabase] ✅ Supabase 已在线（非连接错误）:', error.message);
          awake = true;
          return;
        }

        console.warn(`[wakeUpSupabase] ⏳ Supabase 休眠中，等待唤醒... (${Math.round((Date.now() - startTime) / 1000)}s)`);
      } catch (err) {
        console.warn('[wakeUpSupabase] 请求异常:', err.message);
      }

      // 等待后重试
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
    }

    // 超时不报错，让各页面自行重试
    console.warn('[wakeUpSupabase] 唤醒超时，各页面将自行重试');
    awake = false;
  })();

  try {
    await wakeUpPromise;
  } finally {
    wakeUpPromise = null;
  }
}

/**
 * 重置唤醒状态（用于手动重试）
 */
export function resetWakeUp() {
  wakeUpPromise = null;
  awake = false;
}
