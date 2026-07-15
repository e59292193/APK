import { useEffect, useRef } from 'react';

/**
 * 轮询 hook：屏幕活跃时定时调用 callback，非活跃时自动暂停。
 *
 * 用法：
 *   usePolling(fetchWishes, 15000, { active: isActive });
 *
 * @param {Function} callback  要轮询的函数（通常是 fetchXxx）
 * @param {number}   interval  轮询间隔（ms），默认 15000
 * @param {Object}   opts
 * @param {boolean}  opts.active  是否活跃（非活跃时暂停轮询），默认 true
 */
export function usePolling(callback, interval = 15000, opts = {}) {
  const { active = true } = opts;
  const savedRef = useRef(callback);

  // 始终保持 ref 指向最新的 callback，避免闭包陷阱
  useEffect(() => {
    savedRef.current = callback;
  }, [callback]);

  // active 或 interval 变化时重建定时器
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => savedRef.current(), interval);
    return () => clearInterval(id);
  }, [active, interval]);
}
