// ═══════════════════════════════════════════════════════
// drawGuessRoom —— 你画我猜「对局状态层」
//
// 核心原则：所有轮次推进都用「条件更新」完成，把互斥交给 Postgres，
// 而不是依赖客户端的本地 savedRef 布尔量。
//
//   UPDATE drawguess_games SET ... WHERE id = ? AND status = ? AND round = ?
//
// 这样无论双方多少个通道（IM 信号 / DB 队列 / 轮询 / 超时兜底）同时触发，
// 只会有一个能真正写入（changed === true），其余均得到 0 行（changed === false），
// 轮次不会被推进两次，round_results 也不会重复。
//
// 倒计时以 DB 的 deadline_at 为唯一依据，双端完全一致；
// 提示加时只需刷新 deadline_at，对方会自动跟上。
// ═══════════════════════════════════════════════════════
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { pickRandomWords } from './drawGuessUtils';

export const TOTAL_ROUNDS = 6;
export const DRAW_SECONDS = 60;
export const HINT_EXTRA_SECONDS = 15;
// 倒计时归零后，若画题人迟迟不做决定（或已离线），多久后自动按超时结束本轮
export const TIMEOUT_GRACE_MS = 30000;

const MUTATE_OPTS = { timeout: 12000, retries: 2, retryDelay: 800 };

// ─── 时间计算（双端统一从 DB 行推导，不用本地独立计时）───
export function computeDeadlineMs(row) {
  if (!row) return 0;
  if (row.deadline_at) return new Date(row.deadline_at).getTime();
  // 向后兼容：旧数据没有 deadline_at 时按 started_at + 60s
  if (row.started_at) return new Date(row.started_at).getTime() + DRAW_SECONDS * 1000;
  return 0;
}

export function computeRemainSec(row, nowMs = Date.now()) {
  const deadline = computeDeadlineMs(row);
  if (!deadline) return DRAW_SECONDS;
  return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
}

// ─── 题库候选词 ───
export function makeWordChoices(customWords = [], n = 3) {
  return pickRandomWords(customWords, n).map((w) => ({ word: w }));
}

export function normalizeChoices(row) {
  const raw = (row && row.word_choices) || [];
  return raw.map((w) => (typeof w === 'string' ? w : w && w.word)).filter(Boolean);
}

/**
 * 把自己的自定义词混入候选词（仅本人可见）。
 * 按轮次确定性选择，而不是每次渲染随机——否则自定义词加载完成后
 * 候选词会在眼前突变，甚至选中前一秒还在变。
 */
export function mixCustomWord(choices, customWords, round) {
  const list = choices || [];
  if (list.length === 0) return list;
  const words = (customWords || [])
    .map((w) => (typeof w === 'string' ? w : w && w.word))
    .filter(Boolean);
  if (words.length === 0) return list;
  const pick = words[(Math.max(1, round || 1) - 1) % words.length];
  if (list.includes(pick)) return list;
  return [...list.slice(0, -1), pick];
}

// ─── 读取 ───
export async function fetchGameRow(gameId) {
  const { data, error } = await fetchWithTimeout(() =>
    supabase.from('drawguess_games').select('*').eq('id', gameId).maybeSingle()
  );
  if (error) throw error;
  return data || null;
}

export async function fetchCustomWords(userId) {
  const { data, error } = await fetchWithTimeout(() =>
    supabase
      .from('drawguess_custom_words')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
  );
  if (error) throw error;
  return data || [];
}

// ─── 创建对局 ───
export async function createGame(userId, partnerId, customWords = []) {
  const { data, error } = await fetchWithTimeout(() =>
    supabase
      .from('drawguess_games')
      .insert([
        {
          creator_id: userId,
          invitee_id: partnerId,
          status: 'waiting',
          round: 1,
          current_drawer: 'creator',
          word_choices: makeWordChoices(customWords, 3),
          round_results: [],
        },
      ])
      .select()
  );
  if (error) throw error;
  if (!data || !data[0]) throw new Error('创建对局失败：未返回数据');
  return data[0];
}

// ─── 受邀方加入（仅 waiting → picking，防止重复触发把进行中的对局打回 picking）───
export async function joinGame(gameId) {
  const { data, error } = await fetchWithTimeout(
    () =>
      supabase
        .from('drawguess_games')
        .update({ status: 'picking' })
        .eq('id', gameId)
        .eq('status', 'waiting')
        .select(),
    MUTATE_OPTS
  );
  if (error) throw error;
  const row = data && data[0] ? data[0] : null;
  return { row, changed: !!row };
}

// ─── 取消自己发出的、对方还未加入的邀请 ───
export async function cancelInvite(gameId) {
  const { error } = await fetchWithTimeout(
    () => supabase.from('drawguess_games').delete().eq('id', gameId).eq('status', 'waiting'),
    MUTATE_OPTS
  );
  if (error) throw error;
}

