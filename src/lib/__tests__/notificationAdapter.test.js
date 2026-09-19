const asyncStore = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => asyncStore[key] || null),
  setItem: jest.fn(async (key, value) => { asyncStore[key] = value; }),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'notif-1'),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  AndroidImportance: { MAX: 5, HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  AndroidNotificationPriority: { MAX: 'max' },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

import * as Notifications from 'expo-notifications';
import { createNotificationAdapter, requestNotificationPermission, ensureNotificationChannel } from '../notificationAdapter';

describe('notificationAdapter 系统级提醒', () => {
  let adapter;

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.keys(asyncStore).forEach((key) => delete asyncStore[key]);
    Notifications.getPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    Notifications.scheduleNotificationAsync.mockResolvedValue('notif-1');
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    adapter = createNotificationAdapter();
    await adapter.cancelAll();
    jest.clearAllMocks();
  });

  test('Android 使用 MAX 通知通道', async () => {
    await ensureNotificationChannel();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'momi-reminders',
      expect.objectContaining({ name: 'momi 提醒', importance: 5, sound: 'default' }),
    );
  });

  test('权限拒绝时不伪报预约成功', async () => {
    Notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied' });
    Notifications.requestPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied' });
    const result = await adapter.schedule({ date: new Date(Date.now() + 60000), data: { taskId: 'denied' } });
    expect(result).toEqual(expect.objectContaining({ scheduled: false, reason: 'permission_denied' }));
  });

  test('预约 DATE 系统通知并持久化 taskId 映射', async () => {
    const date = new Date(Date.now() + 120000);
    const result = await adapter.schedule({ title: 'momi 提醒', body: '喝水', date, data: { taskId: 'task-1' } });
    expect(result).toEqual(expect.objectContaining({ scheduled: true, id: 'notif-1' }));
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({ channelId: 'momi-reminders', sound: 'default' }),
      trigger: expect.objectContaining({ type: 'date', date, channelId: 'momi-reminders' }),
    }));
    expect(Object.values(asyncStore).join('')).toContain('notif-1');
  });

  test('映射和 OS 预约都存在时不重复预约', async () => {
    const date = new Date(Date.now() + 120000);
    await adapter.schedule({ date, data: { taskId: 'task-dedupe' } });
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValueOnce([{ identifier: 'notif-1' }]);
    Notifications.scheduleNotificationAsync.mockClear();
    const result = await adapter.schedule({ date, data: { taskId: 'task-dedupe' } });
    expect(result).toEqual(expect.objectContaining({ scheduled: true, reason: 'already_scheduled' }));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  test('映射存在但 OS 预约丢失时自动重建', async () => {
    const date = new Date(Date.now() + 120000);
    await adapter.schedule({ date, data: { taskId: 'task-rearm' } });
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValueOnce([]);
    Notifications.scheduleNotificationAsync.mockResolvedValueOnce('notif-2');
    const result = await adapter.schedule({ date, data: { taskId: 'task-rearm' } });
    expect(result).toEqual(expect.objectContaining({ scheduled: true, id: 'notif-2' }));
  });

  test('拒绝过去时间与非法时间', async () => {
    await expect(adapter.schedule({ date: 'bad' })).resolves.toEqual(expect.objectContaining({ reason: 'invalid_date' }));
    await expect(adapter.schedule({ date: new Date(Date.now() - 1000) })).resolves.toEqual(expect.objectContaining({ reason: 'past_date' }));
  });

  test('按 taskId 取消系统预约', async () => {
    const date = new Date(Date.now() + 120000);
    await adapter.schedule({ date, data: { taskId: 'task-cancel' } });
    const result = await adapter.cancel('task-cancel');
    expect(result.cancelled).toBe(true);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-1');
  });

  test('权限申请流程', async () => {
    const granted = await requestNotificationPermission();
    expect(granted.granted).toBe(true);
  });
});
