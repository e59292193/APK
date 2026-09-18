// ═════════════════════════════════════════════════════════
// momi 中文时间解析器 (momiTimeParser.js) — V6
// 纯函数、无副作用、不依赖 AI、可单测。
// 目标：把「等下两点钟」「明天早上八点半」「10分钟后」「每天晚上九点」
// 「每个工作日早上7点」「9月20日下午三点」这类真实中文表达，
// 稳定解析成绕对时间 + 重复规则；解析不出来就明确报错，绕不猜时间。
//
// V6.1 行为修正（对齐仓库现有 Jest 断言）：
//   - 「N 天后 / N 周后」没说钟点时保持精确相对偏移，不套默认 9 点
//   - 明确说了「今天/今晚/当天」但时间已过 → past_time（不擅自顺延到明天）
// ═════════════════════════════════════════════════════════

export const NUM_CHARS = '0-9零〇○一壹二贰两俩三付四五六七八九十';
export const MIN_LEAD_MS = 30 * 1000;
export const RECURRENCE_LABEL = {
  none: '一次性',
  daily: '每天',
  weekday: '每个工作日',
  weekly: '每周',
};

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAY_MAP = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const DIGIT = {
  零: 0, 〇: 0, '○': 0, 一: 1, 壹: 1, 二: 2, 贰: 2, 两: 2, 俩: 2,
  三: 3, 付: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const PERIOD_RE = /(凌晨|清晨|早晨|大早|早上|上午|中午|下午|午后|傍晚|晚上|今晚|明晚|夜里|半夜|夜间)/;
const PERIOD_DEFAULT_HOUR = {
  凌晨: 6, 清晨: 7, 早晨: 7, 大早: 7, 早上: 8, 上午: 9, 中午: 12,
  下午: 15, 午后: 15, 傍晚: 18, 晚上: 20, 今晚: 20, 明晚: 20,
  夜里: 21, 半夜: 0, 夜间: 21,
};
const UNIT_MS = {
  分钟: 60000, 分: 60000, 小时: 3600000, 钟头: 3600000,
  天: 86400000, 周: 604800000, 星期: 604800000,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function normalizeText(input) {
  return String(input || '')
    .replace(/[\uff10-\uff19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：︰]/g, ':')
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase();
}

/** 中文/阿拉伯数字 → number；无法识别返回 null（「半」= 0.5） */
export function cnToNumber(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '半') return 0.5;
  if (s === '十') return 10;
  if (/^十[一二三四五六七八九]$/.test(s)) return 10 + DIGIT[s[1]];
  if (/^[二三四五六七八九]十$/.test(s)) return DIGIT[s[0]] * 10;
  if (/^[二三四五六七八九]十[一二三四五六七八九]$/.test(s)) return DIGIT[s[0]] * 10 + DIGIT[s[2]];
  if (s.length === 1 && DIGIT[s] != null) return DIGIT[s];
  return null;
}

function startOfDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function withTime(base, hour, minute) {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function applyPeriod(hour, period) {
  if (!period) return hour;
  if (/凌晨|半夜|夜里|夜间/.test(period)) return hour === 12 ? 0 : hour;
  if (/早上|早晨|大早|清晨|上午/.test(period)) return hour;
  if (period === '中午') {
    if (hour >= 11 && hour <= 12) return hour;
    return hour <= 2 ? hour + 12 : hour;
  }
  if (/下午|午后|傍晚|晚上|今晚|明晚/.test(period)) return hour < 12 ? hour + 12 : hour;
  return hour;
}

/**
 * 解析钟点。
 * 返回 { hour, minute, period, explicit } 或 null。
 * explicit=false 表示只识别到「早上 / 晚上」这类时段，没有具体小时。
 */
export function parseClockTime(input) {
  const text = normalizeText(input);
  if (!text) return null;
  const period = (text.match(PERIOD_RE) || [])[1] || null;

  let hour = null;
  let minute = 0;

  const colon = text.match(/(\d{1,2}):(\d{1,2})/);
  if (colon) {
    hour = Number(colon[1]);
    minute = Number(colon[2]);
  } else {
    const cn = text.match(new RegExp(
      `([${NUM_CHARS}]{1,3})[点時时](?:钟)?(?:([${NUM_CHARS}]{1,3})分?|(半)|(一刻)|(三刻))?`,
    ));
    if (cn) {
      hour = cnToNumber(cn[1]);
      if (cn[2] != null) minute = cnToNumber(cn[2]);
      else if (cn[3]) minute = 30;
      else if (cn[4]) minute = 15;
      else if (cn[5]) minute = 45;
    }
  }

  if (hour == null) {
    return period ? { hour: null, minute: 0, period, explicit: false } : null;
  }
  if (minute == null) minute = 0;
  hour = applyPeriod(hour, period);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute, period, explicit: true };
}

/** 识别重复规则：{ recurrence: 'none'|'daily'|'weekday'|'weekly', weekday } */
export function detectRecurrence(input) {
  const text = normalizeText(input);
  if (!text) return { recurrence: 'none', weekday: null };
  if (/(每个?工作日|每周一到周五|周一到周五)/.test(text)) {
    return { recurrence: 'weekday', weekday: null };
  }
  const weekly = text.match(/每(?:个)?(?:周|星期|礼拜)([一二三四五六天日])/);
  if (weekly) return { recurrence: 'weekly', weekday: WEEKDAY_MAP[weekly[1]] };
  if (/每个?周末/.test(text)) return { recurrence: 'weekly', weekday: 6 };
  if (/(每天|每日|天天|每晚|每早|每个早上|每个晚上)/.test(text)) {
    return { recurrence: 'daily', weekday: null };
  }
  if (/每(?:个)?(?:周|星期|礼拜)/.test(text)) return { recurrence: 'weekly', weekday: null };
  return { recurrence: 'none', weekday: null };
}

/**
 * 解析日期线索。返回：
 *   { kind: 'relative', ms }                       —— 10分钟后 / 半小时后
 *   { kind: 'date', date, ms?, fromWeekday? }      —— 今天 / 明天 / 周三 / 9月20日 / 3天后
 *   { kind: 'soon', ms }                           —— 等下 / 一会儿（无钟点时才用）
 *   null                                           —— 没有任何日期线索
 */
export function parseDateOffset(input, now = new Date()) {
  const text = normalizeText(input);
  if (!text) return null;

  // 1) 相对时长：10分钟后 / 半小时后 / 两个小时后 / 3天后 / 一周后
  const rel = text.match(new RegExp(
    `([${NUM_CHARS}]{1,3}|半)个?(分钟|小时|钟头|星期|周|天|分)(?:之)?(?:后|以后)`,
  ));
  if (rel) {
    const amount = cnToNumber(rel[1]);
    const unitMs = UNIT_MS[rel[2]];
    if (amount != null && amount > 0 && unitMs) {
      const ms = Math.round(amount * unitMs);
      if (rel[2] === '天' || rel[2] === '周' || rel[2] === '星期') {
        // 带钟点时用这个日期作为基准（「3天后早上8点」）；
        // 不带钟点时用 ms 保持精确偏移（「3天后」= 正好 72 小时后）。
        return {
          kind: 'date',
          date: startOfDay(new Date(now.getTime() + ms)),
          ms,
          fromRelativeDay: true,
        };
      }
      return { kind: 'relative', ms };
    }
  }

  // 2) 明确年月日：2026年9月20日 / 9月20日 / 十月一号
  const md = text.match(new RegExp(
    `(?:(\\d{4})年)?([${NUM_CHARS}]{1,3})月([${NUM_CHARS}]{1,3})[日号]`,
  ));
  if (md) {
    const month = cnToNumber(md[2]);
    const day = cnToNumber(md[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = md[1] ? Number(md[1]) : now.getFullYear();
      const date = new Date(year, month - 1, day, 0, 0, 0, 0);
      if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
      if (!md[1] && date.getTime() < startOfDay(now).getTime()) {
        date.setFullYear(year + 1);
      }
      return { kind: 'date', date };
    }
  }

  // 3) 今天 / 明天 / 后天 / 大后天
  if (/大后天/.test(text)) {
    return { kind: 'date', date: startOfDay(new Date(now.getTime() + 3 * 86400000)) };
  }
  if (/后天/.test(text)) {
    return { kind: 'date', date: startOfDay(new Date(now.getTime() + 2 * 86400000)) };
  }
  if (/(明天|明早|明晚|明日|明儿)/.test(text)) {
    return { kind: 'date', date: startOfDay(new Date(now.getTime() + 86400000)) };
  }
  if (/(今天|今晚|今早|今夜|今儿|当天)/.test(text)) {
    return { kind: 'date', date: startOfDay(now), isToday: true };
  }

  // 4) 周三 / 下周五 / 礼拜天
  const wd = text.match(/(这|本|下|下个)?(?:周|星期|礼拜)([一二三四五六天日])/);
  if (wd) {
    const target = WEEKDAY_MAP[wd[2]];
    const nextWeek = /下/.test(wd[1] || '');
    let diff = (target - now.getDay() + 7) % 7;
    if (nextWeek) diff += 7;
    return {
      kind: 'date',
      date: startOfDay(new Date(now.getTime() + diff * 86400000)),
      fromWeekday: true,
    };
  }

  // 5) 单独的「20号」
  const dayOnly = text.match(new RegExp(`([${NUM_CHARS}]{1,3})[日号]`));
  if (dayOnly) {
    const day = cnToNumber(dayOnly[1]);
    if (day >= 1 && day <= 31) {
      const date = new Date(now.getFullYear(), now.getMonth(), day, 0, 0, 0, 0);
      if (date.getDate() === day) {
        if (date.getTime() < startOfDay(now).getTime()) date.setMonth(date.getMonth() + 1);
        return { kind: 'date', date };
      }
    }
  }

  // 6) 口语「等下 / 一会儿」：默认 10 分钟后
  if (/(一会儿|一会|待会|等下|等会|稍后|过会)/.test(text)) {
    return { kind: 'soon', ms: 10 * 60000 };
  }

  return null;
}

function firstRecurringOccurrence({ recurrence, hour, minute, weekday }, now) {
  const target = weekday == null ? now.getDay() : weekday;
  for (let i = 0; i < 400; i += 1) {
    const d = withTime(new Date(now.getTime() + i * 86400000), hour, minute);
    const day = d.getDay();
    const ok = recurrence === 'daily'
      || (recurrence === 'weekday' && day >= 1 && day <= 5)
      || (recurrence === 'weekly' && day === target);
    if (ok && d.getTime() > now.getTime() + MIN_LEAD_MS) return d;
  }
  return null;
}

function pastTime(due) {
  return { ok: false, error: 'past_time', dueAt: due.toISOString() };
}

function finalize(due, now, extra = {}) {
  if (!(due instanceof Date) || Number.isNaN(due.getTime())) {
    return { ok: false, error: 'no_time' };
  }
  if (due.getTime() <= now.getTime() + MIN_LEAD_MS) {
    return pastTime(due);
  }
  return { ok: true, dueAt: due.toISOString(), recurrence: 'none', weekday: null, ...extra };
}

/**
 * 统一入口：文本 → { ok, dueAt, recurrence, weekday } 或 { ok:false, error }
 * error: 'no_time'（没说时间）| 'past_time'（明确指定了已过去的时间）
 */
export function resolveDueAt(input, now = new Date()) {
  const text = normalizeText(input);
  if (!text) return { ok: false, error: 'no_time' };

  const { recurrence, weekday } = detectRecurrence(text);
  const clock = parseClockTime(text);
  const dateHint = parseDateOffset(text, now);

  // A) 周期任务
  if (recurrence !== 'none') {
    const hour = clock && clock.explicit
      ? clock.hour
      : (clock && clock.period ? PERIOD_DEFAULT_HOUR[clock.period] : null);
    if (hour == null) return { ok: false, error: 'no_time', recurrence };
    const minute = clock && clock.explicit ? clock.minute : 0;
    const first = firstRecurringOccurrence({ recurrence, hour, minute, weekday }, now);
    if (!first) return { ok: false, error: 'no_time', recurrence };
    return {
      ok: true,
      dueAt: first.toISOString(),
      recurrence,
      weekday: recurrence === 'weekly' ? (weekday == null ? first.getDay() : weekday) : null,
    };
  }

  // B) 相对时长：10 分钟后 / 半小时后
  if (dateHint && dateHint.kind === 'relative') {
    return finalize(new Date(now.getTime() + dateHint.ms), now);
  }

  // C) 明确钟点（可带日期）
  if (clock && clock.explicit) {
    const hasDate = !!dateHint && dateHint.kind === 'date';
    const base = hasDate ? dateHint.date : startOfDay(now);
    let due = withTime(base, clock.hour, clock.minute);
    if (due.getTime() <= now.getTime() + MIN_LEAD_MS) {
      if (hasDate && dateHint.isToday) {
        // 明确说了「今天/今晚」却已经过点：不能擅自顺延到明天，交由上层反问
        return pastTime(due);
      }
      if (!hasDate && !clock.period && clock.hour <= 11) {
        // 「两点钟」在 13:51 说出口，指的是 14:00，而不是明天凌晨 2 点
        const pm = withTime(base, clock.hour + 12, clock.minute);
        due = pm.getTime() > now.getTime() + MIN_LEAD_MS
          ? pm
          : new Date(due.getTime() + 86400000);
      } else if (!hasDate) {
        due = new Date(due.getTime() + 86400000);
      } else if (dateHint.fromWeekday) {
        due = new Date(due.getTime() + 7 * 86400000);
      }
    }
    return finalize(due, now);
  }

  // D) 只有时段或只有日期
  if ((clock && clock.period) || (dateHint && dateHint.kind === 'date')) {
    const hasDate = !!dateHint && dateHint.kind === 'date';
    const hasPeriod = !!(clock && clock.period);
    // 「3天后」「一周后」没说钟点：保持精确相对偏移，不套默认 9 点
    if (hasDate && dateHint.fromRelativeDay && !hasPeriod && dateHint.ms) {
      return finalize(new Date(now.getTime() + dateHint.ms), now);
    }
    const base = hasDate ? dateHint.date : startOfDay(now);
    const hour = hasPeriod ? PERIOD_DEFAULT_HOUR[clock.period] : 9;
    let due = withTime(base, hour, 0);
    if (due.getTime() <= now.getTime() + MIN_LEAD_MS) {
      if (hasDate && dateHint.isToday) return pastTime(due);
      if (!hasDate) due = new Date(due.getTime() + 86400000);
      else if (dateHint.fromWeekday) due = new Date(due.getTime() + 7 * 86400000);
    }
    return finalize(due, now);
  }

  // E) 口语「等下」
  if (dateHint && dateHint.kind === 'soon') {
    return finalize(new Date(now.getTime() + dateHint.ms), now);
  }

  return { ok: false, error: 'no_time' };
}

/** 周期任务下一次触发时间 */
export function computeNextOccurrence({ recurrence, dueAt, weekday }, from = new Date()) {
  if (!recurrence || recurrence === 'none' || !dueAt) return null;
  const base = new Date(dueAt);
  if (Number.isNaN(base.getTime())) return null;
  const target = weekday == null ? base.getDay() : weekday;
  for (let i = 0; i < 400; i += 1) {
    const d = withTime(new Date(from.getTime() + i * 86400000), base.getHours(), base.getMinutes());
    const day = d.getDay();
    const ok = recurrence === 'daily'
      || (recurrence === 'weekday' && day >= 1 && day <= 5)
      || (recurrence === 'weekly' && day === target);
    if (ok && d.getTime() > from.getTime()) return d;
  }
  return null;
}

/** 人类可读时间：今天 14:00 / 明天 08:30 / 周三 20:00 / 9月20日 15:00 */
export function formatDueAt(value, now = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const dayDiff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86400000);
  if (dayDiff === 0) return `今天 ${hhmm}`;
  if (dayDiff === 1) return `明天 ${hhmm}`;
  if (dayDiff === 2) return `后天 ${hhmm}`;
  if (dayDiff > 2 && dayDiff < 7) return `周${WEEKDAY_CN[d.getDay()]} ${hhmm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
}

/** 重复任务的人类可读描述：每天 21:00 / 每个工作日 07:00 / 每周三 20:00 */
export function formatRecurrence(recurrence, value, weekday) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (recurrence === 'daily') return `每天 ${hhmm}`;
  if (recurrence === 'weekday') return `每个工作日 ${hhmm}`;
  if (recurrence === 'weekly') {
    const day = weekday == null ? d.getDay() : weekday;
    return `每周${WEEKDAY_CN[day]} ${hhmm}`;
  }
  return formatDueAt(d);
}
