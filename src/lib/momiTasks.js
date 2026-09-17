// momi 自然语言任务/提醒解析与任务 CRUD
// 能力：一次性提醒（本地正则极速解析）+ 周期任务/复杂表达（轻量 LLM 抽取）+ 聊天内取消任务
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { formatLocalTime } from './dateUtils';

const COUPLE_ID = 'momo_and_baomi';
const LOCAL_TASKS_KEY = '@momi_tasks_local';

export const TASK_RECURRENCES = ['none', 'daily', 'weekday', 'weekly'];
export const RECURRENCE_LABELS = {
  none: '一次性',
  daily: '每天',
  weekday: '每个工作日',
  weekly: '每周',
};

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

const REMINDER_PATTERNS = [
  /(?:momi[，,\s]*)?(?:请)?(?:帮我)?(?:在|定[个一]|设置[个一])?(.+?)(?:提醒我|提醒一下|叫我|记得提醒|设个提醒|定个闹钟|闹钟)(.+)/i,
  /(?:momi[，,\s]*)?(?:帮我)?(?:提醒我|提醒一下|叫我|定个提醒|设置提醒)(.+?)(?:去|要|，|,|$)(.*)/i,
  /(?:momi[，,\s]*)?(?:帮我)?(?:记一下|记录一下|定一个|设置一个|建一个)(?:定时任务|提醒|待办|备忘)[：:\s]*(.+)/i,
];

function setTime(date, hour, minute = 0) {
  const out = new Date(date);
  out.setHours(hour, minute, 0, 0);
  return out;
}

/**
 * 轻量确定性解析，覆盖：10分钟后/半小时后/2小时后/3天后/今天/明天/后天/9月20日 + 上午下午晚上 + HH:mm。
 * 解析不了就返回 null，不猜日期。
 */
export function parseReminderLocally(text, now = new Date()) {
  const raw = String(text || '').trim();
  let timing = '';
  let title = '';
  for (const pattern of REMINDER_PATTERNS) {
    const match = raw.match(pattern);
    if (match) {
      timing = (match[1] || '').trim();
      title = (match[2] || '').trim();
      break;
    }
  }
  if (!timing) return null;
  title = title.replace(/^[，,：:\s]*(我)?/, '').trim() || '你设置的提醒';

const CHINESE_DIGIT_MAP = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseChineseNumber(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '半') return 0.5;
  if (s.length === 1 && CHINESE_DIGIT_MAP[s] != null) return CHINESE_DIGIT_MAP[s];
  if (s === '十') return 10;
  if (s.startsWith('十') && s.length === 2 && CHINESE_DIGIT_MAP[s[1]] != null) {
    return 10 + CHINESE_DIGIT_MAP[s[1]];
  }
  if (s.endsWith('十') && s.length === 2 && CHINESE_DIGIT_MAP[s[0]] != null) {
    return CHINESE_DIGIT_MAP[s[0]] * 10;
  }
  if (s.length === 3 && s[1] === '十') {
    return (CHINESE_DIGIT_MAP[s[0]] || 0) * 10 + (CHINESE_DIGIT_MAP[s[2]] || 0);
  }
  return null;
}

  let due = new Date(now);

  // 1. 半小时后 / 一小时后
  if (/半小时后/.test(timing)) {
    due = new Date(now.getTime() + 30 * 60 * 1000);
    return { title, dueAt: due.toISOString(), sourceText: raw };
  }
  if (/一小时后/.test(timing)) {
    due = new Date(now.getTime() + 60 * 60 * 1000);
    return { title, dueAt: due.toISOString(), sourceText: raw };
  }

  // 2. N分钟后 / N小时后 / N天后（支持阿拉伯数字与中文数字，如“一分钟后”、“两小时后”）
  const relative = timing.match(/([0-9]+|[一二两三四五六七八九十]+|半)\s*(分钟|小时|天)后/);
  if (relative) {
    const amount = parseChineseNumber(relative[1]);
    if (amount != null && amount > 0) {
      const unitMs = relative[2] === '分钟' ? 60000 : relative[2] === '小时' ? 3600000 : 86400000;
      due = new Date(now.getTime() + amount * unitMs);
      return { title, dueAt: due.toISOString(), sourceText: raw };
    }
  }

  // 3. 后天 / 明天 / 今天
  if (/后天/.test(timing)) due.setDate(due.getDate() + 2);
  else if (/明天/.test(timing)) due.setDate(due.getDate() + 1);
  else if (!/今天|今晚|今早/.test(timing)) {
    const dateMatch = timing.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/);
    if (dateMatch) {
      const year = dateMatch[1] ? Number(dateMatch[1]) : now.getFullYear();
      const month = Number(dateMatch[2]);
      const day = Number(dateMatch[3]);
      due = new Date(year, month - 1, day, 9, 0, 0, 0);
      if (due.getFullYear() !== year || due.getMonth() !== month - 1 || due.getDate() !== day) return null;
      if (!dateMatch[1] && due < now) due.setFullYear(year + 1);
    } else {
      return null;
    }
  }

  // 4. 必须包含“点/时/冒号”等明确时间分隔符，避免把“1月2日”中的 1 误当小时。
  const timeMatch = timing.match(/(上午|早上|早晨|清晨|中午|下午|傍晚|晚上|今晚)?\s*(\d{1,2})(?:[:：点时](\d{1,2})?分?)/);
  if (timeMatch) {
    let hour = Number(timeMatch[2]);
    const minute = Number(timeMatch[3] || 0);
    const period = timeMatch[1] || '';
    if (hour > 23 || minute > 59) return null;
    if (/下午|傍晚|晚上|今晚/.test(period) && hour < 12) hour += 12;
    if (period === '中午' && hour < 11) hour += 12;
    if (hour > 23) return null;
    due = setTime(due, hour, minute);
  } else {
    due = setTime(due, /今晚|晚上/.test(timing) ? 20 : 9, 0);
  }

  if (due <= now) return null;
  return { title, dueAt: due.toISOString(), sourceText: raw };
}

