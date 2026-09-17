// ═══════════════════════════════════════════════════════
// proactiveLog.js —— 可降级的主动消息事件去重与记录
// 云端 momi_proactive_log 优先，异常/表缺失时平滑降级至本地存储（AsyncStorage / 内存），
// 去重失败绝不阻止发送，避免主动消息静默吞没。
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';

export const COUPLE_ID = 'momo_and_baomi';
export const LOCAL_PROACTIVE_LOG_KEY = '@momi_proactive_log_local';
const MAX_LOCAL_LOGS = 300;
const LOG_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 天淘汰

let hasWarnedDowngrade = false;
const memoryLogs = new Map();

async function getLocalLogs() {
  const now = Date.now();
  try {
    const raw = await AsyncStorage.getItem(LOCAL_PROACTIVE_LOG_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        return list.filter((item) => item && (now - (item.at || 0) < LOG_EXPIRATION_MS));
      }
    }
  } catch {
    // AsyncStorage 在部分 Node/Jest 环境下不可用时回退到内存
  }

  const memList = [];
  memoryLogs.forEach((at, eventKey) => {
    if (now - at < LOG_EXPIRATION_MS) {
      memList.push({ eventKey, at });
    }
  });
  return memList;
}

async function saveLocalLogs(logs) {
  const trimmed = logs.slice(-MAX_LOCAL_LOGS);
  trimmed.forEach((item) => memoryLogs.set(item.eventKey, item.at || Date.now()));
  try {
    await AsyncStorage.setItem(LOCAL_PROACTIVE_LOG_KEY, JSON.stringify(trimmed));
  } catch {
    // AsyncStorage 不可用时静默保持内存备份
  }
}

/**
 * 判断事件是否已发送过。
 * 先查云端；若云端不可用（表缺失 42P01、网络异常等），自动降级查本地记录。
 * @param {string} eventKey - 事件唯一键
 * @returns {Promise<boolean>} true 表示已发送过；false 表示未发送
 */
export async function hasSentEvent(eventKey) {
  if (!eventKey) return false;

  let cloudChecked = false;
  try {
    const res = await fetchWithTimeout(() =>
      supabase
        .from('momi_proactive_log')
        .select('id')
        .eq('couple_id', COUPLE_ID)
        .eq('event_key', eventKey)
        .maybeSingle()
    );

    if (res && res.error) {
      throw res.error;
    }

    cloudChecked = true;
    if (res?.data) {
      return true;
    }
  } catch (cloudErr) {
    if (!hasWarnedDowngrade) {
      hasWarnedDowngrade = true;
      console.warn('[proactiveLog] 云端去重不可用，已平滑降级至本地去重存储:', cloudErr.message);
    }
  }

  // 云端未查到已发送，或云端查询失败降级至本地
  const localLogs = await getLocalLogs();
  const existsLocally = localLogs.some((l) => l.eventKey === eventKey);

  if (cloudChecked) {
    return false;
  }
  return existsLocally;
}

/**
 * 记录已成功发送的事件。
 * 同时记录至云端与本地（双保险）。
 * @param {string} eventKey
 * @param {string} eventType
 * @param {object} payload
 */
export async function recordSentEvent(eventKey, eventType, payload = {}) {
  if (!eventKey) return;

  const now = Date.now();
  // 1. 本地立即记录，确保离线或云端失败时不丢失去重
  memoryLogs.set(eventKey, now);
  const localLogs = await getLocalLogs();
  if (!localLogs.some((l) => l.eventKey === eventKey)) {
    localLogs.push({ eventKey, eventType, at: now });
    await saveLocalLogs(localLogs);
  }

  // 2. 尝试写入云端
  try {
    await fetchWithTimeout(() =>
      supabase.from('momi_proactive_log').insert([{
        couple_id: COUPLE_ID,
        event_key: eventKey,
        event_type: eventType,
        payload: payload || {},
        created_at: new Date().toISOString(),
      }]),
    { kind: 'write' });
  } catch (err) {
    console.warn('[proactiveLog] 写入云端去重记录失败（已降级本地记录）:', err.message);
  }
}
