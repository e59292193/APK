// 你画我猜对局状态层：阶段推进均使用 status + round 条件更新，
// 将双方同时操作时的互斥交给 Postgres，避免重复结算与跳轮。
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { pickRandomWords } from './drawGuessUtils';

export const TOTAL_ROUNDS = 6;
export const DRAW_SECONDS = 60;
export const HINT_EXTRA_SECONDS = 15;
export const TIMEOUT_GRACE_MS = 30000;

const MUTATE_OPTS = { timeout: 12000, retries: 2, retryDelay: 800 };
const INSERT_ONCE_OPTS = { timeout: 15000, retries: 0, retryDelay: 0 };

function makeUuid() {
  const bytes = new Uint8Array(16);
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function computeDeadlineMs(row) {
  if (!row) return 0;
  if (row.deadline_at) {
    const value = new Date(row.deadline_at).getTime();
    if (Number.isFinite(value)) return value;
  }
  if (row.started_at) {
    const value = new Date(row.started_at).getTime();
    if (Number.isFinite(value)) return value + DRAW_SECONDS * 1000;
  }
  return 0;
}

export function computeRemainSec(row, nowMs = Date.now()) {
  const deadline = computeDeadlineMs(row);
  if (!deadline) return DRAW_SECONDS;
  return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
}

export function makeWordChoices(customWords = [], count = 3) {
  return pickRandomWords(customWords, count).map((word) => ({ word }));
}

export function normalizeChoices(row) {
  const raw = (row && row.word_choices) || [];
  return raw.map((item) => (typeof item === 'string' ? item : item && item.word)).filter(Boolean);
}

export function mixCustomWord(choices, customWords, round) {
  const list = choices || [];
  if (list.length === 0) return list;
  const words = (customWords || [])
    .map((item) => (typeof item === 'string' ? item : item && item.word))
    .filter(Boolean);
  if (words.length === 0) return list;
  const picked = words[(Math.max(1, round || 1) - 1) % words.length];
  if (list.includes(picked)) return list;
  return [...list.slice(0, -1), picked];
}

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

export async function createGame(userId, partnerId, customWords = []) {
  // 客户端先生成 UUID：同一次请求即使超时重试，也只可能落下一条对局。
  const gameId = makeUuid();
  let response;
  try {
    response = await fetchWithTimeout(
      () =>
        supabase
          .from('drawguess_games')
          .insert([
            {
              id: gameId,
              creator_id: userId,
              invitee_id: partnerId,
              status: 'waiting',
              round: 1,
              current_drawer: 'creator',
              word_choices: makeWordChoices(customWords, 3),
              round_results: [],
            },
          ])
          .select(),
      MUTATE_OPTS
    );
  } catch (networkError) {
    const recovered = await fetchGameRow(gameId).catch(() => null);
    if (recovered) return recovered;
    throw networkError;
  }

  const { data, error } = response;
  if (error) {
    if (error.code === '23505') {
      const recovered = await fetchGameRow(gameId).catch(() => null);
      if (recovered) return recovered;
    }
    throw error;
  }
  if (!data || !data[0]) throw new Error('创建对局失败：未返回数据');
  return data[0];
}

async function findInviteMessage(gameId) {
  const { data, error } = await fetchWithTimeout(() =>
    supabase
      .from('messages')
      .select('*')
      .eq('type', 'drawguess_invite')
      .contains('metadata', { game_id: gameId })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  if (error) throw error;
  return data || null;
}

// 保留聊天卡片协议，让对方能从聊天页带 gameId 进入；按 gameId 防重复写卡片。
export async function publishInviteMessage(game, userId, partnerId) {
  if (!game || !game.id) throw new Error('邀请缺少对局编号');
  const existing = await findInviteMessage(game.id);
  if (existing) return existing;

  let response;
  try {
    response = await fetchWithTimeout(
      () =>
        supabase
          .from('messages')
          .insert([
            {
              user_id: userId,
              content: '你画我猜邀请',
              type: 'drawguess_invite',
              metadata: {
                game_id: game.id,
                creator_id: userId,
                creator_name: userId,
                partner_id: partnerId,
                partner_name: partnerId,
              },
            },
          ])
          .select(),
      INSERT_ONCE_OPTS
    );
  } catch (networkError) {
    const recovered = await findInviteMessage(game.id).catch(() => null);
    if (recovered) return recovered;
    throw networkError;
  }

  const { data, error } = response;
  if (error) {
    const recovered = await findInviteMessage(game.id).catch(() => null);
    if (recovered) return recovered;
    throw error;
  }
  return data && data[0] ? data[0] : null;
}

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

export async function cancelInvite(gameId) {
  const { error } = await fetchWithTimeout(
    () => supabase.from('drawguess_games').delete().eq('id', gameId).eq('status', 'waiting'),
    MUTATE_OPTS
  );
  if (error) throw error;
  try {
    await fetchWithTimeout(
      () =>
        supabase
          .from('messages')
          .delete()
          .eq('type', 'drawguess_invite')
          .contains('metadata', { game_id: gameId }),
      { timeout: 8000, retries: 1, retryDelay: 500 }
    );
  } catch (cleanupError) {
    console.warn('[DrawGuessRoom] 邀请卡片清理失败:', cleanupError.message);
  }
}

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

export async function sendHint(
  gameId,
  round,
  hint,
  currentDeadlineAt,
  extraSec = HINT_EXTRA_SECONDS
) {
  const parsed = currentDeadlineAt ? new Date(currentDeadlineAt).getTime() : 0;
  const base = Number.isFinite(parsed) && parsed > 0 ? Math.max(Date.now(), parsed) : Date.now();
  const { data, error } = await fetchWithTimeout(
    () =>
      supabase
        .from('drawguess_games')
        .update({
          hint,
          deadline_at: new Date(base + extraSec * 1000).toISOString(),
        })
        .eq('id', gameId)
        .eq('round', round)
        .eq('status', 'drawing')
        .is('hint', null)
        .select(),
    MUTATE_OPTS
  );
  if (error) throw error;
  const row = data && data[0] ? data[0] : null;
  return { row, changed: !!row };
}

export function buildRoundResult(row, winner) {
  const started = row.started_at ? new Date(row.started_at).getTime() : Date.now();
  const duration = Math.max(0, Math.floor((Date.now() - started) / 1000));
  return {
    round: row.round,
    drawer: row.current_drawer,
    word: row.word,
    winner,
    duration: winner === 'win' ? duration : null,
  };
}

export async function finishRound(row, winner, nextWords = []) {
  const result = buildRoundResult(row, winner);
  const previous = Array.isArray(row.round_results) ? row.round_results : [];
  const merged = [...previous.filter((item) => item && item.round !== result.round), result].sort(
    (a, b) => (a.round || 0) - (b.round || 0)
  );
  const nextRound = (row.round || 1) + 1;
  const patch =
    nextRound > TOTAL_ROUNDS
      ? {
          status: 'finished',
          winner,
          finished_at: new Date().toISOString(),
          deadline_at: null,
          round_results: merged,
        }
      : {
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

export async function markRematch(oldGameId, newGameId, byUserId) {
  const { error } = await fetchWithTimeout(
    () =>
      supabase
        .from('drawguess_games')
        .update({ rematch_request_by: byUserId, rematch_game_id: newGameId })
        .eq('id', oldGameId)
        .eq('status', 'finished'),
    MUTATE_OPTS
  );
  if (error) throw error;
}

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
  if (!row) return 'timeout';
  if (['win', 'gaveup', 'timeout'].includes(row.winner)) return row.winner;
  const results = Array.isArray(row.round_results) ? row.round_results : [];
  const found = results.find((item) => item && item.round === row.round);
  return found && found.winner ? found.winner : 'timeout';
}
