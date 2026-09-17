jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../fetchWithTimeout', () => ({ fetchWithTimeout: jest.fn((fn) => fn()) }));
jest.mock('../momiAssistant', () => ({
  COUPLE_ID: 'momo_and_baomi',
  chatWithMomi: jest.fn(),
  saveAssistantMessage: jest.fn(),
}));
jest.mock('../momiState', () => ({
  getMomiState: jest.fn(),
  canSendProactive: jest.fn(),
  markProactiveSent: jest.fn(),
}));
jest.mock('../momiProactiveSettings', () => ({ getProactiveSettings: jest.fn() }));
jest.mock('../weatherService', () => ({ getWeather: jest.fn(), getWeatherAlert: jest.fn() }));

import { supabase } from '../supabase';
import { chatWithMomi, saveAssistantMessage } from '../momiAssistant';
import { getMomiState, canSendProactive, markProactiveSent } from '../momiState';
import { getProactiveSettings } from '../momiProactiveSettings';
import { getWeather } from '../weatherService';
import { setNotificationAdapter, tickProactiveScheduler, scheduleNativeTaskNotification } from '../proactiveScheduler';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const SETTINGS = {
  proactiveEnabled: true,
  weatherEnabled: false,
  city: '',
  latitude: null,
  silenceHours: 8,
  dailyCap: 3,
  quietStart: '22:30',
  quietEnd: '09:00',
};
const STATE = {
  last_interaction_at: '2026-09-15T00:00:00.000Z',
  proactive_count_today: 0,
};

function queryChain(result) {
  const chain = {};
  ['select', 'eq', 'is', 'lte', 'order'].forEach((method) => {
    chain[method] = jest.fn(() => chain);
  });
  chain.limit = jest.fn(async () => result);
  return chain;
}

function logTable({ existing = null, insertError = null } = {}) {
  const maybeSingle = jest.fn(async () => ({ data: existing, error: null }));
  const chain = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.maybeSingle = maybeSingle;
  chain.insert = jest.fn(async () => ({ data: null, error: insertError }));
  return chain;
}

describe('proactiveScheduler 主动消息调度', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setNotificationAdapter(null);
    getProactiveSettings.mockResolvedValue({ ...SETTINGS });
    getMomiState.mockResolvedValue({ ...STATE });
    canSendProactive.mockReturnValue({ allowed: true, today: '2026-09-15' });
    markProactiveSent.mockResolvedValue(undefined);
    saveAssistantMessage.mockResolvedValue({ id: 'momi-message-1', content: '提醒内容' });
    chatWithMomi.mockResolvedValue({ success: true, content: '你们忙完记得休息一下呀 🐾' });
  });

  test('总开关关闭时不访问状态、AI 或数据库', async () => {
    getProactiveSettings.mockResolvedValue({ ...SETTINGS, proactiveEnabled: false });
    await expect(tickProactiveScheduler({ userId: 'momo', now: NOW })).resolves.toEqual({ sent: false, reason: 'disabled' });
    expect(getMomiState).not.toHaveBeenCalled();
    expect(chatWithMomi).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('免扰或每日上限门禁原因原样返回', async () => {
    canSendProactive.mockReturnValue({ allowed: false, reason: 'quiet_hours', today: '2026-09-15' });
    await expect(tickProactiveScheduler({ userId: '苞米', now: NOW })).resolves.toEqual({ sent: false, reason: 'quiet_hours' });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(chatWithMomi).not.toHaveBeenCalled();
  });

  test('到期任务优先送达并标记 done', async () => {
    const task = { id: 'task-1', title: '喝水', due_at: '2026-09-15T11:59:00.000Z' };
    const taskQuery = queryChain({ data: [task], error: null });
    const updateEq = jest.fn(async () => ({ error: null }));
    const update = jest.fn(() => ({ eq: updateEq }));
    const logs = logTable();
    supabase.from.mockImplementation((table) => {
      if (table === 'momi_tasks') return { ...taskQuery, update };
      if (table === 'momi_proactive_log') return logs;
      throw new Error(`unexpected table ${table}`);
    });
    const onMessage = jest.fn();

    const result = await tickProactiveScheduler({ userId: 'momo', onMessage, now: NOW });

    expect(result.sent).toBe(true);
    expect(result.type).toBe('scheduled_reminder');
    expect(saveAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'momi', isProactive: true, triggerSource: 'scheduled_reminder',
    }));
    expect(update).toHaveBeenCalledWith({ notified_at: NOW.toISOString(), status: 'done' });
    expect(updateEq).toHaveBeenCalledWith('id', 'task-1');
    expect(markProactiveSent).toHaveBeenCalledWith(expect.any(Object), '2026-09-15');
    expect(onMessage).toHaveBeenCalled();
    expect(getWeather).not.toHaveBeenCalled();
    expect(chatWithMomi).not.toHaveBeenCalled();
  });

  test('主动关心 event_key 已存在时不重复保存', async () => {
    const taskQuery = queryChain({ data: [], error: null });
    const logs = logTable({ existing: { id: 'log-existing' } });
    supabase.from.mockImplementation((table) => {
      if (table === 'momi_tasks') return taskQuery;
      if (table === 'momi_proactive_log') return logs;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await tickProactiveScheduler({ userId: 'momo', now: NOW });

    expect(chatWithMomi).toHaveBeenCalled();
    expect(result).toEqual({ sent: false, reason: 'deduped' });
    expect(saveAssistantMessage).not.toHaveBeenCalled();
    expect(markProactiveSent).not.toHaveBeenCalled();
  });
});

describe('proactiveScheduler 原生通知 adapter', () => {
  beforeEach(() => setNotificationAdapter(null));
  afterEach(() => setNotificationAdapter(null));

  test('adapter 缺失时明确返回未调度', async () => {
    await expect(scheduleNativeTaskNotification({ id: 'task-1', title: '喝水', due_at: NOW.toISOString() }))
      .resolves.toEqual({ scheduled: false, reason: 'adapter_missing' });
  });

  test('adapter 存在时传递标题、时间和 taskId', async () => {
    const schedule = jest.fn(async () => 'notification-1');
    setNotificationAdapter({ schedule });
    await expect(scheduleNativeTaskNotification({ id: 'task-2', title: '拿快递', due_at: NOW.toISOString() }))
      .resolves.toEqual({ scheduled: true });
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      title: 'momi 提醒你 🐾',
      body: '拿快递',
      date: expect.any(Date),
      data: { taskId: 'task-2' },
    }));
  });
});
