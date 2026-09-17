// momi 原生通知适配器：基于 expo-notifications 实现 present / schedule / cancel / cancelAll
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const CHANNEL_ID = 'momi-reminders';

let handlerConfigured = false;
let channelConfigured = false;

// 记录 taskId -> notificationId 映射，支持按任务 ID 取消并防重复调度
const taskNotificationMap = new Map();

export function ensureNotificationHandler() {
  if (handlerConfigured) return;
  try {
    if (typeof Notifications.setNotificationHandler === 'function') {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      handlerConfigured = true;
    }
  } catch (err) {
    console.warn('[notificationAdapter] setNotificationHandler 失败:', err.message);
  }
}

export async function ensureNotificationChannel() {
  if (channelConfigured || Platform.OS !== 'android') return;
  try {
    if (typeof Notifications.setNotificationChannelAsync === 'function') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'momi 提醒',
        importance: Notifications.AndroidImportance?.HIGH ?? 4,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF6B35',
        sound: 'default',
      });
      channelConfigured = true;
    }
  } catch (err) {
    console.warn('[notificationAdapter] setNotificationChannelAsync 失败:', err.message);
  }
}

export async function requestNotificationPermission() {
  try {
    if (typeof Notifications.getPermissionsAsync !== 'function') {
      return { granted: false, status: 'unavailable' };
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || current.status === 'granted') {
      return { granted: true, status: current.status };
    }
    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    return {
      granted: requested.granted || requested.status === 'granted',
      status: requested.status,
    };
  } catch (err) {
    console.warn('[notificationAdapter] 请求通知权限异常:', err.message);
    return { granted: false, error: err.message };
  }
}

export function createNotificationAdapter() {
  ensureNotificationHandler();

  return {
    /** 立即呈现一条本地通知 */
    present: async ({ title, body, data = {} }) => {
      try {
        await ensureNotificationChannel();
        const permission = await requestNotificationPermission();
        if (!permission.granted) {
          return { presented: false, reason: 'permission_denied' };
        }
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: title || 'momi 🐾',
            body: body || '',
            data: data || {},
            sound: true,
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
          },
          trigger: null,
        });
        return { presented: true, id };
      } catch (err) {
        console.warn('[notificationAdapter] present 失败:', err.message);
        return { presented: false, error: err.message };
      }
    },

    /** 在指定时刻调度一条通知 */
    schedule: async ({ title, body, date, data = {} }) => {
      try {
        const targetDate = date instanceof Date ? date : new Date(date);
        if (isNaN(targetDate.getTime())) {
          return { scheduled: false, reason: 'invalid_date' };
        }

        const taskId = data?.taskId ? String(data.taskId) : null;
        if (taskId && taskNotificationMap.has(taskId)) {
          return { scheduled: false, reason: 'duplicate_task', id: taskNotificationMap.get(taskId) };
        }

        await ensureNotificationChannel();
        const permission = await requestNotificationPermission();
        if (!permission.granted) {
          return { scheduled: false, reason: 'permission_denied' };
        }

        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: title || 'momi 提醒你 🐾',
            body: body || '',
            data: data || {},
            sound: true,
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes?.DATE || 'date',
            date: targetDate,
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
          },
        });

        if (taskId && id) {
          taskNotificationMap.set(taskId, id);
        }
        return { scheduled: true, id };
      } catch (err) {
        console.warn('[notificationAdapter] schedule 失败:', err.message);
        return { scheduled: false, error: err.message };
      }
    },

    /** 取消指定通知（可传 notificationId 或 taskId） */
    cancel: async (idOrTaskId) => {
      if (!idOrTaskId) return { cancelled: false };
      try {
        const key = String(idOrTaskId);
        const mappedId = taskNotificationMap.get(key);
        const idToCancel = mappedId || key;

        if (typeof Notifications.cancelScheduledNotificationAsync === 'function') {
          await Notifications.cancelScheduledNotificationAsync(idToCancel);
        }
        if (mappedId) {
          taskNotificationMap.delete(key);
        }
        return { cancelled: true, id: idToCancel };
      } catch (err) {
        console.warn('[notificationAdapter] cancel 失败:', err.message);
        return { cancelled: false, error: err.message };
      }
    },

    /** 退出登录或重置时，清理所有已调度通知 */
    cancelAll: async () => {
      try {
        if (typeof Notifications.cancelAllScheduledNotificationsAsync === 'function') {
          await Notifications.cancelAllScheduledNotificationsAsync();
        }
        taskNotificationMap.clear();
        return { cancelledAll: true };
      } catch (err) {
        console.warn('[notificationAdapter] cancelAll 失败:', err.message);
        return { cancelledAll: false, error: err.message };
      }
    },
  };
}
