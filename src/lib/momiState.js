// ═══════════════════════════════════════════════════════
// momi 情绪与人格状态机 (momiState.js)
//
// 为什么情绪必须写在代码层 + 数据库，而不是只靠 prompt：
//   只靠 prompt 说“你会生气”，模型下一轮就忘了，情绪不连续，体验上就是假的。
//   本模块用 momi_state 表的数值承载情绪，每轮对话真实影响 prompt 注入。
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';

export const MOMI_STATE_COUPLE_ID = 'momo_and_baomi';

export const MOMI_MOODS = ['happy', 'calm', 'excited', 'sleepy', 'sad', 'annoyed', 'angry', 'worried'];

export const MOOD_EMOJI = {
  happy: '😊',
  calm: '😌',
  excited: '🤩',
  sleepy: '😴',
  sad: '🥺',
  annoyed: '😤',
  angry: '💢',
  worried: '😟',
};

// 养成升级阈值（累计经验）：100 / 250 / 500 / 900 / 1500 ...
export const GROWTH_THRESHOLDS = [100, 250, 500, 900, 1500, 2400, 3800, 6000, 9000];

export const DEFAULT_MOMI_STATE = {
  couple_id: MOMI_STATE_COUPLE_ID,
  mood: 'calm',
  mood_intensity: 50,
  energy: 80,
  affection_momo: 50,
  affection_baomi: 50,
  anger_level: 0,
  growth_level: 1,
  growth_exp: 0,
  last_interaction_at: null,
  last_proactive_at: null,
  proactive_count_today: 0,
  proactive_date: null,
};

// ── 粗鲁检测词表（双保险之一；另一路是 AI rudeness 评分，两者取高）──
// 注意：情侣间的打情骂俏（“傻子”“猪猪”“笨蛋”）在白名单中，不计为粗鲁。
const RUDE_WORDS = ['滚', '废物', '闭嘴', '烦死', '傻逼', '白痴', '垃圾', '有病', '去死', '蠢货', '没用的东西'];
const TEASING_WHITELIST = ['傻子', '猪猪', '笨蛋', '傻瓜', '小笨', '呆子'];
const APOLOGY_WORDS = ['对不起', '抱歉', '我错了', '原谅我', 'sorry', '别生气了', '赔罪'];
const PRAISE_WORDS = ['谢谢', '感谢', '爱你', '喜欢你', '你真棒', '好可爱', '乖', '早安', '晚安', '想你了'];

export function scoreRudenessLocally(text) {
  if (!text) return 0;
  // 命中真粗鲁词直接 7 分（白名单不能豁免真辱骂）
  for (const w of RUDE_WORDS) {
    if (text.includes(w)) return 7;
  }
  // 仅含打情骂俏词 => 1 分（不算粗鲁，AI 评分仍可结合上下文微调）
  for (const w of TEASING_WHITELIST) {
    if (text.includes(w)) return 1;
  }
  return 0;
}

export function detectApology(text) {
  if (!text) return false;
  return APOLOGY_WORDS.some((w) => text.includes(w));
}

export function detectPraise(text) {
  if (!text) return false;
  return PRAISE_WORDS.some((w) => text.includes(w));
}

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(v)));
}

/**
 * 读取 momi_state（不存在则插入默认行）
 */
export async function getMomiState() {
  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase
        .from('momi_state')
        .select('*')
        .eq('couple_id', MOMI_STATE_COUPLE_ID)
        .maybeSingle()
    );
    if (error) {
      if (error.code === '42P01' && typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.error('[momiState] momi_state 表不存在，请先执行 momi_upgrade_schema.sql');
      }
      return { ...DEFAULT_MOMI_STATE };
    }
    if (data) return data;

    // 首次使用：插入默认行
    const insertRes = await fetchWithTimeout(() =>
      supabase.from('momi_state').insert([{ ...DEFAULT_MOMI_STATE }]).select()
    );
    if (insertRes && insertRes.data && insertRes.data[0]) return insertRes.data[0];
    return { ...DEFAULT_MOMI_STATE };
  } catch (err) {
    console.warn('[momiState] 读取失败，使用默认状态:', err.message);
    return { ...DEFAULT_MOMI_STATE };
  }
}

