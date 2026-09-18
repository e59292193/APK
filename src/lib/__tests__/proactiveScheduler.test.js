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
// 本用例只关心云端到期任务的调度行为，本地兜底任务由 momiTasks 自己的用例覆盖
jest.mock('../momiTasks', () => ({
  getDueLocalTasks: jest.fn(async () => []),
  markLocalTaskFired: jest.fn(async () => undefined),
  listMomiTasks: jest.fn(async () => []),
  updateMomiTask: jest.fn(async () => null),
  cancelMomiTask: jest.fn(async () => null),
  completeMomiTask: jest.fn(async () => null),
  formatTaskReceipt: jest.fn(() => ''),
  formatTasksSummary: jest.fn(() => ''),
}));

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
const DUE_TASK = { id: 'task-1', title: '喝水', due_at: '2026-09-15T11:59:00.000Z' };

function queryChain(result) {
  const chain = {};
  ['select', 'eq', 'is', 'lte', 'gte', 'order', 'not', 'in'].forEach((method) => {
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

/** 组装 momi_tasks / momi_proactive_log 两张表的 mock */
function mockTables({ tasks = [], logs = logTable() } = {}) {
  const taskQuery = queryChain({ data: tasks, error: null });
  const updateEq = jest.fn(async () => ({ error: null }));
  const update = jest.fn(() => ({ eq: updateEq }));
  supabase.from.mockImplementation((table) => {
    if (table === 'momi_tasks') return { ...taskQuery, update };
    if (table === 'momi_proactive_log') return logs;
    throw new Error(`unexpected table ${table}`);
  });
  return { taskQuery, update, updateEq, logs };
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

  test('无到期任务且总开关关闭时，不走 AI、不写日志', async () => {
    getProactiveSettings.mockResolvedValue({ ...SETTINGS, proactiveEnabled: false });
    mockTables({ tasks: [] });

    await expect(tickProactiveScheduler({ userId: 'momo', now: NOW }))
      .resolves.toEqual({ sent: false, reason: 'disabled' });

    expect(chatWithMomi).not.toHaveBeenCalled();
    expect(saveAssistantMessage).not.toHaveBeenCalled();
    expect(getWeather).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalledWith('momi_proactive_log');
  });

  test('总开关关闭也必须投递到期提醒（用户自己设的提醒不属于主动关心）', async () => {
    getProactiveSettings.mockResolvedValue({ ...SETTINGS, proactiveEnabled: false });
    const { update, updateEq } = mockTables({ tasks: [DUE_TASK] });
    const onMessage = jest.fn();

    const result = await tickProactiveScheduler({ userId: 'momo', onMessage, now: NOW });

    expect(result.sent).toBe(true);
    expect(result.type).toBe('scheduled_reminder');
    expect(update).toHaveBeenCalledWith({ notified_at: NOW.toISOString(), status: 'done' });
    expect(updateEq).toHaveBeenCalledWith('id', 'task-1');
    expect(onMessage).toHaveBeenCalled();
    expect(chatWithMomi).not.toHaveBeenCalled();
    expect(markProactiveSent).not.toHaveBeenCalled();
  });

  test('免扰时段只拦主动关心，不拦到期提醒', async () => {
    canSendProactive.mockReturnValue({ allowed: false, reason: 'quiet_hours', today: '2026-09-15' });
    mockTables({ tasks: [DUE_TASK] });

    const result = await tickProactiveScheduler({ userId: '苞米', now: NOW });

    expect(result.sent).toBe(true);
    expect(result.type).toBe('scheduled_reminder');
    expect(chatWithMomi).not.toHaveBeenCalled();
  });

  test('免扰或每日上限门禁原因原样返回（无到期任务时）', async () => {
    canSendProactive.mockReturnValue({ allowed: false, reason: 'quiet_hours', today: '2026-09-15' });
    mockTables({ tasks: [] });

    await expect(tickProactiveScheduler({ userId: '苞米', now: NOW }))
      .resolves.toEqual({ sent: false, reason: 'quiet_hours' });

    expect(chatWithMomi).not.toHaveBeenCalled();
    expect(saveAssistantMessage).not.toHaveBeenCalled();
  });

  test('到期任务优先送达并标记 done', async () => {
    const { update, updateEq } = mockTables({ tasks: [DUE_TASK] });
    const onMessage = jest.fn();

    const result = await tickProactiveScheduler({ userId: 'momo', onMessage, now: NOW });

    expect(result.sent).toBe(true);
    expect(result.type).toBe('scheduled_reminder');
    expect(saveAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'momi', isProactive: true, triggerSource: 'scheduled_reminder',
    }));
    expect(update).toHaveBeenCalledWith({ notified_at: NOW.toISOString(), status: 'done' });
    expect(updateEq).toHaveBeenCalledWith('id', 'task-1');
    expect(onMessage).toHaveBeenCalled();
    expect(getWeather).not.toHaveBeenCalled();
    expect(chatWithMomi).not.toHaveBeenCalled();
    // 提醒不占用主动关心的每日额度
    expect(markProactiveSent).not.toHaveBeenCalled();
  });

  test('主动关心 event_key 已存在时不重复保存', async () => {
    mockTables({ tasks: [], logs: logTable({ existing: { id: 'log-existing' } }) });

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
    await expect(scheduleNativeTaskNotification({ id: 'task-1', title: '喝水', due_at: new Date(Date.now() + 3600000).toISOString() }))
      .resolves.toEqual({ scheduled: false, reason: 'adapter_missing' });
  });

  test('adapter 存在时传递标题、时间和 taskId', async () => {
    const schedule = jest.fn(async () => 'notification-1');
    setNotificationAdapter({ schedule });
    const dueAt = new Date(Date.now() + 3600000).toISOString();
    await expect(scheduleNativeTaskNotification({ id: 'task-2', title: '拿快递', due_at: dueAt }))
      .resolves.toEqual({ scheduled: true });
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      title: 'momi 提醒你 🐾',
      body: '拿快递',
      date: expect.any(Date),
      data: { taskId: 'task-2' },
    }));
  });
});
