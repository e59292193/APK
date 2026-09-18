// momi 自然语言任务/提醒解析与任务 CRUD — V6
// 职责拆分：
//   时间解析  → momiTimeParser.js（确定性、可单测）
//   意图判定  → momiTaskIntent.js（双通道 + 反例拦截）
//   本文件    → 任务持久化（云端 → 云端简化 → 本地三级降级）与聊天入口编排
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { formatLocalTime } from './dateUtils';
import {
  resolveDueAt,
  computeNextOccurrence as computeNextOccurrenceCore,
  formatDueAt,
  formatRecurrence,
} from './momiTimeParser';
import {
  looksLikeTaskIntent as analyzeIntentCore,
  extractTaskTitle,
  extractCancelKeyword,
} from './momiTaskIntent';

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

// ──────────────────── 意图 & 解析（确定性、不耗 AI）──────────────────

/** 完整意图结果：{ isTask, kind, channel, needsTime, reason, matched } */
export function analyzeTaskIntent(message) {
  return analyzeIntentCore(message);
}

/** 向后兼容的布尔门禁（调用方仍可 `if (looksLikeTaskIntent(text))`） */
export function looksLikeTaskIntent(message) {
  return analyzeIntentCore(message).isTask === true;
}

/**
 * 本地极速解析：命中则返回 { title, dueAt, recurrence, sourceText }，否则 null。
 * 支持：中文数字、早上/下午/晚上等时段、点半/一刻、N分钟后、明天/后天/周X、
 *       X月X日、每天/每工作日/每周X，以及「两点钟」在下午说出口时自动归为 14:00。
 */
export function parseReminderLocally(text, now = new Date()) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const intent = analyzeIntentCore(raw);
  if (!intent.isTask || intent.kind !== 'create') return null;
  const resolved = resolveDueAt(raw, now);
  if (!resolved.ok) return null;
  return {
    title: extractTaskTitle(raw),
    dueAt: resolved.dueAt,
    recurrence: resolved.recurrence || 'none',
    sourceText: raw,
  };
}

