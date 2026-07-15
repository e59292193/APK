// ═══════════════════════════════════════════════════════
// drawGuessSignalQueue —— 基于 DB 的实时信号队列
//
// 腾讯 IM 自定义消息跨设备（模拟器↔手机）不够稳定，
// 这里用 Supabase 的 drawguess_signals 表做可靠消息队列：
//   - pushSignal(gameId, type, data, senderId)  写入一条信号
//   - pollSignals(gameId, lastSeenId)            拉取 id > lastSeenId 的信号
//
// DrawGuessGameScreen 每 1.5 秒轮询一次，保证笔画/弹幕/撤销/清空
// 都能可靠同步到对方。IM 信号保留为快速通道（可选）。
// ═══════════════════════════════════════════════════════
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';

/**
 * 写入一条信号到队列
 * @returns {Promise<number|null>} 新信号 id，失败返回 null
 */
export async function pushSignal(gameId, type, data, senderId) {
  if (!gameId || !type || !senderId) return null;
  try {
    const { data: rows, error } = await fetchWithTimeout(() =>
      supabase
        .from('drawguess_signals')
        .insert([{ game_id: gameId, type, data, sender_id: senderId }])
        .select('id')
    );
    if (error) throw error;
    return rows && rows[0] ? rows[0].id : null;
  } catch (e) {
    console.warn('[DGQueue] pushSignal failed:', type, e.message);
    return null;
  }
}

/**
 * 批量写入信号（用于一笔的多个点段）
 */
export async function pushSignals(gameId, items, senderId) {
  if (!gameId || !items || items.length === 0 || !senderId) return [];
  try {
    const rows = items.map((it) => ({
      game_id: gameId,
      type: it.type,
      data: it.data,
      sender_id: senderId,
    }));
    const { data: inserted, error } = await fetchWithTimeout(() =>
      supabase.from('drawguess_signals').insert(rows).select('id')
    );
    if (error) throw error;
    return (inserted || []).map((r) => r.id);
  } catch (e) {
    console.warn('[DGQueue] pushSignals failed:', e.message);
    return [];
  }
}

/**
 * 拉取 id > lastSeenId 的信号（增量）
 * @returns {Promise<{signals: Array, maxId: number}>}
 */
export async function pollSignals(gameId, lastSeenId) {
  if (!gameId) return { signals: [], maxId: lastSeenId || 0 };
  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase
        .from('drawguess_signals')
        .select('id, type, data, sender_id, created_at')
        .eq('game_id', gameId)
        .gt('id', lastSeenId || 0)
        .order('id', { ascending: true })
        .limit(200)
    );
    if (error) throw error;
    if (!data || data.length === 0) return { signals: [], maxId: lastSeenId || 0 };
    const maxId = data[data.length - 1].id;
    return { signals: data, maxId };
  } catch (e) {
    console.warn('[DGQueue] pollSignals failed:', e.message);
    return { signals: [], maxId: lastSeenId || 0 };
  }
}

/**
 * 清理某局游戏的信号（轮开始时调用，避免表无限增长）
 */
export async function clearSignals(gameId) {
  if (!gameId) return;
  try {
    await supabase.from('drawguess_signals').delete().eq('game_id', gameId);
  } catch (e) {
    /* 静默 */
  }
}
