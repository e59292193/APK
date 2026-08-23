import { formatLocalDate, formatLocalDateTime, getCountdown } from '../dateUtils';

describe('dateUtils 日期与倒计时', () => {
  test('formatLocalDate 格式化 UTC 字符串', () => {
    expect(formatLocalDate('2026-06-08T14:07:00Z')).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    expect(formatLocalDate('')).toBe('');
    expect(formatLocalDate(null)).toBe('');
  });

  test('formatLocalDateTime 输出完整格式', () => {
    expect(formatLocalDateTime('2026-06-08T14:07:00Z')).toMatch(
      /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/
    );
  });

  test('getCountdown 未来日期返回倒计时字符串', () => {
    const future = new Date(Date.now() + 10 * 24 * 3600 * 1000 + 5000).toISOString();
    const result = getCountdown(future);
    expect(result).toMatch(/天/);
    expect(result).toMatch(/时/);
    expect(result).toMatch(/秒/);
    // 跨时区边界 ±1 天
    expect(result).toMatch(/^(9|10|11)天/);
  });

  test('getCountdown 已到期返回 null', () => {
    expect(getCountdown(new Date(Date.now() - 1000).toISOString())).toBeNull();
    expect(getCountdown('')).toBeNull();
  });
});
