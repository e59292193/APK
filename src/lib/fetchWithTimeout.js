/**
 * 带超时、真实取消与按语义重试的 fetch 封装
 *
 * 针对 Supabase 免费项目休眠问题做了特殊优化：
 * - 检测到连接错误（休眠）时自动增加重试次数
 * - 指数退避 + 抖动，避免短时间大量请求
 *
 * 请求语义分类（重要）：
 * - kind 'read'（默认）：可安全自动重试。
 * - kind 'write'：非幂等写默认 **不自动重试**（retries 强制 0），
 *   除非显式传 idempotent: true（调用方必须保证服务端幂等，
 *   如携带 client_request_id 唯一键，或有 23505 恢复逻辑）。
 *
 * 真实取消：fetchFn 可接收 AbortSignal 参数（第二个形参），并接到
 * 底层请求（supabase 链式查询可用 .abortSignal(signal)，原生 fetch 可直接传）。
 * 未接线的请求超时后仍可能在服务端完成——因此写操作的重试必须靠幂等键。
 *
 * @param {Function} fetchFn    - (signal?: AbortSignal) => Promise
 * @param {Object}   opts
 * @param {number}   [opts.timeout=15000]   - 单次请求超时（毫秒）
 * @param {number}   [opts.retries=3]       - 失败后重试次数（不含首次）
 * @param {number}   [opts.retryDelay=1000] - 首次重试前等待（毫秒），指数翻倍 + 抖动
 * @param {'read'|'write'} [opts.kind='read'] - 请求语义
 * @param {boolean}  [opts.idempotent=false] - kind='write' 时是否允许重试
 * @returns {Promise<any>}
 */
export async function fetchWithTimeout(fetchFn, opts = {}) {
  const {
    timeout = 15000,
    retryDelay = 1000,
    kind = 'read',
    idempotent = false,
  } = opts;
  // 非幂等写：禁止自动重试；幂等写沿用调用方给的次数（默认与读一致）
  const retries = kind === 'write' && !idempotent ? 0 : (opts.retries ?? 3);

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;
    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          timedOut = true;
          if (controller) controller.abort();
          reject(new Error('请求超时，请检查网络连接'));
        }, timeout);
        // 把 signal 递给 fetchFn；不支持 AbortSignal 的调用方可以忽略
        const maybeP = typeof controller === 'object' && controller !== null
          ? Promise.resolve(fetchFn(controller.signal)).catch((err) => {
              // 超时触发的 abort 不应变成未处理拒绝
              if (timedOut && controller.signal.aborted) return new Promise(() => {});
              throw err;
            })
          : Promise.resolve(fetchFn());
        maybeP.then(
          (val) => { clearTimeout(timer); resolve(val); },
          (err) => { clearTimeout(timer); reject(err); }
        );
      });
      return result;
    } catch (err) {
      lastError = err;
      const label = kind === 'write' ? '写请求' : '请求';
      console.warn(`[fetchWithTimeout] ${label}第 ${attempt + 1} 次失败:`, err.message);

      if (attempt < retries) {
        const base = retryDelay * Math.pow(2, attempt);
        const jitter = base * 0.2 * (Math.random() * 2 - 1); // ±20% 抖动
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, base + jitter)));
      }
    }
  }

  throw lastError;
}
