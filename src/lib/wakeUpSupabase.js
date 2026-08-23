// ═══════════════════════════════════════════════════════
// Supabase 免费项目唤醒工具（非阻塞版）
// 免费项目长时间不访问会自动休眠，唤醒需要 30s~2min
// 此模块在 APP 启动时后台静默唤醒，不阻塞 UI
//
// 生产防护：
//   - 应用退到后台立即停止重试（不再后台耗电耗流）
//   - 断网时暂停，恢复联网后继续
//   - 前台停留时最多重试 3 分钟
// ═══════════════════════════════════════════════════════

import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';

// 唤醒状态
let wakeUpPromise = null;
let awake = false;

function sleep(ms, cancelRef) {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      cancelRef.onFinish = null;
      resolve();
    }
    // 提前取消（退后台/断网）时立即结束等待
    cancelRef.onFinish = finish;
  });
}

/**
 * 查询 Supabase 是否已唤醒
 */
export function isSupabaseAwake() {
  return awake;
}

/**
 * 唤醒 Supabase：发送轻量请求直到成功。
 * 非阻塞：调用方无需等待结果。
 * @returns {Promise<void>}
 */
export async function wakeUpSupabase() {
  if (wakeUpPromise) return wakeUpPromise;
  if (awake) return Promise.resolve();

  const cancelRef = { onFinish: null };
  const cancelWait = () => {
    if (cancelRef.onFinish) cancelRef.onFinish();
  };

  wakeUpPromise = (async () => {
    const MAX_WAIT = 180000; // 前台最多等 3 分钟
    const RETRY_DELAY = 3000;
    const startTime = Date.now();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') cancelWait(); // 退后台：中断等待并停止
    });
    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected === false) cancelWait();
    });

    try {
      while (Date.now() - startTime < MAX_WAIT) {
        // 后台或断网时直接放弃（回前台后各页面轮询会自行恢复）
        if (AppState.currentState !== 'active') {
          console.warn('[wakeUpSupabase] 应用不在前台，停止唤醒');
          return;
        }

        try {
          const { error } = await supabase
            .from('messages')
            .select('id')
            .limit(1);

          if (!error) {
            console.log('[wakeUpSupabase] Supabase 已唤醒');
            awake = true;
            return;
          }

          const isConnectionError =
            error.message?.includes('Connection') ||
            error.message?.includes('timeout') ||
            error.message?.includes('refused') ||
            error.message?.includes('503') ||
            error.message?.includes('502') ||
            error.message?.includes('500');

          if (!isConnectionError) {
            console.log('[wakeUpSupabase] Supabase 已在线（非连接错误）');
            awake = true;
            return;
          }

          console.warn(`[wakeUpSupabase] Supabase 休眠中，等待唤醒... (${Math.round((Date.now() - startTime) / 1000)}s)`);
        } catch (err) {
          console.warn('[wakeUpSupabase] 请求异常:', err.message);
        }

        await sleep(RETRY_DELAY, cancelRef);
      }

      console.warn('[wakeUpSupabase] 唤醒超时，各页面将自行重试');
    } finally {
      appStateSub.remove();
      netSub();
    }
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