/**
 * 宽关键词门禁：命中才考虑调用 LLM 抽取，避免每条闲聊消息都多一次 API 调用。
 */
const TASK_INTENT_GATE = /(提醒我|提醒一下|记得提醒|提醒我一下|叫我|定个|设置[一个]?|设个|闹钟|定时|待办|备忘|任务|每天|每日|每周|工作日|到点|分钟后|小时后|天后|取消.*(提醒|任务|闹钟)|别提醒我|不用提醒|别再提醒)/;

// 疑问/质问/抱怨语句（例如“你还是没有提醒我”、“为什么没提醒”、“怎么没提醒”），属于用户反馈，并非新建任务
const NOT_TASK_INTENT = /(你?还是?没有提醒|没提醒|未提醒|为什么不提醒|怎么没提醒|怎么还没提醒|并没有提醒|你都没提醒|忘记提醒我了|忘了提醒)/;

export function looksLikeTaskIntent(message) {
  const str = String(message || '');
  if (NOT_TASK_INTENT.test(str)) return false;
  return TASK_INTENT_GATE.test(str);
}

function extractJsonObject(text) {
  const raw = String(text || '');
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * 计算周期任务的下一次触发时间。
 * recurrence: 'daily' | 'weekday' | 'weekly'
 * weekly 的星期几直接取 dueAt 的星期（首次触发日即用户指定的星期），无需额外字段。
 */
export function computeNextOccurrence({ recurrence, dueAt }, from = new Date()) {
  if (!recurrence || recurrence === 'none' || !dueAt) return null;
  const base = new Date(dueAt);
  if (Number.isNaN(base.getTime())) return null;
  const candidate = new Date(from);
  candidate.setHours(base.getHours(), base.getMinutes(), 0, 0);
  for (let i = 0; i < 370; i += 1) {
    const d = new Date(candidate);
    d.setDate(candidate.getDate() + i);
    const day = d.getDay();
    const ok = recurrence === 'daily'
      || (recurrence === 'weekday' && day >= 1 && day <= 5)
      || (recurrence === 'weekly' && day === base.getDay());
    if (ok && d.getTime() > from.getTime()) return d;
  }
  return null;
}

/** 由 trigger_time(HH:mm) + recurrence + (weekly)triggerWeekday 计算首次触发时间 */
function firstOccurrence({ recurrence, triggerTime, triggerWeekday }, now) {
  const m = String(triggerTime || '').match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  const start = new Date(now);
  start.setHours(hour, minute, 0, 0);
  for (let i = 0; i < 370; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const day = d.getDay();
    const ok = recurrence === 'daily'
      || (recurrence === 'weekday' && day >= 1 && day <= 5)
      || (recurrence === 'weekly' && day === (triggerWeekday == null ? now.getDay() : triggerWeekday));
    if (ok && d.getTime() > now.getTime()) return d;
  }
  return null;
}

/**
 * 轻量 LLM 抽取：把自然语言（含每天/每周/工作日等周期任务、取消请求）解析成结构化任务。
 * 只在本地正则解析失败但命中任务关键词门禁时调用，避免无谓 API 消耗。
 * 解析失败/不是任务一律返回 null，不猜不编。
 */
export async function extractTaskWithLLM(message, now = new Date()) {
  try {
    // eslint-disable-next-line global-require
    const { sendChatCompletion } = require('./aiProvider');
    const nowText = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())} 周${WEEKDAY_CN[now.getDay()]}`;
    const res = await sendChatCompletion({
      messages: [
        {
          role: 'system',
          content: '你是任务解析器。把用户发给小助手 momi 的消息解析成任务指令。只输出一个 JSON 对象，绝对不要输出任何其它文字、解释或 markdown 代码块。',
        },
        {
          role: 'user',
          content: `当前时间：${nowText}\n用户消息：「${String(message || '').slice(0, 200)}」\n\n按以下规则输出 JSON：\n1) 用户在布置一次性或周期性提醒/任务（含每天、每日、每周、工作日等），输出：\n{"is_task":true,"action":"create","title":"简短任务内容","task_type":"once|daily|weekday|weekly","trigger_at":"仅once需要，ISO时间如2026-09-18T08:00:00+08:00","trigger_time":"周期任务必填，HH:mm","trigger_weekday":"仅weekly需要，0-6，0=周日","ai_prompt":"到点或执行时 momi 要做的事、要用自己语气说的话"}\n2) 用户在取消已有提醒/任务，输出：{"is_task":true,"action":"cancel","keyword":"任务内容关键词"}\n3) 其它任何情况（闲聊、询问有哪些任务、提到“提醒”但不是布置任务），输出：{"is_task":false}\n时间一律按用户本地时间理解；once 的 trigger_at 必须是未来时间；title 不超过 20 字。`,
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
    });
    if (!res.success || !res.text) return null;
    const parsed = extractJsonObject(res.text);
    if (!parsed || parsed.is_task !== true) return null;

    if (parsed.action === 'cancel') {
      const keyword = String(parsed.keyword || '').trim();
      return keyword ? { action: 'cancel', keyword } : null;
    }
    if (parsed.action !== 'create') return null;

    const title = String(parsed.title || '').trim().slice(0, 30);
    if (!title) return null;
    const aiPrompt = String(parsed.ai_prompt || '').trim().slice(0, 200);
    const taskType = String(parsed.task_type || 'once');

    if (taskType === 'once') {
      const due = new Date(parsed.trigger_at);
      if (Number.isNaN(due.getTime())) return null;
      if (due.getTime() <= now.getTime()) return null;
      return { action: 'create', title, recurrence: 'none', dueAt: due.toISOString(), aiPrompt };
    }
    if (taskType === 'daily' || taskType === 'weekday' || taskType === 'weekly') {
      const rawWd = parsed.trigger_weekday === 0 || parsed.trigger_weekday ? Number(parsed.trigger_weekday) : null;
      const triggerWeekday = Number.isInteger(rawWd) && rawWd >= 0 && rawWd <= 6 ? rawWd : null;
      const first = firstOccurrence({ recurrence: taskType, triggerTime: parsed.trigger_time, triggerWeekday }, now);
      if (!first) return null;
      return { action: 'create', title, recurrence: taskType, dueAt: first.toISOString(), aiPrompt };
    }
    return null;
  } catch (err) {
    console.warn('[momiTasks] LLM 任务抽取失败:', err.message);
    return null;
  }
}

async function saveLocalTaskFallback(task) {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_TASKS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(task);
    await AsyncStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {}
}

async function getLocalTasksFallback(status = 'active') {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_TASKS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    if (!status) return list;
    return list.filter((t) => t.status === status);
  } catch {
    return [];
  }
}

async function updateLocalTask(id, patch) {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_TASKS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const next = list.map((t) => (t.id === id ? { ...t, ...patch, updated_at: new Date().toISOString() } : t));
    await AsyncStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(next.slice(0, 100)));
  } catch {}
}

export async function createMomiTask({ userId, title, dueAt, sourceMessageId = null, recurrence = 'none', aiPrompt = '' }) {
  const payload = {
    couple_id: COUPLE_ID,
    created_by: userId,
    title: String(title || '').trim(),
    due_at: dueAt,
    status: 'active',
    source_message_id: sourceMessageId,
  };
  if (recurrence && recurrence !== 'none') payload.recurrence = recurrence;
  if (aiPrompt) payload.ai_prompt = aiPrompt;
  if (!payload.title || !payload.due_at) throw new Error('提醒标题和时间不能为空');

  let savedTask = null;
  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase.from('momi_tasks').insert([payload]).select(),
    { kind: 'write' });
    if (error) throw error;
    savedTask = data?.[0] || payload;
  } catch (err) {
    // 若是新列（recurrence/ai_prompt）尚未迁移导致写入失败，降级为不含新列重试一次
    const msg = String(err?.message || '');
    const missingColumn = /recurrence|ai_prompt|column|PGRST204/i.test(msg) || err?.code === '42703';
    if ((payload.recurrence || payload.ai_prompt) && missingColumn) {
      console.error('[momiTasks] momi_tasks 缺少 recurrence/ai_prompt 列，请执行 momi_v4_migration.sql；本次以一次性任务写入');
      try {
        const { data, error } = await fetchWithTimeout(() =>
          supabase.from('momi_tasks').insert([{
            couple_id: payload.couple_id,
            created_by: payload.created_by,
            title: payload.title,
            due_at: payload.due_at,
            status: payload.status,
            source_message_id: payload.source_message_id,
          }]).select(),
        { kind: 'write' });
        if (error) throw error;
        savedTask = { ...(data?.[0] || payload) };
      } catch (retryErr) {
        console.warn('[momiTasks] 云端写入重试失败，降级本地存储:', retryErr.message);
      }
    } else {
      console.warn('[momiTasks] 云端写入失败，降级本地存储:', err.message);
    }
  }

  if (!savedTask) {
    const localId = `local_task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    savedTask = { ...payload, id: localId, created_at: new Date().toISOString() };
    await saveLocalTaskFallback(savedTask);
  }

  // 本地原生定时通知调度（不阻塞）
  try {
    // eslint-disable-next-line global-require
    const { scheduleNativeTaskNotification } = require('./proactiveScheduler');
    if (scheduleNativeTaskNotification) {
      scheduleNativeTaskNotification(savedTask).catch(() => {});
    }
  } catch {}

  return savedTask;
}

