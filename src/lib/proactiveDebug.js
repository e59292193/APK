// ═══════════════════════════════════════════════════════
// proactiveDebug.js —— 主动调度诊断与可观测性日志
// 记录最近 20 次调度检查结果到 AsyncStorage / 内存，供设置页与排查使用。
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';

export const PROACTIVE_DEBUG_KEY = '@momi_proactive_debug';
const MAX_DEBUG_RECORDS = 20;
let memoryDebugHistory = [];

export async function getProactiveDebugHistory() {
  try {
    const raw = await AsyncStorage.getItem(PROACTIVE_DEBUG_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch {}
  return memoryDebugHistory;
}

export async function recordProactiveDebug(entry = {}) {
  const item = {
    at: new Date().toISOString(),
    sent: Boolean(entry.sent),
    type: entry.type || null,
    reason: entry.reason || (entry.sent ? 'success' : 'none'),
    gate: entry.gate || null,
    checked: entry.checked || [],
  };
  memoryDebugHistory = [item, ...memoryDebugHistory].slice(0, MAX_DEBUG_RECORDS);
  try {
    await AsyncStorage.setItem(PROACTIVE_DEBUG_KEY, JSON.stringify(memoryDebugHistory));
  } catch {}
  return item;
}

export async function clearProactiveDebugHistory() {
  memoryDebugHistory = [];
  try {
    await AsyncStorage.removeItem(PROACTIVE_DEBUG_KEY);
  } catch {}
}