async function persistState(patch) {
  try {
    await fetchWithTimeout(() =>
      supabase
        .from('momi_state')
        .upsert([{ couple_id: MOMI_STATE_COUPLE_ID, ...patch, updated_at: new Date().toISOString() }], {
          onConflict: 'couple_id',
        })
    );
  } catch (err) {
    console.warn('[momiState] 持久化失败:', err.message);
  }
}

/**
 * 时间衰减：每小时怒气 -5，情绪强度向 calm 回归。
 * 在每次交互开始时先套用，保证“过一晚气就消得差不多了”。
 */
function applyTimeDecay(state) {
  const now = Date.now();
  const last = state.updated_at ? new Date(state.updated_at).getTime() : now;
  const hours = Math.max(0, (now - last) / 3600000);
  if (hours < 1) return state;
  const decay = Math.floor(hours) * 5;
  const next = { ...state };
  next.anger_level = clamp((next.anger_level || 0) - decay);
  if (next.anger_level <= 0 && (next.mood === 'angry' || next.mood === 'annoyed')) {
    next.mood = 'calm';
  }
  return next;
}

/**
 * 每轮互动后更新情绪/好感度/经验。
 * @param {object} params
 * @param {string} params.userId - 'momo' | '苞米'
 * @param {number} params.rudeness - 0-10（本地词表与 AI 评分取高后的值）
 * @param {string} params.text - 用户原文（用于道歉/夸奖检测）
 * @returns {Promise<{ state: object, emotionDelta: object, leveledUp: boolean, newLevel: number }>}
 */