export async function createTaskFromMessage({ userId, message, sourceMessageId, now }) {
  const parsed = parseReminderLocally(message, now);
  if (!parsed) return null;
  return createMomiTask({ userId, title: parsed.title, dueAt: parsed.dueAt, sourceMessageId });
}

/** 查找完全相同的进行中任务（同标题 + 同重复规则 + 同一分钟），避免重复创建 */
async function findDuplicateActiveTask({ title, dueAt, recurrence }) {
  try {
    const tasks = await listMomiTasks({ status: 'active', limit: 100 });
    const dueMinute = new Date(dueAt);
    dueMinute.setSeconds(0, 0);
    return tasks.find((t) => t.title === title
      && (t.recurrence || 'none') === (recurrence || 'none')
      && Math.abs(new Date(t.due_at).getTime() - dueMinute.getTime()) < 60000) || null;
  } catch {
    return null;
  }
}

/**
 * 聊天消息任务处理统一入口（创建 / 取消）。
 * 返回：
 *   { action: 'created', task, duplicated }
 *   { action: 'cancelled', count, titles }
 *   { action: 'cancel_failed', keyword }
 *   null（不是任务消息）
 */
export async function handleTaskMessage({ userId, message, sourceMessageId = null, now = new Date() }) {
  const text = String(message || '').trim();
  if (!text) return null;

  // 1) 本地极速解析（一次性提醒，不消耗 AI）
  const parsed = parseReminderLocally(text, now);
  if (parsed) {
    const dup = await findDuplicateActiveTask({ title: parsed.title, dueAt: parsed.dueAt, recurrence: 'none' });
    if (dup) return { action: 'created', task: dup, duplicated: true };
    const task = await createMomiTask({ userId, title: parsed.title, dueAt: parsed.dueAt, sourceMessageId });
    return { action: 'created', task, duplicated: false };
  }

  // 2) 复杂表达 / 周期任务 / 取消请求：轻量 LLM 抽取
  if (!looksLikeTaskIntent(text)) return null;
  const extracted = await extractTaskWithLLM(text, now);
  if (!extracted) return null;

  if (extracted.action === 'cancel') {
    const cancelled = await cancelMomiTasksByKeyword(extracted.keyword);
    if (cancelled.count > 0) return { action: 'cancelled', ...cancelled };
    return { action: 'cancel_failed', keyword: extracted.keyword };
  }

  const dup = await findDuplicateActiveTask({ title: extracted.title, dueAt: extracted.dueAt, recurrence: extracted.recurrence });
  if (dup) return { action: 'created', task: dup, duplicated: true };
  const task = await createMomiTask({
    userId,
    title: extracted.title,
    dueAt: extracted.dueAt,
    sourceMessageId,
    recurrence: extracted.recurrence,
    aiPrompt: extracted.aiPrompt,
  });
  return { action: 'created', task, duplicated: false };
}

