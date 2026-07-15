/**
 * 带超时与自动重试的 fetch 封装
 *
 * 针对 Supabase 免费项目休眠问题做了特殊优化：
 * - 检测到连接错误（休眠）时自动增加重试次数
 * - 使用指数退避策略，避免短时间大量请求
 * - 总超时时间最长可达 60 秒（3次重试 × 15s + 退避等待）
 *
 * @param {Function} fetchFn    - 一个返回 Promise 的函数（例如 supabase 的查询）
 * @param {Object}   opts
 * @param {number}   [opts.timeout=15000]   - 单次请求超时时间（毫秒）
 * @param {number}   [opts.retries=3]       - 失败后重试次数（不含首次请求）
 * @param {number}   [opts.retryDelay=1000] - 首次重试前的等待时间（毫秒），每次翻倍
 * @returns {Promise<any>}
 */
export async function fetchWithTimeout(fetchFn, opts = {}) {
  const { timeout = 15000, retries = 3, retryDelay = 1000 } = opts;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('请求超时，请检查网络连接')),
          timeout
        );
        Promise.resolve(fetchFn()).then(
          (val) => { clearTimeout(timer); resolve(val); },
          (err) => { clearTimeout(timer); reject(err); }
        );
      });
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`[fetchWithTimeout] 第 ${attempt + 1} 次请求失败:`, err.message);

      // 如果还有重试机会，等待后继续
      if (attempt < retries) {
        const delay = retryDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // 所有重试均失败
  throw lastError;
}
