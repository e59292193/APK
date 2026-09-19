// momi 原生通知适配器：系统级预约，App 退出/进程被杀后仍由 OS 触发
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const CHANNEL_ID = 'momi-reminders';
const TASK_NOTIFICATION_IDS_KEY = '@momi_task_notification_ids_v2';

let handlerConfigured = false;
let channelConfigured = false;
let mapLoaded = false;
const taskNotificationMap = new Map();

function safeMessage(error) {
  return String(error?.message || error?.code || 'UNKNOWN');
}

async function loadNotificationMap() {
  if (mapLoaded) return;
  mapLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(TASK_NOTIFICATION_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') {
      Object.entries(parsed).forEach(([taskId, notificationId]) => {
        if (taskId && notificationId) taskNotificationMap.set(String(taskId), String(notificationId));
      });
    }
  } catch (error) {
    console.warn('[notificationAdapter] 读取通知映射失败:', safeMessage(error));
  }
}

async function persistNotificationMap() {
  try {
    await AsyncStorage.setItem(TASK_NOTIFICATION_IDS_KEY, JSON.stringify(Object.fromEntries(taskNotificationMap.entries())));
  } catch (error) {
    console.warn('[notificationAdapter] 保存通知映射失败:', safeMessage(error));
  }
}

async function scheduledNotificationIds() {
  if (typeof Notifications.getAllScheduledNotificationsAsync !== 'function') return null;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return new Set((scheduled || []).map((item) => String(item.identifier || '')).filter(Boolean));
  } catch (error) {
    console.warn('[notificationAdapter] 读取系统预约失败:', safeMessage(error));
    return null;
  }
}

export function ensureNotificationHandler() {
  if (handlerConfigured) return;
  try {
    if (typeof Notifications.setNotificationHandler === 'function') {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      handlerConfigured = true;
    }
  } catch (error) {
    console.warn('[notificationAdapter] setNotificationHandler 失败:', safeMessage(error));
  }
}

export async function ensureNotificationChannel() {
  if (channelConfigured || Platform.OS !== 'android') return;
  try {
    if (typeof Notifications.setNotificationChannelAsync === 'function') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'momi 提醒',
        description: 'momi 定时任务与重要提醒',
        importance: Notifications.AndroidImportance?.MAX ?? 5,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF6B35',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PUBLIC,
        sound: 'default',
      });
      channelConfigured = true;
    }
  } catch (error) {
    console.warn('[notificationAdapter] setNotificationChannelAsync 失败:', safeMessage(error));
  }
}

export async function requestNotificationPermission() {
  try {
    if (typeof Notifications.getPermissionsAsync !== 'function') return { granted: false, status: 'unavailable' };
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || current.status === 'granted') return { granted: true, status: current.status };
    const requested = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return { granted: requested.granted || requested.status === 'granted', status: requested.status };
  } catch (error) {
    console.warn('[notificationAdapter] 请求通知权限异常:', safeMessage(error));
    return { granted: false, error: safeMessage(error) };
  }
}

export async function ensureNotificationSetup() {
  ensureNotificationHandler();
  await ensureNotificationChannel();
  await loadNotificationMap();
  return requestNotificationPermission();
}

export function createNotificationAdapter() {
  ensureNotificationHandler();

  return {
    present: async ({ title, body, data = {} }) => {
      try {
        const permission = await ensureNotificationSetup();
        if (!permission.granted) return { presented: false, reason: 'permission_denied' };
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: title || 'momi 🐾', body: body || '', data: data || {}, sound: 'default',
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
          },
          trigger: null,
        });
        return { presented: true, id };
      } catch (error) {
        console.warn('[notificationAdapter] present 失败:', safeMessage(error));
        return { presented: false, error: safeMessage(error) };
      }
    },

    schedule: async ({ title, body, date, data = {} }) => {
      try {
        const targetDate = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(targetDate.getTime())) return { scheduled: false, reason: 'invalid_date' };
        if (targetDate.getTime() <= Date.now()) return { scheduled: false, reason: 'past_date' };

        const permission = await ensureNotificationSetup();
        if (!permission.granted) return { scheduled: false, reason: 'permission_denied' };

        const taskId = data?.taskId == null ? null : String(data.taskId);
        if (taskId && taskNotificationMap.has(taskId)) {
          const mappedId = taskNotificationMap.get(taskId);
          const osIds = await scheduledNotificationIds();
          if (osIds === null || osIds.has(mappedId)) return { scheduled: true, reason: 'already_scheduled', id: mappedId };
          taskNotificationMap.delete(taskId);
          await persistNotificationMap();
        }

        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: title || 'momi 提醒你 🐾', body: body || '', data: data || {}, sound: 'default',
            priority: Notifications.AndroidNotificationPriority?.MAX,
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes?.DATE || 'date',
            date: targetDate,
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
          },
        });

        if (taskId && id) {
          taskNotificationMap.set(taskId, String(id));
          await persistNotificationMap();
        }
        return { scheduled: true, id };
      } catch (error) {
        console.warn('[notificationAdapter] schedule 失败:', safeMessage(error));
        return { scheduled: false, reason: 'schedule_failed', error: safeMessage(error) };
      }
    },

    cancel: async (idOrTaskId) => {
      if (!idOrTaskId) return { cancelled: false };
      try {
        await loadNotificationMap();
        const key = String(idOrTaskId);
        const mappedId = taskNotificationMap.get(key);
        const idToCancel = mappedId || key;
        if (typeof Notifications.cancelScheduledNotificationAsync === 'function') {
          await Notifications.cancelScheduledNotificationAsync(idToCancel);
        }
        if (mappedId) {
          taskNotificationMap.delete(key);
          await persistNotificationMap();
        }
        return { cancelled: true, id: idToCancel };
      } catch (error) {
        console.warn('[notificationAdapter] cancel 失败:', safeMessage(error));
        return { cancelled: false, error: safeMessage(error) };
      }
    },

    cancelAll: async () => {
      try {
        if (typeof Notifications.cancelAllScheduledNotificationsAsync === 'function') {
          await Notifications.cancelAllScheduledNotificationsAsync();
        }
        taskNotificationMap.clear();
        await persistNotificationMap();
        return { cancelledAll: true };
      } catch (error) {
        console.warn('[notificationAdapter] cancelAll 失败:', safeMessage(error));
        return { cancelledAll: false, error: safeMessage(error) };
      }
    },

    inspect: async () => {
      await loadNotificationMap();
      const ids = await scheduledNotificationIds();
      return { mapped: taskNotificationMap.size, scheduled: ids ? ids.size : null };
    },
  };
}
