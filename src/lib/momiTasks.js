// momi 自然语言提醒解析与任务 CRUD
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { formatLocalTime } from './dateUtils';

const COUPLE_ID = 'momo_and_baomi';
const LOCAL_TASKS_KEY = '@momi_tasks_local';

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

  // 2. N分钟后 / N小时后 / N天后
  const relative = timing.match(/(\d+)\s*(分钟|小时|天)后/);
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = relative[2] === '分钟' ? 60000 : relative[2] === '小时' ? 3600000 : 86400000;
    due = new Date(now.getTime() + amount * unitMs);
    return { title, dueAt: due.toISOString(), sourceText: raw };
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

export async function createMomiTask({ userId, title, dueAt, sourceMessageId = null }) {
  const payload = {
    couple_id: COUPLE_ID,
    created_by: userId,
    title: String(title || '').trim(),
    due_at: dueAt,
    status: 'active',
    source_message_id: sourceMessageId,
  };
  if (!payload.title || !payload.due_at) throw new Error('提醒标题和时间不能为空');

  let savedTask = null;
  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase.from('momi_tasks').insert([payload]).select(),
    { kind: 'write' });
    if (error) throw error;
    savedTask = data?.[0] || payload;
  } catch (err) {
    console.warn('[momiTasks] 云端写入失败，降级本地存储:', err.message);
    const localId = `local_task_${Date.now()}`;
    savedTask = { ...payload, id: localId, created_at: new Date().toISOString() };
    await saveLocalTaskFallback(savedTask);
  }

  // 尝试触发本地原生定时通知调度
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
    .map((t, idx) => `${idx + 1}. 「${t.title}」 - 提醒时间：${formatLocalTime(t.due_at)}（状态：${t.status === 'active' ? '进行中' : t.status}）`)
    .join('\n');
}

export async function updateMomiTask(id, patch) {
  const allowed = {};
  for (const key of ['title', 'due_at', 'status', 'notified_at']) {
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