export async function applyInteraction({ userId, rudeness = 0, text = '' }) {
  let state = applyTimeDecay(await getMomiState());
  const delta = { moodFrom: state.mood, moodTo: state.mood, angerDelta: 0, affectionDelta: 0, expGain: 0 };

  const affectionKey = userId === '苞米' ? 'affection_baomi' : 'affection_momo';
  const isApology = detectApology(text);
  const isPraise = detectPraise(text);

  if (rudeness >= 6) {
    // 负向：粗鲁/辱骂 => 真的生气
    const angerGain = clamp(rudeness * 4, 20, 40);
    state.anger_level = clamp((state.anger_level || 0) + angerGain);
    state.mood = state.anger_level >= 60 ? 'angry' : 'annoyed';
    state.mood_intensity = clamp((state.mood_intensity || 50) + 25);
    const affLoss = clamp(Math.round(rudeness / 2), 3, 8);
    state[affectionKey] = clamp((state[affectionKey] || 50) - affLoss);
    delta.angerDelta = angerGain;
    delta.affectionDelta = -affLoss;
  } else if (isApology) {
    // 道歉恢复：逐步回落（一次 -30），不要立即归零，保留“还在闹小脾气”的真实感
    state.anger_level = clamp((state.anger_level || 0) - 30);
    if (state.anger_level <= 20) {
      state.mood = 'calm';
    } else if (state.mood === 'angry') {
      state.mood = 'annoyed';
    }
    delta.angerDelta = -30;
    delta.affectionDelta = 1;
    state[affectionKey] = clamp((state[affectionKey] || 50) + 1);
  } else if (isPraise || rudeness <= 2) {
    // 正向：礼貌/夸奖/问候
    state.mood = (state.energy ?? 80) > 30 ? 'happy' : 'calm';
    state.mood_intensity = clamp((state.mood_intensity || 50) + 10);
    const affGain = isPraise ? 3 : 1;
    state[affectionKey] = clamp((state[affectionKey] || 50) + affGain);
    state.anger_level = clamp((state.anger_level || 0) - 5);
    delta.affectionDelta = affGain;
    delta.angerDelta = -5;
  }

  // 经验值：每轮互动 +1，正向额外 +2
  const expGain = 1 + (delta.affectionDelta > 0 ? 2 : 0);
  state.growth_exp = (state.growth_exp || 0) + expGain;
  delta.expGain = expGain;

  // 升级判定
  let leveledUp = false;
  let newLevel = state.growth_level || 1;
  while (
    newLevel - 1 < GROWTH_THRESHOLDS.length &&
    state.growth_exp >= GROWTH_THRESHOLDS[newLevel - 1]
  ) {
    newLevel += 1;
    leveledUp = true;
  }
  state.growth_level = newLevel;

  state.last_interaction_at = new Date().toISOString();
  state.mood_intensity = clamp(state.mood_intensity);
  delta.moodTo = state.mood;

  await persistState(state);
  return { state, emotionDelta: delta, leveledUp, newLevel };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toHHMM(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 主动消息闸门：免扰窗口（默认 22:30 - 次日 09:00 不打扰）+ 每日上限 3 条。
 * settings.now 仅供测试注入。
 */
export function canSendProactive(state, settings = {}) {
  const quietStart = settings.quietStart ?? '22:30';
  const quietEnd = settings.quietEnd ?? '09:00';
  const dailyCap = settings.dailyCap ?? 3;
  const now = settings.now instanceof Date ? settings.now : new Date();

  const hhmm = toHHMM(now);
  // 跨午夜窗口：hhmm >= quietStart 或 hhmm < quietEnd 即免扰
  const inQuiet = quietStart > quietEnd
    ? hhmm >= quietStart || hhmm < quietEnd
    : hhmm >= quietStart && hhmm < quietEnd;
  if (inQuiet) return { allowed: false, reason: 'quiet_hours' };

  const today = toDateStr(now);
  const countToday = state.proactive_date === today ? (state.proactive_count_today || 0) : 0;
  if (countToday >= dailyCap) return { allowed: false, reason: 'daily_cap' };

  return { allowed: true, countToday, today };
}

/**
 * 记录一次主动消息（计数 + 跳天重置）
 */
export async function markProactiveSent(state, today) {
  const now = new Date();
  const todayStr = today || toDateStr(now);
  const countToday = state.proactive_date === todayStr ? (state.proactive_count_today || 0) + 1 : 1;
  const patch = {
    proactive_count_today: countToday,
    proactive_date: todayStr,
    last_proactive_at: now.toISOString(),
  };
  await persistState(patch);
  return { ...state, ...patch };
}

/**
 * 把当前情绪状态翻译成 system prompt 注入块（情绪必须真实影响语气）
 */
export function buildEmotionPromptBlock(state) {
  const mood = state.mood || 'calm';
  const lines = [
    `【momi 当前状态】情绪：${mood}（强度 ${state.mood_intensity}/100），精力：${state.energy}/100，怒气值：${state.anger_level}/100`,
    `对 momo 好感度 ${state.affection_momo}/100，对 苞米 好感度 ${state.affection_baomi}/100，成长等级 Lv.${state.growth_level}`,
  ];
  if (mood === 'angry') {
    lines.push('你现在真的很生气：可以撒气、可以回复很短、可以要求对方道歉。绝对禁止被骂了还开心地回“好的呢”——那不像你。');
  } else if (mood === 'annoyed') {
    lines.push('你还在闹小脾气：语气带点别扭和傲娇，不要立刻完全消气，除非对方真诚道歉。');
  } else if (mood === 'sleepy' || (state.energy ?? 80) < 25) {
    lines.push('你有点困了：回复更短更软，可以打哈欠。');
  } else if (mood === 'happy' || mood === 'excited') {
    lines.push('你现在心情很好：语气活泼，可以多用 emoji 和语气词。');
  } else if (mood === 'sad' || mood === 'worried') {
    lines.push('你有点低落/担心：语气柔软，希望得到他们的关心。');
  }
  return lines.join('\n');
}

// 供无 Supabase 环境下降级使用的本地缓存
const LOCAL_STATE_KEY = '@momi_state_local';
export async function getMomiStateOfflineSafe() {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { ...DEFAULT_MOMI_STATE };
}
