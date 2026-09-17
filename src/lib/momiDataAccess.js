// ═══════════════════════════════════════════════════════
// momi 统一数据访问层 (momiDataAccess.js)
//
// 【架构铁律】momi 的所有数据读取必须经过本模块，业务代码禁止直接
//   supabase.from('time_capsules') 等绕过行为。
//
// 【隐私铁律 —— 硬编码在底层，不可协商，调用方无法覆盖】
//   1. time_capsules 查询必须且只能带 .not('opened_at','is',null)；
//   2. 任何场景都不得查询未开封信件的 content 字段，即使只是“判断有没有信”
//      —— 未开封只能走 COUNT（select id + head:true）；
//   3. 小纸条 ephemeral_notes 已核实为阅后即焚（消费即 DELETE 整行），
//      与未拆开的信同等级严格：只统计待抽取数量，绝不读取 content/sender_id。
//
// 表名字段名均已核对 src/lib/*_schema.sql（checkin/kitchen/momi/gomoku/drawGuess/ephemeral，
// trips/trip_entries 见 checkin_schema.sql 第 6/7 节）。
//
// V4：新增 news 意图（实时新闻热榜联网查询）；
//     修正 capsules 规则误吞“新闻”（“新闻”含“信”字，旧规则会错路由到时光胶囊）。
// ═══════════════════════════════════════════════════════

import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';

export const MOMI_COUPLE_ID = 'momo_and_baomi';

const DIGEST_STALE_MS = 6 * 60 * 60 * 1000; // 摘要超过 6 小时需重算

function missingTableGuard(err, table) {
  // 42P01 = table does not exist：给出可操作的开发期提示，而不是用户看不懂的报错
  if (err && (err.code === '42P01' || /does not exist/i.test(err.message || ''))) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.error(`[momiDataAccess] 表 ${table} 不存在，请先到 Supabase 执行 momi_upgrade_schema.sql`);
    }
    return true;
  }
  return false;
}

async function safeQuery(label, fn, fallback) {
  try {
    const res = await fetchWithTimeout(fn);
    if (res && res.error) {
      if (!missingTableGuard(res.error, label)) {
        console.warn(`[momiDataAccess] 查询 ${label} 失败:`, res.error.message);
      }
      return fallback;
    }
    return res;
  } catch (err) {
    console.warn(`[momiDataAccess] 查询 ${label} 异常:`, err.message);
    return fallback;
  }
}

