// momi 主动消息与天气偏好（仅设备级；两人可分别设置自己的免扰习惯）
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@momi_proactive_settings:';

export const DEFAULT_PROACTIVE_SETTINGS = {
  proactiveEnabled: true,
  nameWakeEnabled: true,
  quietStart: '22:30',
  quietEnd: '09:00',
  silenceHours: 8,
  dailyCap: 3,
  weatherEnabled: true,
  city: '',
  latitude: null,
  longitude: null,
};

function key(userId) {
  return `${PREFIX}${userId || 'default'}`;
}

export async function getProactiveSettings(userId) {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    return raw ? { ...DEFAULT_PROACTIVE_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_PROACTIVE_SETTINGS };
  } catch {
    return { ...DEFAULT_PROACTIVE_SETTINGS };
  }
}

export async function saveProactiveSettings(userId, patch) {
  const current = await getProactiveSettings(userId);
  const next = { ...current, ...patch };
  next.dailyCap = Math.max(0, Math.min(3, Number(next.dailyCap) || 3));
  next.silenceHours = Math.max(1, Math.min(72, Number(next.silenceHours) || 8));
  await AsyncStorage.setItem(key(userId), JSON.stringify(next));
  return next;
}
