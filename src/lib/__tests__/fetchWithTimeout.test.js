import { fetchWithTimeout } from '../fetchWithTimeout';

const fast = (value) => () => Promise.resolve(value);

describe('fetchWithTimeout 重试语义分类', () => {
  test('读请求默认自动重试直至成功', async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      if (calls < 3) return Promise.reject(new Error('fail'));
      return Promise.resolve('ok');
    };
    await expect(
      fetchWithTimeout(fn, { retries: 3, retryDelay: 1 })
    ).resolves.toBe('ok');
    expect(calls).toBe(3);
  });

  test('非幂等写请求不自动重试', async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      return Promise.reject(new Error('fail'));
    };
    await expect(
      fetchWithTimeout(fn, { kind: 'write', retryDelay: 1 })
    ).rejects.toThrow('fail');
    expect(calls).toBe(1);
  });

  test('幂等写请求可自动重试', async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      if (calls < 2) return Promise.reject(new Error('timeout'));
      return Promise.resolve('saved');
    };
    await expect(
      fetchWithTimeout(fn, { kind: 'write', idempotent: true, retryDelay: 1 })
    ).resolves.toBe('saved');
    expect(calls).toBe(2);
  });

  test('重试次数耗尽后抛出最后一次错误', async () => {
    let calls = 0;
    await expect(
      fetchWithTimeout(
        () => {
          calls += 1;
          return Promise.reject(new Error(`e${calls}`));
        },
        { retries: 2, retryDelay: 1 }
      )
    ).rejects.toThrow('e3');
    expect(calls).toBe(3);
  });

  test('超时触发 abort 信号传给 fetchFn', async () => {
    let observedAbort = false;
    const fn = (signal) => {
      if (signal) {
        signal.addEventListener('abort', () => {
          observedAbort = true;
        });
      }
      return new Promise(() => {}); // 永不返回 → 触发超时
    };
    await expect(
      fetchWithTimeout(fn, { timeout: 30, retries: 0 })
    ).rejects.toThrow('请求超时');
    expect(observedAbort).toBe(true);
  });

  test('不接收 signal 的旧式调用方照常工作', async () => {
    await expect(fetchWithTimeout(fast('legacy'))).resolves.toBe('legacy');
  });
});