/** 按关键词取消进行中的任务（标题互相包含即视为命中），返回 { count, titles } */
export async function cancelMomiTasksByKeyword(keyword, { limit = 5 } = {}) {
  const kw = String(keyword || '').trim();
  if (!kw) return { count: 0, titles: [] };
  const active = await listMomiTasks({ status: 'active', limit: 100 });
  const matched = active.filter((t) => {
    const title = String(t.title || '');
    return title && (title.includes(kw) || kw.includes(title));
  }).slice(0, limit);
  for (const t of matched) {
    if (String(t.id).startsWith('local_task_')) {
      // eslint-disable-next-line no-await-in-loop
      await updateLocalTask(t.id, { status: 'cancelled' });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await updateMomiTask(t.id, { status: 'cancelled' });
    }
    // 同步取消已预约的本地通知
    try {
      // eslint-disable-next-line global-require
      const { cancelNativeTaskNotification } = require('./proactiveScheduler');
      if (cancelNativeTaskNotification) {
        // eslint-disable-next-line no-await-in-loop
        await cancelNativeTaskNotification(t.id);
      }
    } catch {}
  }
  return { count: matched.length, titles: matched.map((t) => t.title) };
}

/** 已到期的本地降级任务（云端表缺失/写入失败时保存的提醒也要按时触发，不能静默丢失） */
export async function getDueLocalTasks(now = new Date()) {
  try {
    const list = await getLocalTasksFallback('active');
    return list
      .filter((t) => t && t.due_at && !t.notified_at && new Date(t.due_at).getTime() <= now.getTime())
      .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  } catch {
    return [];
  }
}

