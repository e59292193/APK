import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

/**
 * 轮询 hook：活跃时定时调用 callback，带完整的生产防护。
 *
 * - in-flight 保护：上一次回调未完成时跳过本次 tick，慢请求不重叠。
 * - 失败退避：连续失败时间隔翻倍（上限 4 倍），成功后恢复。
 * - 前后台：应用退到后台自动暂停，回前台立即刷新一次。
 * - 网络：断网暂停，恢复联网立即刷新一次。
 * - 卸载时清理全部定时器与订阅。
 *
 * 用法：
 *   usePolling(fetchWishes, 15000, { active: isActive, immediate: true });
 *
 * @param {Function} callback  要轮询的函数（返回 Promise）
 * @param {number}   interval  轮询间隔（ms），默认 15000
 * @param {Object}   opts
 * @param {boolean}  [opts.active=true]   是否活跃（非活跃时暂停）
 * @param {boolean}  [opts.immediate=false] 激活时是否立即执行一次
 */
export function usePolling(callback, interval = 15000, opts = {}) {
  const { active = true, immediate = false } = opts;
  const savedRef = useRef(callback);
  const inFlightRef = useRef(false);
  const failuresRef = useRef(0);
  const timerRef = useRef(null);
  const runningRef = useRef(false);

  // 始终保持 ref 指向最新的 callback，避免闭包陷阱
  useEffect(() => {
    savedRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!active) return undefined;

    runningRef.current = true;

    const runOnce = async () => {
      if (inFlightRef.current) return; // 慢请求保护：不重叠
      inFlightRef.current = true;
      try {
        await savedRef.current();
        failuresRef.current = 0;
      } catch (e) {
        failuresRef.current += 1;
      } finally {
        inFlightRef.current = false;
      }
    };

    const currentDelay = () => {
      const backoff = Math.min(failuresRef.current, 2); // 最多 4 倍
      return interval * Math.pow(2, backoff);
    };

    // 用动态 setTimeout 实现可变间隔
    const clearTimer = () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    const scheduleNext = () => {
      clearTimer();
      timerRef.current = setTimeout(async () => {
        await runOnce();
        if (runningRef.current) scheduleNext();
      }, currentDelay());
    };

    const start = () => {
      if (immediate) {
        runOnce().finally(() => {
          if (runningRef.current) scheduleNext();
        });
      } else {
        scheduleNext();
      }
    };

    // 前后台：后台暂停，回前台立即刷一次
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (runningRef.current) {
          runOnce().finally(() => {
            if (runningRef.current) scheduleNext();
          });
        }
      } else {
        clearTimer(); // 后台暂停定时器
      }
    });

    // 网络：断网暂停，恢复立即刷一次
    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected === false) {
        clearTimer();
      } else if (state.isConnected === true && runningRef.current) {
        runOnce().finally(() => {
          if (runningRef.current) scheduleNext();
        });
      }
    });

    start();

    return () => {
      runningRef.current = false;
      clearTimer();
      appStateSub.remove();
      netSub();
    };
  }, [active, interval, immediate]);
}