function toLocalDay(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayDiff(dayA, dayB) {
  const a = new Date(`${dayA}T00:00:00`);
  const b = new Date(`${dayB}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// ─────────────────────────────────────────────────────
// 打卡（checkin_themes / checkin_records）
// ─────────────────────────────────────────────────────

/**
 * 打卡聚合：总次数 / 打卡天数 / 当前连续 / 最长连续 / 本月次数 / 今天是否已打卡
 * 连续天数只需日期序列，因此只拉 user_id + created_at 两列（不拉内容）。
 */
export async function getCheckinSummary() {
  const totalRes = await safeQuery('checkin_records', () =>
    supabase.from('checkin_records').select('id', { count: 'exact', head: true }),
  { count: 0 });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthRes = await safeQuery('checkin_records', () =>
    supabase
      .from('checkin_records')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', monthStart.toISOString()),
  { count: 0 });

  const datesRes = await safeQuery('checkin_records', () =>
    supabase
      .from('checkin_records')
      .select('user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
  { data: [] });

  const rows = datesRes.data || [];
  const daySet = new Set(rows.map((r) => toLocalDay(r.created_at)));
  const todayDay = toLocalDay(new Date().toISOString());

  // 当前连续：从今天（或昨天，若今天还没打）向前逐日回溯
  let currentStreak = 0;
  let cursor = daySet.has(todayDay) ? new Date() : new Date(Date.now() - 86400000);
  while (daySet.has(toLocalDay(cursor.toISOString()))) {
    currentStreak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }

  // 最长连续
  const sortedDays = Array.from(daySet).sort();
  let longestStreak = 0;
  let run = 0;
  let prev = null;
  for (const day of sortedDays) {
    if (prev && dayDiff(prev, day) === 1) {
      run += 1;
    } else {
      run = 1;
    }
    longestStreak = Math.max(longestStreak, run);
    prev = day;
  }

  return {
    totalCount: totalRes.count || 0,
    monthCount: monthRes.count || 0,
    activeDays: daySet.size,
    currentStreak,
    longestStreak,
    todayChecked: daySet.has(todayDay),
  };
}

/**
 * 最近 N 条打卡内容（用户主动问“最近都打了什么卡”时用）
 */
export async function getRecentCheckins(limit = 10) {
  const res = await safeQuery('checkin_records', () =>
    supabase
      .from('checkin_records')
      .select('user_id, content, created_at')
      .order('created_at', { ascending: false })
      .limit(limit),
  { data: [] });
  return res.data || [];
}

// ─────────────────────────────────────────────────────
// 菜品（kitchen_dishes / kitchen_weekly_picks）
// ─────────────────────────────────────────────────────

export async function getKitchenSummary() {
  const dishesRes = await safeQuery('kitchen_dishes', () =>
    supabase
      .from('kitchen_dishes')
      .select('id, title, category, created_by')
      .eq('couple_id', MOMI_COUPLE_ID)
      .order('created_at', { ascending: false })
      .limit(200),
  { data: [] });
  const dishes = dishesRes.data || [];

  const categoryCounts = {};
  for (const d of dishes) {
    const cat = d.category || 'meat';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  // 本周想吃（本周一 00:00 起）
  const monday = new Date();
  const day = monday.getDay();
  monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1));
  const weekStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

  const picksRes = await safeQuery('kitchen_weekly_picks', () =>
    supabase
      .from('kitchen_weekly_picks')
      .select('picked_by, dish:kitchen_dishes(title, category)')
      .eq('couple_id', MOMI_COUPLE_ID)
      .eq('week_start', weekStart),
  { data: [] });
  const picks = picksRes.data || [];

  return {
    totalDishes: dishes.length,
    categoryCounts,
    dishTitles: dishes.map((d) => d.title),
    weeklyPickCount: picks.length,
    weeklyPickTitles: picks.map((p) => (p.dish && p.dish.title) || '未知菜品'),
  };
}

/**
 * 精确查某道菜的配方（用户问“XX 怎么做”时用，模糊匹配标题）
 */
export async function getDishRecipeByTitle(title) {
  if (!title) return null;
  const res = await safeQuery('kitchen_dishes', () =>
    supabase
      .from('kitchen_dishes')
      .select('title, category, recipe_text')
      .eq('couple_id', MOMI_COUPLE_ID)
      .ilike('title', `%${title}%`)
      .limit(3),
  { data: [] });
  return res.data || [];
}

// ─────────────────────────────────────────────────────
// 纪念日（anniversaries）
// ─────────────────────────────────────────────────────

export async function getAnniversarySummary() {
  const res = await safeQuery('anniversaries', () =>
    supabase
      .from('anniversaries')
      .select('title, type, date, remark, is_pinned')
      .order('date', { ascending: true }),
  { data: [] });
  const list = res.data || [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const enriched = list.map((a) => {
    const target = new Date(`${a.date}T00:00:00`);
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
    return {
      title: a.title,
      type: a.type,
      date: a.date,
      remark: a.remark || '',
      // countdown：还有 N 天；cumulative：已经走过 N 天
      days: Math.abs(diffDays),
      isFuture: diffDays >= 0,
    };
  });

  const upcoming = enriched
    .filter((a) => a.isFuture)
    .sort((a, b) => a.days - b.days)[0] || null;

  return { total: list.length, items: enriched, upcoming };
}

// ─────────────────────────────────────────────────────
// 愿望清单（wishes）
// ─────────────────────────────────────────────────────

export async function getWishlistSummary() {
  const res = await safeQuery('wishes', () =>
    supabase
      .from('wishes')
      .select('title, status, creator_id, completed_at'),
  { data: [] });
  const list = res.data || [];
  const completed = list.filter((w) => w.status === 'completed');
  const pending = list.filter((w) => w.status !== 'completed');
  return {
    total: list.length,
    completedCount: completed.length,
    pendingTitles: pending.map((w) => w.title),
    completionRate: list.length ? Math.round((completed.length / list.length) * 100) : 0,
  };
}

// ─────────────────────────────────────────────────────
// 恋爱足迹（trips / trip_entries）
// 旅程列表 + 手账条目统计，回答“我们去过哪里玩”类问题
// ─────────────────────────────────────────────────────

export async function getTripsSummary() {
  const tripsRes = await safeQuery('trips', () =>
    supabase
      .from('trips')
      .select('id, title, location, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  { data: [] });
  const trips = tripsRes.data || [];

  const entriesCountRes = await safeQuery('trip_entries', () =>
    supabase.from('trip_entries').select('id', { count: 'exact', head: true }),
  { count: 0 });

  const recentEntriesRes = await safeQuery('trip_entries', () =>
    supabase
      .from('trip_entries')
      .select('trip_id, user_id, content, photo_url, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
  { data: [] });

  return {
    totalTrips: trips.length,
    trips: trips.map((t) => ({
      title: t.title,
      location: t.location || '',
      at: t.created_at,
    })),
    totalEntries: entriesCountRes.count || 0,
    recentEntries: (recentEntriesRes.data || []).map((e) => ({
      by: e.user_id,
      preview: (e.content || '').slice(0, 40),
      hasPhoto: Boolean(e.photo_url),
      at: e.created_at,
    })),
  };
}

// ─────────────────────────────────────────────────────
// 时光胶囊（time_capsules）—— 隐私铁律实施点
// ─────────────────────────────────────────────────────

/**
 * 已开封信件摘要（content 只允许在这个函数里出现，且强制 opened_at 过滤）
 */
export async function getOpenedCapsulesSummary(limit = 10) {
  const res = await safeQuery('time_capsules', () =>
    supabase
      .from('time_capsules')
      .select('content, weather, mood, creator_id, opened_at')
      .not('opened_at', 'is', null) // 【铁律】只能读已开封
      .order('opened_at', { ascending: false })
      .limit(limit),
  { data: [] });
  const list = res.data || [];
  return {
    openedCount: list.length,
    items: list.map((c) => ({
      creator: c.creator_id,
      preview: (c.content || '').slice(0, 60),
      weather: c.weather || '',
      mood: c.mood || '',
      openedAt: c.opened_at,
    })),
  };
}

/**
 * 未开封信件【只数数量，绝不读 content】
 */
export async function getUnopenedCapsuleCount() {
  const res = await safeQuery('time_capsules', () =>
    supabase
      .from('time_capsules')
      .select('id', { count: 'exact', head: true }) // 不取 content
      .is('opened_at', null),
  { count: 0 });
  return res.count || 0;
}

// ─────────────────────────────────────────────────────
// 小纸条（ephemeral_notes）—— 阅后即焚，与未拆信同级严格
// 只允许统计待抽取数量；绝不读取 content / sender_id。
// ─────────────────────────────────────────────────────

export async function getEphemeralSummary() {
  const res = await safeQuery('ephemeral_notes', () =>
    supabase
      .from('ephemeral_notes')
      .select('receiver_id') // 只取接收方用于计数，不取内容
      .eq('status', 'pending'),
  { data: [] });
  const rows = res.data || [];
  const pendingFor = { momo: 0, '苞米': 0 };
  for (const r of rows) {
    if (r && pendingFor[r.receiver_id] !== undefined) pendingFor[r.receiver_id] += 1;
  }
  return { pendingFor, totalPending: rows.length };
}

// ─────────────────────────────────────────────────────
// 相册（photos bucket）—— 只要数量与时间分布，不取真实 URL
// （signed URL 只有 7 天有效期，存进记忆库必失效）
// ─────────────────────────────────────────────────────

export async function getPhotosSummary() {
  try {
    const res = await fetchWithTimeout(() =>
      supabase.storage.from('photos').list('', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })
    );
    if (res && res.error) {
      console.warn('[momiDataAccess] 相册统计失败:', res.error.message);
      return { totalCount: 0, byMonth: {} };
    }
    const files = (res && res.data) || [];
    const byMonth = {};
    let totalCount = 0;
    for (const f of files) {
      if (!f || !f.created_at) continue;
      if (f.id === null && !f.metadata) continue; // 跳过文件夹占位
      totalCount += 1;
      const month = f.created_at.slice(0, 7); // YYYY-MM
      byMonth[month] = (byMonth[month] || 0) + 1;
    }
    return { totalCount, byMonth };
  } catch (err) {
    console.warn('[momiDataAccess] 相册统计异常:', err.message);
    return { totalCount: 0, byMonth: {} };
  }
}

// ─────────────────────────────────────────────────────
// 游戏（gomoku_games + gomoku_manual_wins + drawguess_stats/gallery）
// 字段已核对 gomoku_schema.sql / drawGuess_schema.sql
// ─────────────────────────────────────────────────────

export async function getGamesSummary() {
  // 五子棋：winner='creator'/'invitee'/'draw'，需要映射回真实用户
  const gomokuRes = await safeQuery('gomoku_games', () =>
    supabase
      .from('gomoku_games')
      .select('creator_id, invitee_id, winner, status, created_at, finished_at')
      .eq('status', 'finished')
      .order('created_at', { ascending: false })
      .limit(200),
  { data: [] });
  const gomokuGames = gomokuRes.data || [];

  const gomoku = { total: gomokuGames.length, momoWins: 0, baomiWins: 0, draws: 0, lastPlayedAt: null };
  for (const g of gomokuGames) {
    if (!gomoku.lastPlayedAt && g.created_at) gomoku.lastPlayedAt = g.created_at;
    if (g.winner === 'draw') {
      gomoku.draws += 1;
    } else if (g.winner === 'creator') {
      if (g.creator_id === 'momo') gomoku.momoWins += 1; else gomoku.baomiWins += 1;
    } else if (g.winner === 'invitee') {
      if (g.invitee_id === 'momo') gomoku.momoWins += 1; else gomoku.baomiWins += 1;
    }
  }

  // 手动迁移的历史战绩（计分板 = 自动统计 + 手动值）
  const manualRes = await safeQuery('gomoku_manual_wins', () =>
    supabase.from('gomoku_manual_wins').select('user_id, wins, draws'),
  { data: [] });
  for (const m of manualRes.data || []) {
    if (m.user_id === 'momo') gomoku.momoWins += m.wins || 0;
    else if (m.user_id === '苞米') gomoku.baomiWins += m.wins || 0;
    gomoku.draws += m.draws || 0;
  }

  // 你画我猜：stats 快照表直接读
  const dgStatsRes = await safeQuery('drawguess_stats', () =>
    supabase.from('drawguess_stats').select('user_id, total_games, won_games, fastest_sec, fastest_word'),
  { data: [] });
  const drawguessStats = {};
  for (const s of dgStatsRes.data || []) {
    drawguessStats[s.user_id] = {
      total: s.total_games || 0,
      wins: s.won_games || 0,
      fastestSec: s.fastest_sec,
      fastestWord: s.fastest_word || '',
    };
  }

  const dgRecentRes = await safeQuery('drawguess_gallery', () =>
    supabase
      .from('drawguess_gallery')
      .select('word, result, drawer_id, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
  { data: [] });

  return {
    gomoku,
    drawguess: {
      stats: drawguessStats,
      recent: (dgRecentRes.data || []).map((g) => ({
        word: g.word,
        result: g.result,
        drawer: g.drawer_id,
        at: g.created_at,
      })),
    },
  };
}

// ─────────────────────────────────────────────────────
// momi 自身数据 & 全局摘要
// ─────────────────────────────────────────────────────

export async function getRecentAssistantMessages(limit = 16) {
  const res = await safeQuery('momi_assistant_messages', () =>
    supabase
      .from('momi_assistant_messages')
      .select('sender, content, content_type, image_urls, created_at')
      .eq('couple_id', MOMI_COUPLE_ID)
      .order('created_at', { ascending: false })
      .limit(limit),
  { data: [] });
  return (res.data || []).reverse();
}

/**
 * 读取全局摘要（momi_data_digest）。过期或缺失时现场重算并回写。
 * 更新时机：APP 冷启动异步调用一次 + 超过 6 小时自动重算。
 */
export async function getDataDigest({ forceRefresh = false } = {}) {
  // 1. 尝试读已有摘要
  const cached = await safeQuery('momi_data_digest', () =>
    supabase
      .from('momi_data_digest')
      .select('digest_key, value, computed_at')
      .eq('couple_id', MOMI_COUPLE_ID),
  { data: null });

  if (cached.data && cached.data.length > 0 && !forceRefresh) {
    const freshest = cached.data.reduce((acc, row) => {
      const t = new Date(row.computed_at).getTime();
      return Math.max(acc, Number.isNaN(t) ? 0 : t);
    }, 0);
    if (Date.now() - freshest < DIGEST_STALE_MS) {
      const out = {};
      for (const row of cached.data) out[row.digest_key] = row.value;
      return out;
    }
  }

  // 2. 重算（并行）
  const [checkin, kitchen, anniversary, wishlist, photos, capsules, ephemeral, games, trips] = await Promise.all([
    getCheckinSummary(),
    getKitchenSummary(),
    getAnniversarySummary(),
    getWishlistSummary(),
    getPhotosSummary(),
    (async () => ({
      opened: await getOpenedCapsulesSummary(3),
      unopenedCount: await getUnopenedCapsuleCount(),
    }))(),
    getEphemeralSummary(),
    getGamesSummary(),
    getTripsSummary(),
  ]);

  const digest = {
    checkin,
    kitchen: {
      totalDishes: kitchen.totalDishes,
      categoryCounts: kitchen.categoryCounts,
      weeklyPickCount: kitchen.weeklyPickCount,
      weeklyPickTitles: kitchen.weeklyPickTitles,
    },
    anniversary: { total: anniversary.total, upcoming: anniversary.upcoming },
    wishlist,
    photos,
    capsules: {
      openedCount: capsules.opened.openedCount,
      unopenedCount: capsules.unopenedCount,
    },
    ephemeral: { totalPending: ephemeral.totalPending, pendingFor: ephemeral.pendingFor },
    games: {
      gomokuTotal: games.gomoku.total,
      gomokuMomoWins: games.gomoku.momoWins,
      gomokuBaomiWins: games.gomoku.baomiWins,
      gomokuDraws: games.gomoku.draws,
      drawguessStats: games.drawguess.stats,
    },
    trips: {
      totalTrips: trips.totalTrips,
      tripTitles: trips.trips.map((t) => t.title).slice(0, 20),
      totalEntries: trips.totalEntries,
    },
  };

  // 3. 回写（upsert 每行；失败不阻塞使用）
  const now = new Date().toISOString();
  const rows = Object.entries(digest).map(([key, value]) => ({
    couple_id: MOMI_COUPLE_ID,
    digest_key: key,
    value,
    computed_at: now,
  }));
  safeQuery('momi_data_digest', () =>
    supabase
      .from('momi_data_digest')
      .upsert(rows, { onConflict: 'couple_id,digest_key' }),
  null
  ).catch(() => {});

  return digest;
}

/**
 * 意图路由关键词规则：命中则先查库再把结果注入本轮上下文（不必每次调 LLM）。
 * 注意规则顺序：news 必须放在 capsules 与 chat_history 之前 ——
 * “昨天发生的时事新闻” 既含“信”（旧 capsules 规则）又命中“昨天…发”（chat_history 规则），
 * 不前置会被错误路由成查信件/查聊天记录。
 */
export const INTENT_RULES = [
  { intent: 'checkin_recent', pattern: /最近.*(打卡|记录)/, run: () => getRecentCheckins(10) },
  { intent: 'checkin', pattern: /打卡|连续|签到|坚持/, run: () => getCheckinSummary() },
  { intent: 'kitchen', pattern: /菜|吃|菜单|厨房|饿|喝|奶茶|饮料/, run: () => getKitchenSummary() },
  { intent: 'anniversary', pattern: /纪念日|多少天|在一起多久|周年/, run: () => getAnniversarySummary() },
  { intent: 'wishlist', pattern: /愿望|想做|想去|清单/, run: () => getWishlistSummary() },
  { intent: 'games', pattern: /输|赢|战绩|下棋|五子棋|你画我猜|画画/, run: () => getGamesSummary() },
  { intent: 'photos', pattern: /照片|相册|拍了多少/, run: () => getPhotosSummary() },
  { intent: 'trips', pattern: /足迹|旅行|旅游|去过|出行|手账|游记/, run: () => getTripsSummary() },
  { intent: 'ephemeral', pattern: /小纸条|纸条|语音信箱/, run: () => getEphemeralSummary() },
  {
    intent: 'news',
    pattern: /新闻|时事|热搜|头条|热点|大事|发生了什么|最近发生|天下事|资讯/,
    run: async () => {
      const { getLatestNews } = require('./webSearchService');
      return getLatestNews({ maxItems: 12 });
    },
  },
  {
    intent: 'capsules',
    // 注意：不能再单独匹配“信”字 —— “新闻/相信/信心”等词都含“信”，会误路由
    pattern: /胶囊|时光|信件|书信|情书|写信|拆信|未拆|已拆/,
    run: async () => ({
      opened: await getOpenedCapsulesSummary(5),
      unopenedCount: await getUnopenedCapsuleCount(),
    }),
  },
  {
    intent: 'weather',
    pattern: /天气|下雨|下雪|降温|升温|气温|几度|冷|热|带伞|穿什么|紫外线|风大|台风|雾霾/,
    run: async (context = {}) => {
      const { getWeatherForMomi } = require('./weatherService');
      return getWeatherForMomi({ userId: context?.userId });
    },
  },
  {
    intent: 'chat_history',
    pattern: /(记不记得|记得吗|我们聊过|我说过|你说过|聊过|说过|那天的事|之前的记录)|((昨天|前天|今天|上周|上个月|之前|那天).*(聊|说|发|提|问|记录|事|讨论))/,
    run: async (context = {}) => {
      const { parseTimeRange } = require('./timeIntent');
      const timeRange = parseTimeRange(context.message || '');
      const since = timeRange ? timeRange.start : new Date(Date.now() - 48 * 3600 * 1000);
      const until = timeRange ? timeRange.end : new Date();
      const label = timeRange ? timeRange.label : '最近48小时';

      const [coupleHistory, digest] = await Promise.all([
        getCoupleChatHistory({ since, until, limit: 60 }),
        getChatHistoryDigest({ since, until }),
      ]);

      return {
        timeRange: { since: since.toISOString(), until: until.toISOString(), label },
        digest,
        messages: coupleHistory.slice(-40),
      };
    },
  },
  {
    intent: 'tasks',
    pattern: /(提醒|闹钟|定时任务|待办|备忘).*(有哪些|列表|查看|查一下|记录|什么|几点|什么时候|还有吗)|(查看|查一下|列出|看下).*(提醒|闹钟|定时|任务|待办)/,
    run: async () => {
      const { listMomiTasks, formatTasksSummary } = require('./momiTasks');
      const tasks = await listMomiTasks({ status: 'active', limit: 20 });
      return {
        count: tasks.length,
        tasks,
        summary: formatTasksSummary(tasks),
      };
    },
  },
  {
    intent: 'web_search',
    pattern: /(搜索|搜一下|查一下外网|外网|上网搜|上网查|最新消息|今日新闻|实时行情|什么是|科普一下|了解一下|谁是|百科).+/,
    run: async (context = {}) => {
      const { searchWeb } = require('./webSearchService');
      const text = context?.message || '';
      return searchWeb(text);
    },
  },
];

/**
 * 查主聊天 messages 表（统一走 safeQuery 与表缺失保护）
 */
export async function getCoupleChatHistory({ since, until, limit = 120, keyword } = {}) {
  const result = await safeQuery('messages', async () => {
    let query = supabase
      .from('messages')
      .select('id, user_id, content, type, created_at')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (since && typeof query.gte === 'function') {
      const sinceIso = since instanceof Date ? since.toISOString() : since;
      query = query.gte('created_at', sinceIso);
    }
    if (until && typeof query.lte === 'function') {
      const untilIso = until instanceof Date ? until.toISOString() : until;
      query = query.lte('created_at', untilIso);
    }
    if (keyword && typeof query.ilike === 'function') {
      query = query.ilike('content', `%${keyword}%`);
    }

    return query;
  }, { data: [], error: null });

  const raw = result?.data || [];
  return raw.map((m) => {
    const isImg = m.type === 'image';
    let content = (m.content || '').trim();
    if (!content && isImg) {
      content = '[图片]';
    }
    return {
      id: m.id,
      sender: m.user_id,
      content,
      content_type: m.type || 'text',
      created_at: m.created_at,
    };
  });
}

/**
 * 统计指定时间范围内主聊天摘要信息
 */
export async function getChatHistoryDigest({ since, until } = {}) {
  const history = await getCoupleChatHistory({ since, until, limit: 300 });
  const messageCount = history.length;
  if (!messageCount) {
    return {
      messageCount: 0,
      activeDays: 0,
      senders: {},
      firstAt: null,
      lastAt: null,
      topKeywords: [],
    };
  }

  const daysSet = new Set();
  const senders = {};
  const wordFreq = {};
  const stopWords = new Set(['的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '图片']);

  for (const msg of history) {
    if (msg.created_at) {
      daysSet.add(msg.created_at.slice(0, 10));
    }
    const sender = msg.sender || 'unknown';
    senders[sender] = (senders[sender] || 0) + 1;

    const words = (msg.content || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ').split(/\s+/);
    for (const w of words) {
      if (w.length >= 2 && !stopWords.has(w) && !w.startsWith('[')) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
    }
  }

  const topKeywords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word]) => word);

  return {
    messageCount,
    activeDays: daysSet.size,
    senders,
    firstAt: history[0]?.created_at || null,
    lastAt: history[history.length - 1]?.created_at || null,
    topKeywords,
  };
}

/**
 * 命中意图则先查库。返回 { intent, data } 或 null。
 */
export async function queryByIntent(message, context = {}) {
  if (!message) return null;
  const mergedContext = { ...context, message };
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(message)) {
      const data = await rule.run(mergedContext);
      return { intent: rule.intent, data };
    }
  }
  return null;
}

/**
 * 精确查配方（“番茄牛腩怎么做”类问题）
 */
export async function queryRecipeIfAsked(message) {
  if (!message) return null;
  const m = message.match(/(.+?)(怎么做|如何做|配方|菜谱|做法)/);
  if (!m) return null;
  const keyword = m[1].replace(/^(我想吃|想吃|问一下|请问|momi)/i, '').trim();
  if (!keyword || keyword.length > 12) return null;
  return getDishRecipeByTitle(keyword);
}