/** 周期任务下一次触发时间（weekly 默认沜用 dueAt 的星期） */
export function computeNextOccurrence({ recurrence, dueAt, weekday }, from = new Date()) {
  return computeNextOccurrenceCore({ recurrence, dueAt, weekday }, from);
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
 * 兵底：确定性解析拿不出时间时，用轻量 LLM 再试一次（比如非常口语化的表达）。
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
          content: '你是任务解析器。把用户发给小助手 momi 的消息解析成任务指令。只输出一个 JSON 对象，给对不要输出任何其它文字。'.replace('给对', '绝对'),
        },
        {
          role: 'user',
          content: `当前时间：${nowText}\n用户消息：「${String(message || '').slice(0, 200)}」\n\n按以下规则输出 JSON：\n1) 用户在布置一次性或周期性提醒/任务，输出：\n{"is_task":true,"action":"create","title":"简短任务内容","task_type":"once|daily|weekday|weekly","trigger_at":"仅once需要，ISO时间","trigger_time":"周期任务必填，HH:mm","trigger_weekday":"仅weekly需要，0-6，0=周日","ai_prompt":"到点时 momi 要做的事"}\n2) 用户在取消已有提醒，输出：{"is_task":true,"action":"cancel","keyword":"任务关键词"}\n3) 其它任何情况，输出：{"is_task":false}\n时间一律按用户本地时间理解；once 的 trigger_at 必须是未来时间；title 不超过 20 字。`,
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

// ──────────────────────── 本地降级存储 ────────────────────────

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

// ───────────────────────── 任务 CRUD ─────────────────────────

export async function createMomiTask({
  userId, title, dueAt, sourceMessageId = null, recurrence = 'none', aiPrompt = '',
}) {
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
    // 若新列（recurrence/ai_prompt）尚未迁移导致写入失败，降级为不含新列重试一次
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
    savedTask = {
      ...payload,
      id: localId,
      recurrence: recurrence || 'none',
      ai_prompt: aiPrompt || '',
      created_at: new Date().toISOString(),
    };
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
  return createMomiTask({
    userId,
    title: parsed.title,
    dueAt: parsed.dueAt,
    sourceMessageId,
    recurrence: parsed.recurrence,
  });
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
 * 聊天消息任务处理统一入口。返回：
 *   { action: 'created', task, duplicated }
 *   { action: 'need_time', title }          ← 听出是任务但没说几点，momi 应主动反问
 *   { action: 'past_time' }                 ← 用户指定的时间已经过了
 *   { action: 'cancelled', count, titles }
 *   { action: 'cancel_failed', keyword }
 *   { action: 'list', tasks, summary }
 *   null（不是任务消息）
 */
export async function handleTaskMessage({ userId, message, sourceMessageId = null, now = new Date() }) {
  const text = String(message || '').trim();
  if (!text) return null;

  const intent = analyzeIntentCore(text);
  if (!intent.isTask) return null;

  // 1) 查询已有任务
  if (intent.kind === 'list') {
    const tasks = await listMomiTasks({ status: 'active', limit: 20 });
    return { action: 'list', tasks, summary: formatTasksSummary(tasks) };
  }

  // 2) 取消任务（先本地关键词，失败再走 LLM）
  if (intent.kind === 'cancel') {
    const keyword = extractCancelKeyword(text);
    if (keyword) {
      const cancelled = await cancelMomiTasksByKeyword(keyword);
      if (cancelled.count > 0) return { action: 'cancelled', ...cancelled };
    }
    const extracted = await extractTaskWithLLM(text, now);
    if (extracted?.action === 'cancel') {
      const cancelled = await cancelMomiTasksByKeyword(extracted.keyword);
      if (cancelled.count > 0) return { action: 'cancelled', ...cancelled };
      return { action: 'cancel_failed', keyword: extracted.keyword };
    }
    return { action: 'cancel_failed', keyword: keyword || text.slice(0, 20) };
  }

  // 3) 创建任务：确定性解析优先（零 API 消耗、毫秒级）
  const resolved = resolveDueAt(text, now);
  if (resolved.ok) {
    const title = extractTaskTitle(text);
    const recurrence = resolved.recurrence || 'none';
    const dup = await findDuplicateActiveTask({ title, dueAt: resolved.dueAt, recurrence });
    if (dup) return { action: 'created', task: dup, duplicated: true };
    const task = await createMomiTask({
      userId, title, dueAt: resolved.dueAt, sourceMessageId, recurrence,
    });
    return { action: 'created', task, duplicated: false };
  }

  // 4) 确定性解析拿不到时间：轻量 LLM 兵底
  const extracted = await extractTaskWithLLM(text, now);
  if (extracted?.action === 'create') {
    const dup = await findDuplicateActiveTask({
      title: extracted.title, dueAt: extracted.dueAt, recurrence: extracted.recurrence,
    });
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
  if (extracted?.action === 'cancel') {
    const cancelled = await cancelMomiTasksByKeyword(extracted.keyword);
    if (cancelled.count > 0) return { action: 'cancelled', ...cancelled };
    return { action: 'cancel_failed', keyword: extracted.keyword };
  }

  // 5) 确实是在布置任务但没说时间 / 时间已过 → 交给 momi 反问，不静默丢弃
  if (resolved.error === 'past_time') return { action: 'past_time' };
  return { action: 'need_time', title: extractTaskTitle(text) };
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

/** 已到期的本地降级任务（云端写入失败时保存的提醒也要按时触发） */
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
    const next = computeNextOccurrenceCore({ recurrence, dueAt: task.due_at }, now);
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
  const recurrence = task.recurrence && task.recurrence !== 'none' ? task.recurrence : null;
  if (recurrence) {
    return `⏰ 任务定好啦：${formatRecurrence(recurrence, due)}「${task.title}」，到点我来执行～`;
  }
  return `⏰ 提醒定好啦：${formatDueAt(due)}「${task.title}」，到点我来叫你～`;
}

export async function listMomiTasks({ status = 'active', limit = 100 } = {}) {
  let cloud = null;
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
    cloud = data || [];
  } catch {
    cloud = null;
  }
  const local = await getLocalTasksFallback(status);
  if (cloud == null) return local;
  if (!local.length) return cloud;
  // 云端 + 本地降级任务合并，避免离线期间创建的提醒在列表里“消失”
  return [...cloud, ...local].sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
}

export function formatTasksSummary(tasks = []) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return '当前没有进行中的定时提醒任务。';
  }
  return tasks
    .map((t, idx) => {
      const recurrence = t.recurrence && t.recurrence !== 'none'
        ? `（${RECURRENCE_LABELS[t.recurrence] || t.recurrence}）`
        : '';
      return `${idx + 1}. 「${t.title}」${recurrence} - 提醒时间：${formatLocalTime(t.due_at)}（状态：${t.status === 'active' ? '进行中' : t.status}）`;
    })
    .join('\n');
}

export async function updateMomiTask(id, patch) {
  const allowed = {};
  for (const key of ['title', 'due_at', 'status', 'notified_at', 'recurrence', 'ai_prompt']) {
    if (patch[key] !== undefined) allowed[key] = patch[key];
  }
  if (String(id).startsWith('local_task_')) {
    await updateLocalTask(id, allowed);
    return { id, ...allowed };
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
