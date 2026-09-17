// ═══════════════════════════════════════════════════════
// timeIntent.js —— 自然语言时间意图解析（按设备本地时区计算日界）
// ═══════════════════════════════════════════════════════

/**
 * 获取本地时间当天的起止时间
 * @param {Date} date
 * @returns {{ start: Date, end: Date }}
 */
function getLocalDayBounds(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return { start, end };
}

/**
 * 解析用户消息中的时间范围
 * @param {string} message - 用户输入文本
 * @param {Date} [now=new Date()] - 当前基准时间
 * @returns {{ start: Date, end: Date, label: string } | null}
 */
export function parseTimeRange(message, now = new Date()) {
  if (!message || typeof message !== 'string') return null;
  const text = message.trim();
  const current = now instanceof Date ? now : new Date(now);

  // 1) 今天
  if (/(今天|今日|这一天)/.test(text)) {
    const { start } = getLocalDayBounds(current);
    return { start, end: current, label: '今天' };
  }

  // 2) 前天
  if (/(前天)/.test(text)) {
    const target = new Date(current.getTime() - 2 * 24 * 3600 * 1000);
    const { start, end } = getLocalDayBounds(target);
    return { start, end, label: '前天' };
  }

  // 3) 昨天
  if (/(昨天|昨儿|昨日|昨晚)/.test(text)) {
    const target = new Date(current.getTime() - 24 * 3600 * 1000);
    const { start, end } = getLocalDayBounds(target);
    return { start, end, label: '昨天' };
  }

  // 4) N天前 (例如: 3天前, 5天前)
  const daysAgoMatch = text.match(/(\d+|[一二两三四五六七八九十]+)天前/);
  if (daysAgoMatch) {
    const numMap = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const n = Number(daysAgoMatch[1]) || numMap[daysAgoMatch[1]] || 1;
    const target = new Date(current.getTime() - n * 24 * 3600 * 1000);
    const { start, end } = getLocalDayBounds(target);
    return { start, end, label: `${n}天前` };
  }

  // 5) N小时前
  const hoursAgoMatch = text.match(/(\d+|[一二两三四五六七八九十]+)个?小时前/);
  if (hoursAgoMatch) {
    const numMap = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const n = Number(hoursAgoMatch[1]) || numMap[hoursAgoMatch[1]] || 1;
    const start = new Date(current.getTime() - n * 3600 * 1000);
    return { start, end: current, label: `${n}小时前` };
  }

  // 6) 上周 (上一周周一 00:00 到 上周日 23:59:59)
  if (/(上周|上一周)/.test(text)) {
    const currentDay = current.getDay(); // 0 is Sunday, 1 is Monday
    const distanceToLastMonday = (currentDay === 0 ? 7 : currentDay) + 6;
    const lastMonday = new Date(current.getTime() - distanceToLastMonday * 24 * 3600 * 1000);
    const lastSunday = new Date(lastMonday.getTime() + 6 * 24 * 3600 * 1000);
    const { start } = getLocalDayBounds(lastMonday);
    const { end } = getLocalDayBounds(lastSunday);
    return { start, end, label: '上周' };
  }

  // 7) 这周 (本周一 00:00 到 当前)
  if (/(这周|本周|这一周)/.test(text)) {
    const currentDay = current.getDay();
    const distanceToMonday = (currentDay === 0 ? 7 : currentDay) - 1;
    const monday = new Date(current.getTime() - distanceToMonday * 24 * 3600 * 1000);
    const { start } = getLocalDayBounds(monday);
    return { start, end: current, label: '这周' };
  }

  // 8) 上个月
  if (/(上个月|上一月|上月)/.test(text)) {
    const year = current.getMonth() === 0 ? current.getFullYear() - 1 : current.getFullYear();
    const month = current.getMonth() === 0 ? 11 : current.getMonth() - 1;
    const start = new Date(year, month, 1, 0, 0, 0, 0);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    return { start, end, label: '上个月' };
  }

  // 9) 本月
  if (/(本月|这个月|这月)/.test(text)) {
    const start = new Date(current.getFullYear(), current.getMonth(), 1, 0, 0, 0, 0);
    return { start, end: current, label: '本月' };
  }

  // 10) 具体日期：例如 2026-09-14, 2026年9月14日, 9月14日, 9-14
  const isoDateMatch = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  if (isoDateMatch) {
    const y = Number(isoDateMatch[1]);
    const m = Number(isoDateMatch[2]) - 1;
    const d = Number(isoDateMatch[3]);
    const target = new Date(y, m, d);
    if (!Number.isNaN(target.getTime())) {
      const { start, end } = getLocalDayBounds(target);
      return { start, end, label: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
    }
  }

  const shortDateMatch = text.match(/(\d{1,2})月(\d{1,2})日?/);
  if (shortDateMatch) {
    const m = Number(shortDateMatch[1]) - 1;
    const d = Number(shortDateMatch[2]);
    const target = new Date(current.getFullYear(), m, d);
    if (!Number.isNaN(target.getTime())) {
      const { start, end } = getLocalDayBounds(target);
      return { start, end, label: `${m + 1}月${d}日` };
    }
  }

  return null;
}
