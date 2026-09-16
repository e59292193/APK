// ═══════════════════════════════════════════════════════
// momiUnread.js —— momi 助手未读主动消息计数与已读标记
// 依据 @momi_assistant_last_seen_at 统计最新未读主动关怀，
// 进入助手页面即清零。
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';

export const MOMI_ASSISTANT_LAST_SEEN_KEY = '@momi_assistant_last_seen_at';
export const COUPLE_ID = 'momo_and_baomi';

let cachedUnreadCount = 0;

export async function getLastSeenAt() {
  try {
    const val = await AsyncStorage.getItem(MOMI_ASSISTANT_LAST_SEEN_KEY);
    return val || null;
  } catch {
    return null;
  }
}

export async function markMomiAssistantSeen() {
  const nowStr = new Date().toISOString();
  cachedUnreadCount = 0;
  try {
    await AsyncStorage.setItem(MOMI_ASSISTANT_LAST_SEEN_KEY, nowStr);
  } catch (err) {
    console.warn('[momiUnread] 标记助手已读失败:', err.message);
  }
  return nowStr;
}

export async function getUnreadProactiveCount() {
  try {
    const lastSeen = await getLastSeenAt();
    let query = supabase
      .from('momi_assistant_messages')
      .select('id', { count: 'exact', head: true })
      .eq('couple_id', COUPLE_ID)
      .eq('is_proactive', true);

    if (lastSeen) {
      query = query.gt('created_at', lastSeen);
    }

    const res = await fetchWithTimeout(() => query);
    if (res && res.error) {
      // 表缺失或字段缺失时降级为 0，不阻塞 UI
      return cachedUnreadCount;
    }
    cachedUnreadCount = Number(res?.count) || 0;
    return cachedUnreadCount;
  } catch (err) {
    console.warn('[momiUnread] 获取未读主动消息数异常:', err.message);
    return cachedUnreadCount;
  }
}
