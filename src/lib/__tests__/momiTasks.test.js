jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../fetchWithTimeout', () => ({ fetchWithTimeout: jest.fn((fn) => fn()) }));

import { supabase } from '../supabase';
import { parseReminderLocally, createTaskFromMessage } from '../momiTasks';

const localDate = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute, 0, 0);

function expectLocalTime(iso, { year, month, day, hour, minute = 0 }) {
  const value = new Date(iso);
  expect(value.getFullYear()).toBe(year);
  expect(value.getMonth() + 1).toBe(month);
  expect(value.getDate()).toBe(day);
  expect(value.getHours()).toBe(hour);
  expect(value.getMinutes()).toBe(minute);
}

describe('momiTasks 自然语言提醒解析', () => {
  test('解析分钟、小时、天后的相对提醒', () => {
    const now = localDate(2026, 9, 15, 8, 0);
    const tenMinutes = parseReminderLocally('momi，10分钟后提醒我喝水', now);
    const twoHours = parseReminderLocally('提醒我2小时后去取快递', now);
    const threeDays = parseReminderLocally('3天后提醒我交报告', now);

    expect(tenMinutes.title).toBe('喝水');
    expect(new Date(tenMinutes.dueAt).getTime() - now.getTime()).toBe(10 * 60 * 1000);
    expect(twoHours.title).toBe('取快递');
    expect(new Date(twoHours.dueAt).getTime() - now.getTime()).toBe(2 * 60 * 60 * 1000);
    expect(threeDays.title).toBe('交报告');
    expect(new Date(threeDays.dueAt).getTime() - now.getTime()).toBe(3 * 24 * 60 * 60 * 1000);
  });

  test('解析明天/后天与中文时段', () => {
    const now = localDate(2026, 9, 15, 8, 0);
    const tomorrow = parseReminderLocally('明天上午9点提醒我开会', now);
    const afterTomorrow = parseReminderLocally('后天晚上8点提醒我散步', now);

    expect(tomorrow.title).toBe('开会');
    expectLocalTime(tomorrow.dueAt, { year: 2026, month: 9, day: 16, hour: 9 });
    expect(afterTomorrow.title).toBe('散步');
    expectLocalTime(afterTomorrow.dueAt, { year: 2026, month: 9, day: 17, hour: 20 });
  });

  test('无年份日期早于当前日期时顺延到下一年', () => {
    const now = localDate(2026, 12, 31, 10, 0);
    const parsed = parseReminderLocally('1月2日上午10点提醒我续费', now);
    expect(parsed.title).toBe('续费');
    expectLocalTime(parsed.dueAt, { year: 2027, month: 1, day: 2, hour: 10 });
  });

  test('拒绝过去时间和不含明确提醒时间的普通聊天', () => {
    const now = localDate(2026, 9, 15, 18, 0);
    expect(parseReminderLocally('今天上午9点提醒我开会', now)).toBeNull();
    expect(parseReminderLocally('momi 今天心情怎么样', now)).toBeNull();
    expect(parseReminderLocally('', now)).toBeNull();
  });
});

describe('momiTasks 创建任务', () => {
  beforeEach(() => jest.clearAllMocks());

  test('解析成功后写入 couple/user/source_message_id', async () => {
    const inserted = { id: 'task-1', title: '喝水', status: 'active' };
    const select = jest.fn(async () => ({ data: [inserted], error: null }));
    const insert = jest.fn(() => ({ select }));
    supabase.from.mockReturnValue({ insert });

    const result = await createTaskFromMessage({
      userId: '苞米',
      message: '10分钟后提醒我喝水',
      sourceMessageId: 'message-123',
      now: localDate(2026, 9, 15, 8, 0),
    });

    expect(result).toEqual(inserted);
    expect(supabase.from).toHaveBeenCalledWith('momi_tasks');
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({
      couple_id: 'momo_and_baomi',
      created_by: '苞米',
      title: '喝水',
      status: 'active',
      source_message_id: 'message-123',
    })]);
  });

  test('解析失败时不访问 Supabase', async () => {
    await expect(createTaskFromMessage({ userId: 'momo', message: '你好呀', now: new Date() })).resolves.toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