/** 本地任务触发后的落库：周期任务推进到下一次，一次性任务标记完成 */
export async function markLocalTaskFired(task, now = new Date()) {
  const recurrence = task?.recurrence && task.recurrence !== 'none' ? task.recurrence : null;
  if (recurrence) {
    const next = computeNextOccurrence({ recurrence, dueAt: task.due_at }, now);
    if (next) {
      await updateLocalTask(task.id, { due_at: next.toISOString(), notified_at: null });
      return { nextDueAt: next.toISOString() };
    }
  }
  await updateLocalTask(task.id, { status: 'done', notified_at: now.toISOString() });
  return { done: true };
}

/** 任务确认回执文案（聊天里直接展示，保证用户立刻发现时间解析错误） */
export function formatTaskReceipt(task) {
  if (!task || !task.due_at) return '';
  const due = new Date(task.due_at);
  if (Number.isNaN(due.getTime())) return '';
  const hhmm = `${pad2(due.getHours())}:${pad2(due.getMinutes())}`;
  const recurrence = task.recurrence && task.recurrence !== 'none' ? task.recurrence : null;
  if (recurrence === 'daily') return `⏰ 任务定好啦：每天 ${hhmm}「${task.title}」，到点我来执行～`;
  if (recurrence === 'weekday') return `⏰ 任务定好啦：每个工作日 ${hhmm}「${task.title}」，到点我来执行～`;
  if (recurrence === 'weekly') return `⏰ 任务定好啦：每周${WEEKDAY_CN[due.getDay()]} ${hhmm}「${task.title}」，到点我来执行～`;
  const now = new Date();
  const isToday = due.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = due.toDateString() === tomorrow.toDateString();
  const dayLabel = isToday ? '今天' : isTomorrow ? '明天' : `${due.getMonth() + 1}月${due.getDate()}日`;
  return `⏰ 提醒定好啦：${dayLabel} ${hhmm}「${task.title}」，到点我来叫你～`;
}

