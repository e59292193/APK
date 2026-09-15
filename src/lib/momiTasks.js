// momi 自然语言提醒解析与任务 CRUD
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';

const COUPLE_ID = 'momo_and_baomi';

const REMINDER_PATTERNS = [
  /(?:momi[，,\s]*)?(?:请)?(?:在)?(.+?)(?:提醒我|提醒一下|叫我|记得提醒)(.+)/i,
  /(?:momi[，,\s]*)?(?:提醒我|提醒一下|叫我)(.+?)(?:去|要|，|,|$)(.*)/i,
];

function setTime(date, hour, minute = 0) {
  const out = new Date(date);
  out.setHours(hour, minute, 0, 0);
  return out;
}

/**
 * 轻量确定性解析，覆盖：10分钟后/2小时后/3天后/今天/明天/后天/9月20日 + 上午下午晚上 + HH:mm。
 * 解析不了就返回 null，不猜日期。
 */
export function parseReminderLocally(text, now = new Date()) {
  const raw = String(text || '').trim();
  let timing = '';
  let title = '';
  for (const pattern of REMINDER_PATTERNS) {
    const m = raw.match(pattern);
    if (m) {
      timing = (m[1] || '').trim();
      title = (m[2] || '').trim();
      break;
    }
  }
  if (!timing) return null;
  title = title.replace(/^[，,：:\s]*(我)?/, '').trim() || '你设置的提醒';

  let due = new Date(now);
  const relative = timing.match(/(\d+)\s*(分钟|小时|天)后/);
  if (relative) {
    const n = Number(relative[1]);
    const unitMs = relative[2] === '分钟' ? 60000 : relative[2] === '小时' ? 3600000 : 86400000;
    due = new Date(now.getTime() + n * unitMs);
    return { title, dueAt: due.toISOString(), sourceText: raw };
  }

  if (/后天/.test(timing)) due.setDate(due.getDate() + 2);
  else if (/明天/.test(timing)) due.setDate(due.getDate() + 1);
  else if (!/今天|今晚|今早/.test(timing)) {
    const dateMatch = timing.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/);
    if (dateMatch) {
      const year = dateMatch[1] ? Number(dateMatch[1]) : now.getFullYear();
      due = new Date(year, Number(dateMatch[2]) - 1, Number(dateMatch[3]), 9, 0, 0, 0);
      if (!dateMatch[1] && due < now) due.setFullYear(year + 1);
    } else {
      return null;
    }
  }

  const timeMatch = timing.match(/(上午|早上|中午|下午|晚上|今晚)?\s*(\d{1,2})(?:[:：点时](\d{1,2})?分?)?/);
  if (timeMatch) {
    let hour = Number(timeMatch[2]);
    const minute = Number(timeMatch[3] || 0);
    const period = timeMatch[1] || '';
    if (/下午|晚上|今晚/.test(period) && hour < 12) hour += 12;
    if (period === '中午' && hour < 11) hour += 12;
    due = setTime(due, hour, minute);
  } else {
    due = setTime(due, /今晚/.test(timing) ? 20 : 9, 0);
  }

  if (due <= now) return null;
  return { title, dueAt: due.toISOString(), sourceText: raw };
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
  const { data, error } = await fetchWithTimeout(() =>
    supabase.from('momi_tasks').insert([payload]).select(),
  { kind: 'write' });
  if (error) throw error;
  return data?.[0] || payload;
}

export async function createTaskFromMessage({ userId, message, sourceMessageId, now }) {
  const parsed = parseReminderLocally(message, now);
  if (!parsed) return null;
  return createMomiTask({ userId, title: parsed.title, dueAt: parsed.dueAt, sourceMessageId });
}

export async function listMomiTasks({ status = 'active', limit = 100 } = {}) {
  let q = supabase
    .from('momi_tasks')
    .select('*')
    .eq('couple_id', COUPLE_ID)
    .order('due_at', { ascending: true })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await fetchWithTimeout(() => q);
  if (error) throw error;
  return data || [];
}

export async function updateMomiTask(id, patch) {
  const allowed = {};
  for (const k of ['title', 'due_at', 'status', 'notified_at']) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  const { data, error } = await fetchWithTimeout(() =>
    supabase.from('momi_tasks').update(allowed).eq('id', id).select(),
  { kind: 'write' });
  if (error) throw error;
  return data?.[0] || null;
}

export async function cancelMomiTask(id) {
  return updateMomiTask(id, { status: 'cancelled' });
}

export async function completeMomiTask(id) {
  return updateMomiTask(id, { status: 'done', notified_at: new Date().toISOString() });
}
