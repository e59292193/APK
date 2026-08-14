// 基于 Supabase 的可靠信号队列。IM 是低延迟通道，DB 队列负责丢包补偿。
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';

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
  } catch (error) {
    console.warn('[DrawGuessQueue] 写入信号失败:', type, error.message);
    return null;
  }
}

export async function pushSignals(gameId, items, senderId) {
  if (!gameId || !items || items.length === 0 || !senderId) return [];
  try {
    const rows = items.map((item) => ({
      game_id: gameId,
      type: item.type,
      data: item.data,
      sender_id: senderId,
    }));
    const { data, error } = await fetchWithTimeout(() =>
      supabase.from('drawguess_signals').insert(rows).select('id')
    );
    if (error) throw error;
    return (data || []).map((row) => row.id);
  } catch (error) {
    console.warn('[DrawGuessQueue] 批量写入信号失败:', error.message);
    return [];
  }
}

// 进入已进行多轮的对局时，直接把游标定位到最新一条，再通过 snapshot 补画布。
// 返回 null 表示查询失败（调用方再退回分页对齐）；没有历史信号时返回 0。
export async function getLatestSignalId(gameId) {
  if (!gameId) return 0;
  try {
    const { data, error } = await fetchWithTimeout(
      () =>
        supabase
          .from('drawguess_signals')
          .select('id')
          .eq('game_id', gameId)
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle(),
      { timeout: 10000, retries: 1, retryDelay: 500 }
    );
    if (error) throw error;
    return data && data.id ? data.id : 0;
  } catch (error) {
    console.warn('[DrawGuessQueue] 获取最新游标失败:', error.message);
    return null;
  }
}

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
    if (!data || data.length === 0) {
      return { signals: [], maxId: lastSeenId || 0 };
    }
    return { signals: data, maxId: data[data.length - 1].id };
  } catch (error) {
    console.warn('[DrawGuessQueue] 拉取信号失败:', error.message);
    return { signals: [], maxId: lastSeenId || 0 };
  }
}

// 仅可在确定整局已不再需要历史信号时调用；不要在回合切换时清理。
export async function clearSignals(gameId) {
  if (!gameId) return;
  try {
    await supabase.from('drawguess_signals').delete().eq('game_id', gameId);
  } catch (error) {
    // 清理失败不影响游戏。
  }
}