// ─── 画题人选词：picking → drawing，同时写入 deadline_at ───
export async function pickWord(gameId, round, word) {
  const now = Date.now();
  const patch = {
    status: 'drawing',
    word,
    started_at: new Date(now).toISOString(),
    deadline_at: new Date(now + DRAW_SECONDS * 1000).toISOString(),
    winner: null,
    hint: null,
  };
  const { data, error } = await fetchWithTimeout(
    () =>
      supabase
        .from('drawguess_games')
        .update(patch)
        .eq('id', gameId)
        .eq('round', round)
        .eq('status', 'picking')
        .select(),
    MUTATE_OPTS
  );
  if (error) throw error;
  const row = data && data[0] ? data[0] : null;
  return { row, changed: !!row };
}

// ─── 给提示 + 延长本轮时间（刷新 deadline_at，对方倒计时自动跟上）───
export async function sendHint(gameId, round, hint, extraSec = HINT_EXTRA_SECONDS) {
  const patch = {
    hint,
    deadline_at: new Date(Date.now() + extraSec * 1000).toISOString(),
  };
  const { data, error } = await fetchWithTimeout(
    () =>
      supabase
        .from('drawguess_games')
        .update(patch)
        .eq('id', gameId)
        .eq('round', round)
        .eq('status', 'drawing')
        .select(),
    MUTATE_OPTS
  );
  if (error) throw error;
  const row = data && data[0] ? data[0] : null;
  return { row, changed: !!row };
}

// ─── 本轮结果 ───
export function buildRoundResult(row, winner) {
  const startMs = row.started_at ? new Date(row.started_at).getTime() : Date.now();
  const duration = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  return {
    round: row.round,
    drawer: row.current_drawer,
    word: row.word,
    winner,
    duration: winner === 'win' ? duration : null,
  };
}

/**
 * 结束本轮并推进。
 *
 * 关键点：
 *   - WHERE status='drawing' AND round=当前轮 保证只有一方能写入
 *   - round_results 按 round 去重后再追加，即使上游数据脏也不会出现重复轮次
 *   - 返回 changed=false 时，调用方应该重新拉取最新行（对方已经推进了）
 *
 * @param {object} row      当前对局行
 * @param {string} winner   'win' | 'timeout' | 'gaveup'
 * @param {Array}  nextWords 下一轮候选词的混入词源（一般传空，各自本地混自己的词）
 */
export async function finishRound(row, winner, nextWords = []) {
  const result = buildRoundResult(row, winner);
  const prev = Array.isArray(row.round_results) ? row.round_results : [];
  const merged = [...prev.filter((r) => r && r.round !== result.round), result].sort(
    (a, b) => (a.round || 0) - (b.round || 0)
  );

  const nextRound = (row.round || 1) + 1;
  let patch;
  if (nextRound > TOTAL_ROUNDS) {
    patch = {
      status: 'finished',
      winner,
      finished_at: new Date().toISOString(),
      deadline_at: null,
      round_results: merged,
    };
  } else {
    patch = {
      status: 'picking',
      round: nextRound,
      current_drawer: row.current_drawer === 'creator' ? 'invitee' : 'creator',
      word: null,
      winner: null,
      hint: null,
      started_at: null,
      deadline_at: null,
      word_choices: makeWordChoices(nextWords, 3),
      round_results: merged,
    };
  }

  const { data, error } = await fetchWithTimeout(
    () =>
      supabase
        .from('drawguess_games')
        .update(patch)
        .eq('id', row.id)
        .eq('status', 'drawing')
        .eq('round', row.round)
        .select(),
    MUTATE_OPTS
  );
  if (error) throw error;
  const updated = data && data[0] ? data[0] : null;
  return { row: updated, changed: !!updated, result };
}

// ─── 再来一局：在旧对局上标记新对局 id，供对方轮询/信号发现并自动跟进 ───
export async function markRematch(oldGameId, newGameId, byUserId) {
  const { error } = await fetchWithTimeout(
    () =>
      supabase
        .from('drawguess_games')
        .update({ rematch_request_by: byUserId, rematch_game_id: newGameId })
        .eq('id', oldGameId),
    MUTATE_OPTS
  );
  if (error) throw error;
}

// ─── 画廊 ───
export async function fetchGallery(limit = 60) {
  const { data, error } = await fetchWithTimeout(() =>
    supabase
      .from('drawguess_gallery')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
  );
  if (error) throw error;
  return data || [];
}

export async function findGalleryEntry(gameId, round) {
  const { data, error } = await fetchWithTimeout(() =>
    supabase
      .from('drawguess_gallery')
      .select('id')
      .eq('game_id', gameId)
      .eq('round', round)
      .limit(1)
  );
  if (error) throw error;
  return data && data[0] ? data[0] : null;
}

export function resolveRoundResultLabel(row) {
  // 保存画作时确定 result 字段：优先用本轮已知结果，否则算未完成（timeout）
  if (!row) return 'timeout';
  if (row.winner === 'win' || row.winner === 'gaveup' || row.winner === 'timeout') return row.winner;
  const results = Array.isArray(row.round_results) ? row.round_results : [];
  const hit = results.find((r) => r && r.round === row.round);
  if (hit && hit.winner) return hit.winner;
  return 'timeout';
}
