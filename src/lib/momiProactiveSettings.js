// momi 主动消息与天气偏好（仅设备级；两人可分别设置自己的免扰习惯）
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@momi_proactive_settings:';

export const DEFAULT_PROACTIVE_SETTINGS = {
  proactiveEnabled: true,
  nameWakeEnabled: true,
  quietStart: '22:30',
  quietEnd: '09:00',
  silenceHours: 4,
  dailyCap: 3,
  greetingEnabled: true,
  anniversaryEnabled: true,
  weatherEnabled: true,
  city: '',
  latitude: null,
  longitude: null,
  resolvedAt: null,
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

/**
 * 获取生效偏好（统一 userId 策略）：
 * 优先取当前用户的设置；当前用户未填城市时回退到本设备上已保存的任一份含城市设置，避免两人分开设置导致读不到。
 */
export async function getEffectiveProactiveSettings(userId) {
  const current = await getProactiveSettings(userId);
  if (current.city || (Number.isFinite(current.latitude) && Number.isFinite(current.longitude))) {
    return current;
  }

  // 尝试从备选用户读取有效位置
  const candidateKeys = ['momo', '苞米', 'default'].filter((u) => u !== userId);
  for (const fallbackUser of candidateKeys) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const other = await getProactiveSettings(fallbackUser);
      if (other.city || (Number.isFinite(other.latitude) && Number.isFinite(other.longitude))) {
        return {
          ...current,
          city: other.city || current.city,
          latitude: other.latitude ?? current.latitude,
          longitude: other.longitude ?? current.longitude,
          resolvedAt: other.resolvedAt ?? current.resolvedAt,
        };
      }
    } catch {}
  }

  return current;
}

export async function saveProactiveSettings(userId, patch) {
  const current = await getProactiveSettings(userId);
  const next = { ...current, ...patch };
  next.dailyCap = Math.max(0, Math.min(8, Number(next.dailyCap) ?? 3));
  next.silenceHours = Math.max(1, Math.min(72, Number(next.silenceHours) ?? 4));
  await AsyncStorage.setItem(key(userId), JSON.stringify(next));
  return next;
}
