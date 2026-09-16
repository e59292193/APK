jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'mock-notification-id-123'),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
}));

import * as Notifications from 'expo-notifications';
import {
  createNotificationAdapter,
  requestNotificationPermission,
  ensureNotificationChannel,
  ensureNotificationHandler,
} from '../notificationAdapter';

describe('notificationAdapter 原生通知适配器', () => {
  let adapter;

  beforeEach(() => {
    jest.clearAllMocks();
    Notifications.getPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    Notifications.scheduleNotificationAsync.mockResolvedValue('notif-1');
    adapter = createNotificationAdapter();
  });

  test('初始化时配置 notificationHandler', () => {
    ensureNotificationHandler();
    expect(Notifications.setNotificationHandler).toHaveBeenCalled();
  });

  test('Android 环境下配置通知通道', async () => {
    await ensureNotificationChannel();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'momi-reminders',
      expect.objectContaining({
        name: 'momi 提醒',
      })
    );
  });

  test('权限检查与申请流程', async () => {
    const perm1 = await requestNotificationPermission();
    expect(perm1.granted).toBe(true);

    Notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'undetermined' });
    Notifications.requestPermissionsAsync.mockResolvedValueOnce({ granted: true, status: 'granted' });
    const perm2 = await requestNotificationPermission();
    expect(perm2.granted).toBe(true);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
  });

  test('present 正常呈现本地通知', async () => {
    const res = await adapter.present({ title: 'momi 提醒', body: '喝水啦', data: { key: 'val' } });
    expect(res.presented).toBe(true);
    expect(res.id).toBe('notif-1');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: 'momi 提醒',
          body: '喝水啦',
          data: { key: 'val' },
        }),
        trigger: null,
      })
    );
  });

  test('present 在权限拒绝时安全返回', async () => {
    Notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied' });
    Notifications.requestPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied' });
    const res = await adapter.present({ title: '测试', body: '测试' });
    expect(res.presented).toBe(false);
    expect(res.reason).toBe('permission_denied');
  });

  test('schedule 按日期调度通知并支持 taskId 去重', async () => {
    const futureDate = new Date(Date.now() + 120000);
    const res1 = await adapter.schedule({
      title: '记得吃药',
      body: '维生素C',
      date: futureDate,
      data: { taskId: 'task-abc' },
    });
    expect(res1.scheduled).toBe(true);
    expect(res1.id).toBe('notif-1');

    // 重复调度相同 taskId，安全短路去重
    const res2 = await adapter.schedule({
      title: '记得吃药',
      body: '维生素C',
      date: futureDate,
      data: { taskId: 'task-abc' },
    });
    expect(res2.scheduled).toBe(false);
    expect(res2.reason).toBe('duplicate_task');
  });

  test('schedule 处理非法日期', async () => {
    const res = await adapter.schedule({
      title: '测试',
      body: '非法时间',
      date: 'not-a-date',
    });
    expect(res.scheduled).toBe(false);
    expect(res.reason).toBe('invalid_date');
  });

  test('cancel 可按 taskId 或 notificationId 取消', async () => {
    const futureDate = new Date(Date.now() + 120000);
    await adapter.schedule({
      title: '测试',
      body: '内容',
      date: futureDate,
      data: { taskId: 'task-cancel' },
    });

    const cancelRes = await adapter.cancel('task-cancel');
    expect(cancelRes.cancelled).toBe(true);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-1');
  });

  test('cancelAll 清理所有通知与映射', async () => {
    const res = await adapter.cancelAll();
    expect(res.cancelledAll).toBe(true);
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
  });

  test('异常时安全降级不崩溃', async () => {
    Notifications.scheduleNotificationAsync.mockRejectedValueOnce(new Error('系统通知服务不可用'));
    const res = await adapter.present({ title: '测试', body: '内容' });
    expect(res.presented).toBe(false);
    expect(res.error).toBe('系统通知服务不可用');
  });
});
