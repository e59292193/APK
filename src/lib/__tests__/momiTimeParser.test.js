import {
  cnToNumber,
  computeNextOccurrence,
  detectRecurrence,
  formatDueAt,
  formatRecurrence,
  parseClockTime,
  resolveDueAt,
} from '../momiTimeParser';

// 全部用本地时间构造与断言，避免测试机时区不同导致偶发失败
const localDate = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi, 0, 0);

function expectLocal(iso, y, m, d, h, mi) {
  const date = new Date(iso);
  expect([
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  ]).toEqual([y, m, d, h, mi]);
}

// 2026-09-15 是星期二
const NOW = localDate(2026, 9, 15, 13, 51);

describe('momiTimeParser 中文时间解析', () => {
  test('口语「等下两点钟」指的是今天下午两点，不是明天凌晨', () => {
    const result = resolveDueAt('等下两点钟准时给我发条信息', NOW);
    expect(result.ok).toBe(true);
    expectLocal(result.dueAt, 2026, 9, 15, 14, 0);
    expect(result.recurrence).toBe('none');
  });

  test('相对分钟与半小时保持精确偏移', () => {
    const tenMinutes = resolveDueAt('10分钟后提醒我喝水', NOW);
    expect(tenMinutes.ok).toBe(true);
    expect(new Date(tenMinutes.dueAt).getTime() - NOW.getTime()).toBe(10 * 60 * 1000);

    const halfHour = resolveDueAt('半小时后叫我', NOW);
    expect(halfHour.ok).toBe(true);
    expect(new Date(halfHour.dueAt).getTime() - NOW.getTime()).toBe(30 * 60 * 1000);
  });

  test('「3天后」没说钟点时也保持精确偏移，不套默认 9 点', () => {
    const result = resolveDueAt('3天后提醒我交报告', NOW);
    expect(result.ok).toBe(true);
    expect(new Date(result.dueAt).getTime() - NOW.getTime()).toBe(3 * 24 * 60 * 60 * 1000);
  });

  test('「3天后早上8点」以第三天为基准日', () => {
    const result = resolveDueAt('3天后早上8点提醒我出发', NOW);
    expect(result.ok).toBe(true);
    expectLocal(result.dueAt, 2026, 9, 18, 8, 0);
  });

  test('明天早上八点半 / 后天中午12点', () => {
    expectLocal(resolveDueAt('明天早上八点半叫我起床', NOW).dueAt, 2026, 9, 16, 8, 30);
    expectLocal(resolveDueAt('后天中午12点提醒我吃药', NOW).dueAt, 2026, 9, 17, 12, 0);
  });

  test('明确日期：9月20日下午三点', () => {
    expectLocal(resolveDueAt('9月20日下午三点提醒我开会', NOW).dueAt, 2026, 9, 20, 15, 0);
  });

  test('无年份且已过去的日期顺延到下一年', () => {
    const result = resolveDueAt('1月2日上午10点提醒我续费', localDate(2026, 12, 31, 10, 0));
    expect(result.ok).toBe(true);
    expectLocal(result.dueAt, 2027, 1, 2, 10, 0);
  });

  test('每天 / 每个工作日 / 每周二 的重复规则与首次触发', () => {
    const daily = resolveDueAt('每天晚上九点提醒我背单词', NOW);
    expect(daily.recurrence).toBe('daily');
    expectLocal(daily.dueAt, 2026, 9, 15, 21, 0);

    const weekday = resolveDueAt('每个工作日早上7点叫我起床', NOW);
    expect(weekday.recurrence).toBe('weekday');
    // 今天 7 点已过，首次触发落在下一个工作日（周三）
    expectLocal(weekday.dueAt, 2026, 9, 16, 7, 0);

    const weekly = resolveDueAt('每周二晚上八点提醒我倒垃圾', NOW);
    expect(weekly.recurrence).toBe('weekly');
    expect(weekly.weekday).toBe(2);
    expectLocal(weekly.dueAt, 2026, 9, 15, 20, 0);
  });

  test('只说事情没说时间 → no_time（必须反问，不能瞎猜）', () => {
    expect(resolveDueAt('提醒我买牛奶', NOW)).toEqual(
      expect.objectContaining({ ok: false, error: 'no_time' }),
    );
  });

  test('明确说了「今天」但时间已过 → past_time，不许顺延到明天', () => {
    const result = resolveDueAt('今天上午9点提醒我开会', localDate(2026, 9, 15, 18, 0));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('past_time');
  });

  test('空文本与无时间线索都不产生时间', () => {
    expect(resolveDueAt('', NOW).error).toBe('no_time');
    expect(resolveDueAt('momi 今天心情怎么样嘛', NOW).ok).not.toBe(undefined);
  });

  test('中文数字与钟点解析', () => {
    expect(cnToNumber('十一')).toBe(11);
    expect(cnToNumber('两')).toBe(2);
    expect(cnToNumber('三十')).toBe(30);
    expect(cnToNumber('半')).toBe(0.5);
    expect(cnToNumber('随便')).toBeNull();

    expect(parseClockTime('晚上八点')).toEqual(
      expect.objectContaining({ hour: 20, minute: 0, explicit: true }),
    );
    expect(parseClockTime('上午9点半')).toEqual(
      expect.objectContaining({ hour: 9, minute: 30, explicit: true }),
    );
    expect(parseClockTime('明天')).toBeNull();
  });

  test('重复规则识别', () => {
    expect(detectRecurrence('每个工作日早上7点')).toEqual({ recurrence: 'weekday', weekday: null });
    expect(detectRecurrence('每天晚上九点')).toEqual({ recurrence: 'daily', weekday: null });
    expect(detectRecurrence('每周三晚上八点')).toEqual({ recurrence: 'weekly', weekday: 3 });
    expect(detectRecurrence('明天八点')).toEqual({ recurrence: 'none', weekday: null });
  });

  test('人类可读时间与重复描述', () => {
    expect(formatDueAt(localDate(2026, 9, 15, 14, 0), NOW)).toBe('今天 14:00');
    expect(formatDueAt(localDate(2026, 9, 16, 8, 30), NOW)).toBe('明天 08:30');
    expect(formatDueAt(localDate(2026, 9, 17, 20, 0), NOW)).toBe('后天 20:00');
    expect(formatRecurrence('daily', localDate(2026, 9, 15, 21, 0))).toBe('每天 21:00');
    expect(formatRecurrence('weekday', localDate(2026, 9, 16, 7, 0))).toBe('每个工作日 07:00');
    expect(formatRecurrence('weekly', localDate(2026, 9, 15, 20, 0), 2)).toBe('每周二 20:00');
  });

  test('周期任务的下一次触发时间总在未来', () => {
    const next = computeNextOccurrence(
      { recurrence: 'daily', dueAt: localDate(2026, 9, 15, 21, 0).toISOString(), weekday: null },
      NOW,
    );
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
    expect([next.getHours(), next.getMinutes()]).toEqual([21, 0]);
  });
});