export async function listMomiTasks({ status = 'active', limit = 100 } = {}) {
  try {
    let query = supabase
      .from('momi_tasks')
      .select('*')
      .eq('couple_id', COUPLE_ID)
      .order('due_at', { ascending: true })
      .limit(limit);
    if (status) query = query.eq('status', status);
    const { data, error } = await fetchWithTimeout(() => query);
    if (error) throw error;
    return data || [];
  } catch {
    // 降级本地
    return getLocalTasksFallback(status);
  }
}

export function formatTasksSummary(tasks = []) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return '当前没有进行中的定时提醒任务。';
  }
  return tasks
    .map((t, idx) => {
      const recurrence = t.recurrence && t.recurrence !== 'none' ? `（${RECURRENCE_LABELS[t.recurrence] || t.recurrence}）` : '';
      return `${idx + 1}. 「${t.title}」${recurrence} - 提醒时间：${formatLocalTime(t.due_at)}（状态：${t.status === 'active' ? '进行中' : t.status}）`;
    })
    .join('\n');
}

export async function updateMomiTask(id, patch) {
  const allowed = {};
  for (const key of ['title', 'due_at', 'status', 'notified_at', 'recurrence', 'ai_prompt']) {
    if (patch[key] !== undefined) allowed[key] = patch[key];
  }
  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase.from('momi_tasks').update(allowed).eq('id', id).select(),
    { kind: 'write' });
    if (error) throw error;
    return data?.[0] || null;
  } catch (err) {
    console.warn('[momiTasks] 更新失败:', err.message);
    return null;
  }
}

export async function cancelMomiTask(id) {
  return updateMomiTask(id, { status: 'cancelled' });
}

export async function completeMomiTask(id) {
  return updateMomiTask(id, { status: 'done', notified_at: new Date().toISOString() });
}
