// ══════════════════════════════════════════════════════
// momi 主动消息调度核心 (proactiveScheduler.js) — V6
// 触发器矩阵 / 可降级去重 / 前台轮询 / AppState 唤醒 / 诊断与手动触发
//
// V6 关键修复：
//   1. 到期提醒在「任何门禁之前」投递。主动消息总开关、免打扰时段、每日条数
//      上限不再吞掉用户亲口布置的提醒（这是「定时任务从来不响」的直接原因）。
//   2. 提醒不计入每日主动消息配额（markProactiveSent 只用于闲聊型主动消息）。
//   3. 前台轮询 5 分钟 → 60 秒；AppState 唤醒节流 60 秒 → 10 秒。
//   4. 冷启动补发同时覆盖云端与本地降级任务。
//   5. 启动时重新预约未来 48 小时内的原生通知，杀进程/重启后闹钟不丢。
// ══════════════════════════════════════════════════════

import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { chatWithMomi, saveAssistantMessage, COUPLE_ID } from './momiAssistant';
import { getMomiState, canSendProactive, markProactiveSent } from './momiState';
import { getProactiveSettings, getEffectiveProactiveSettings } from './momiProactiveSettings';
import { getWeather, getWeatherAlert } from './weatherService';
import { hasSentEvent, recordSentEvent } from './proactiveLog';
import { recordProactiveDebug } from './proactiveDebug';

/** 前台轮询间隔：到点提醒的最大延迟不应超过 1 分钟 */
export const POLL_INTERVAL_MS = 60 * 1000;
/** 启动时重约原生通知的时间窗 */
export const ALARM_HORIZON_MS = 48 * 3600 * 1000;
/** 冷启动补发窗口 */
export const BACKFILL_WINDOW_MS = 12 * 3600 * 1000;

let notificationAdapter = null;
export function setNotificationAdapter(adapter) {
  notificationAdapter = adapter;
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
function isLocalTaskId(id) {
  return String(id).startsWith('local_task_');
}

async function deliver({ message, eventKey, eventType, onMessage, data = {} }) {
  if (await hasSentEvent(eventKey)) return null;

  let row = null;
  try {
    row = await saveAssistantMessage({
      sender: 'momi',
      content: message,
      isProactive: true,
      triggerSource: eventType,
    });
  } catch (err) {
    console.warn('[proactiveScheduler] 写入站内主动消息失败:', err.message);
    return null;
  }

  await recordSentEvent(eventKey, eventType, data);

  if (notificationAdapter?.present) {
    notificationAdapter
      .present({ title: 'momi 🐾', body: message, data: { eventKey, ...data } })
      .catch((e) => console.warn('[proactiveScheduler] 本地通知发送异常:', e.message));
  }

  try {
    onMessage?.(row);
  } catch {}

  return row;
}

/**
 * 到期任务触发：云端 momi_tasks 与本地降级任务（云端表缺失/写入失败时保存）
 * 统一按 due_at 排序取最早一条，本地任务绕不允许静默丢失。
 */
async function dueTaskTrigger(now) {
  let cloudTask = null;
  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase
        .from('momi_tasks')
        .select('*')
        .eq('couple_id', COUPLE_ID)
        .eq('status', 'active')
        .is('notified_at', null)
        .lte('due_at', now.toISOString())
        .order('due_at', { ascending: true })
        .limit(1)
    );
    if (!error && data?.[0]) cloudTask = data[0];
    else if (error) console.warn('[proactiveScheduler] 云端到期任务查询失败:', error.message);
  } catch (err) {
    console.warn('[proactiveScheduler] 云端到期任务读取异常:', err.message);
  }

  let localTask = null;
  try {
    // eslint-disable-next-line global-require
    const { getDueLocalTasks } = require('./momiTasks');
    const locals = await getDueLocalTasks(now);
    localTask = locals[0] || null;
  } catch (err) {
    console.warn('[proactiveScheduler] 本地到期任务读取异常:', err.message);
  }

  const task = [cloudTask, localTask]
    .filter(Boolean)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0];
  if (!task) return null;
  return {
    task,
    isLocal: isLocalTaskId(task.id),
    message: `叮～你让我提醒的「${task.title}」到时间啦！别忘记哦 🐾`,
  };
}

/**
 * 任务触发后的落库：
 * - 一次性任务：标记 notified_at + status=done
 * - 周期任务（daily/weekday/weekly）：推进 due_at 到下一次，保持 active，并重新预约本地通知
 */
async function markTaskFired(task, now) {
  const recurrence = task?.recurrence && task.recurrence !== 'none' ? task.recurrence : null;
  try {
    if (!recurrence) {
      await supabase.from('momi_tasks').update({ notified_at: now.toISOString(), status: 'done' }).eq('id', task.id);
      return;
    }
    // eslint-disable-next-line global-require
    const { computeNextOccurrence } = require('./momiTasks');
    const next = computeNextOccurrence({ recurrence, dueAt: task.due_at }, now);
    if (!next) {
      await supabase.from('momi_tasks').update({ notified_at: now.toISOString(), status: 'done' }).eq('id', task.id);
      return;
    }
    await supabase.from('momi_tasks').update({ due_at: next.toISOString(), notified_at: null }).eq('id', task.id);
    // 重新预约下一次的本地原生通知
    try {
      if (notificationAdapter?.cancel) await notificationAdapter.cancel(String(task.id));
      scheduleNativeTaskNotification({ ...task, due_at: next.toISOString() }).catch(() => {});
    } catch (notifyErr) {
      console.warn('[proactiveScheduler] 周期任务重约通知异常:', notifyErr.message);
    }
  } catch (err) {
    console.warn('[proactiveScheduler] 标记任务触发结果异常:', err.message);
  }
}

/**
 * 【V6 新增】到期提醒投递：在所有门禁之前执行。
 * 用户亲口布置的提醒属于「承诺」，不属于「骚扰」，因此：
 *   - 不受 proactiveEnabled / quiet_hours / 每日上限限制
 *   - 不调 markProactiveSent，不占用当日主动消息配额
 */
async function deliverDueTasks({ userId, onMessage, now }) {
  let due = null;
  try {
    due = await dueTaskTrigger(now);
  } catch (err) {
    console.warn('[proactiveScheduler] 到期任务判定异常:', err.message);
  }
  if (!due) return { sent: false, reason: 'no_due_task' };

  let message = due.message;
  // 自定义任务（如“每天早上给我发一句英语”）到点时由 momi 实时生成内容，失败回退模板文案
  if (due.task.ai_prompt) {
    try {
      const generated = await chatWithMomi({
        userId,
        message: `（定时任务到点执行）${due.task.ai_prompt}`,
        recentChatHistory: [],
        triggerSource: 'scheduled',
      });
      if (generated?.success && generated.content) message = generated.content;
    } catch (err) {
      console.warn('[proactiveScheduler] 任务内容生成失败，使用模板文案:', err.message);
    }
  }

  const row = await deliver({
    message,
    // 去重键带触发时间：周期任务每次触发都是新事件，不会被去重拦截
    eventKey: `task:${due.task.id}:${String(due.task.due_at).slice(0, 16)}`,
    eventType: 'scheduled_reminder',
    onMessage,
    data: { taskId: due.task.id },
  });
  if (!row) return { sent: false, reason: 'deduped' };

  if (due.isLocal) {
    try {
      // eslint-disable-next-line global-require
      const { markLocalTaskFired } = require('./momiTasks');
      await markLocalTaskFired(due.task, now);
    } catch (err) {
      console.warn('[proactiveScheduler] 本地任务标记触发失败:', err.message);
    }
  } else {
    await markTaskFired(due.task, now);
  }

  return { sent: true, row, task: due.task };
}

async function anniversaryTrigger(now, settings) {
  if (!settings.anniversaryEnabled) return null;
  try {
    // eslint-disable-next-line global-require
    const { getAnniversarySummary } = require('./momiDataAccess');
    const summary = await getAnniversarySummary();
    const upcoming = summary?.upcoming;
    if (!upcoming) return null;
    const diff = upcoming.days;
    const dateStr = upcoming.date;
    const title = upcoming.title;
    if (diff === 0) {
      return {
        eventKey: `anniversary:${title}:${dateStr}:today`,
        message: `今天是我们特别的「${title}」！纪念日快乐 momo 和 苞米 🎉`,
      };
    }
    if (diff === 1) {
      return {
        eventKey: `anniversary:${title}:${dateStr}:1d`,
        message: `明天就是「${title}」啦！要开心度过哦 🐾`,
      };
    }
    if (diff === 3) {
      return {
        eventKey: `anniversary:${title}:${dateStr}:3d`,
        message: `距离「${title}」还有 3 天啦！准备怎么庆祝呀 ✨`,
      };
    }
  } catch (err) {
    console.warn('[proactiveScheduler] 纪念日触发检查跳过:', err.message);
  }
  return null;
}

function greetingTrigger(now, settings, state) {
  if (!settings.greetingEnabled) return null;
  const todayStr = toDateStr(now);
  if (state.proactive_date === todayStr && (state.proactive_count_today || 0) > 0) {
    return null; // 当天已有其它主动消息时跳过
  }
  const hhmm = toHHMM(now);
  if (hhmm >= '08:00' && hhmm <= '10:00') {
    return {
      eventKey: `greeting:morning:${todayStr}`,
      message: '早安 momo 和 苞米！新的一天也要元气满满哦 ☀️',
      type: 'greeting',
    };
  }
  if (hhmm >= '21:30' && hhmm <= '22:30') {
    return {
      eventKey: `greeting:evening:${todayStr}`,
      message: '夜深啦，今天辛苦了，早点休息做个好梦呀 🌙',
      type: 'greeting',
    };
  }
  return null;
}

function comebackTrigger(silentHours, now) {
  if (silentHours >= 48) {
    const dayBucket = Math.floor(now.getTime() / 86400000);
    return {
      eventKey: `comeback:${dayBucket}`,
      message: '好久没有看到你们啦，momi 好想你们呀！最近过得怎么样呢 🥺',
      type: 'comeback',
    };
  }
  return null;
}

/** 冷启动补发：V6 同时覆盖云端与本地降级任务 */
export async function checkColdStartTaskBackfill(now = new Date(), onMessage) {
  try {
    const windowStart = new Date(now.getTime() - BACKFILL_WINDOW_MS);
    const tasks = [];

    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase
          .from('momi_tasks')
          .select('*')
          .eq('couple_id', COUPLE_ID)
          .eq('status', 'active')
          .is('notified_at', null)
          .gte('due_at', windowStart.toISOString())
          .lte('due_at', now.toISOString())
          .order('due_at', { ascending: true })
      );
      if (!error && Array.isArray(data)) tasks.push(...data);
    } catch (err) {
      console.warn('[proactiveScheduler] 云端补发查询异常:', err.message);
    }

    let markLocalTaskFired = null;
    try {
      // eslint-disable-next-line global-require
      const momiTasks = require('./momiTasks');
      markLocalTaskFired = momiTasks.markLocalTaskFired;
      const locals = await momiTasks.getDueLocalTasks(now);
      tasks.push(...locals.filter((t) => new Date(t.due_at).getTime() >= windowStart.getTime()));
    } catch (err) {
      console.warn('[proactiveScheduler] 本地补发查询异常:', err.message);
    }

    if (tasks.length === 0) return null;
    tasks.sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

    const eventKey = `task_backfill:${tasks.map((t) => t.id).sort().join('_')}`;
    let msg = '';
    if (tasks.length === 1) {
      msg = `叮～你之前让我提醒的「${tasks[0].title}」到时间啦！别忘记哦 🐾`;
    } else {
      const titles = tasks.slice(0, 3).map((t) => `「${t.title}」`).join('、');
      msg = `有 ${tasks.length} 件你让我提醒的事到时间了，包括 ${titles} 等，别忘记查看哦 🐾`;
    }

    const row = await deliver({
      message: msg,
      eventKey,
      eventType: 'scheduled_reminder',
      onMessage,
      data: { taskIds: tasks.map((t) => t.id) },
    });

    if (row) {
      // 一次性任务标记完成；周期任务推进到下一次（不能直接置 done，否则周期任务失效）
      for (const t of tasks) {
        if (isLocalTaskId(t.id)) {
          // eslint-disable-next-line no-await-in-loop
          if (markLocalTaskFired) await markLocalTaskFired(t, now);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await markTaskFired(t, now);
        }
      }
      return row;
    }
  } catch (err) {
    console.warn('[proactiveScheduler] 冷启动补发提醒失败:', err.message);
  }
  return null;
}

export async function tickProactiveScheduler({ userId, onMessage, now = new Date(), force = false }) {
  const checked = [];

  // 0) scheduled_reminder：最高优先级，先于所有门禁（V6）
  const dueResult = await deliverDueTasks({ userId, onMessage, now });
  if (dueResult.sent) {
    checked.push({ type: 'scheduled_reminder', hit: true });
    await recordProactiveDebug({ sent: true, type: 'scheduled_reminder', checked });
    return { sent: true, type: 'scheduled_reminder', row: dueResult.row };
  }
  checked.push({ type: 'scheduled_reminder', hit: false, reason: dueResult.reason });

  const settingsGetter = getEffectiveProactiveSettings || getProactiveSettings;
  const settings = await settingsGetter(userId);

  if (!force && !settings.proactiveEnabled) {
    await recordProactiveDebug({ sent: false, reason: 'disabled', checked });
    return { sent: false, reason: 'disabled' };
  }

  const state = await getMomiState();
  const gate = canSendProactive(state, { ...settings, now });

  // 门禁检查（force 模式跳过）—— 只限制闲聊型主动消息，不影响上方的到期提醒
  if (!force && !gate.allowed) {
    await recordProactiveDebug({ sent: false, reason: gate.reason, gate, checked });
    return { sent: false, reason: gate.reason };
  }

  // 2) weather：降雨概率 >= 60% 或 12 小时降温 >= 6 度
  if ((force || settings.weatherEnabled) && (settings.city || Number.isFinite(settings.latitude))) {
    try {
      const weather = await getWeather(settings);
      const alert = getWeatherAlert(weather, now);
      if (alert) {
        checked.push({ type: 'weather', hit: true });
        const row = await deliver({
          message: alert.message,
          eventKey: `weather:${alert.key}`,
          eventType: 'weather',
          onMessage,
          data: { location: weather.location },
        });
        if (row) {
          await markProactiveSent(state, gate.today);
          await recordProactiveDebug({ sent: true, type: 'weather', gate, checked });
          return { sent: true, type: 'weather', row };
        }
      } else {
        checked.push({ type: 'weather', hit: false, reason: 'no_alert' });
      }
    } catch (err) {
      checked.push({ type: 'weather', hit: false, reason: err.message });
      console.warn('[proactiveScheduler] 天气检查跳过:', err.message);
    }
  }

  // 3) anniversary：纪念日提前 3 天、1 天、当天各 1 条
  const anniv = await anniversaryTrigger(now, settings);
  if (anniv) {
    checked.push({ type: 'anniversary', hit: true });
    const row = await deliver({
      message: anniv.message,
      eventKey: anniv.eventKey,
      eventType: 'anniversary',
      onMessage,
    });
    if (row) {
      await markProactiveSent(state, gate.today);
      await recordProactiveDebug({ sent: true, type: 'anniversary', gate, checked });
      return { sent: true, type: 'anniversary', row };
    }
  } else {
    checked.push({ type: 'anniversary', hit: false, reason: 'no_upcoming_anniversary' });
  }

  // 4) greeting：早安 / 晚安
  const greeting = greetingTrigger(now, settings, state);
  if (greeting) {
    checked.push({ type: 'greeting', hit: true });
    const row = await deliver({
      message: greeting.message,
      eventKey: greeting.eventKey,
      eventType: 'greeting',
      onMessage,
    });
    if (row) {
      await markProactiveSent(state, gate.today);
      await recordProactiveDebug({ sent: true, type: 'greeting', gate, checked });
      return { sent: true, type: 'greeting', row };
    }
  } else {
    checked.push({ type: 'greeting', hit: false, reason: 'not_greeting_time_or_already_sent' });
  }

  // 5 & 6) comeback 与 proactive_care 静默关心
  const last = state.last_interaction_at ? new Date(state.last_interaction_at).getTime() : 0;
  const silentHours = last ? (now.getTime() - last) / 3600000 : Infinity;

  // 6) comeback：静默 > 48 小时
  if (silentHours >= 48) {
    checked.push({ type: 'comeback', hit: true });
    const cb = comebackTrigger(silentHours, now);
    const row = await deliver({
      message: cb.message,
      eventKey: cb.eventKey,
      eventType: 'comeback',
      onMessage,
    });
    if (row) {
      await markProactiveSent(state, gate.today);
      await recordProactiveDebug({ sent: true, type: 'comeback', gate, checked });
      return { sent: true, type: 'comeback', row };
    }
  } else {
    checked.push({ type: 'comeback', hit: false, reason: 'silent_less_than_48h' });
  }

  // 5) proactive_care：静默超过 settings.silenceHours
  if (!force && silentHours < settings.silenceHours) {
    checked.push({ type: 'proactive_care', hit: false, reason: 'not_silent_long_enough' });
    await recordProactiveDebug({ sent: false, reason: 'not_silent_long_enough', gate, checked });
    return { sent: false, reason: 'not_silent_long_enough' };
  }

  const bucket = Math.floor(now.getTime() / 7200000);
  const userPrompt = force
    ? '（主动测试）：向你的家人打个活泼可爱的招呼。'
    : `（状态提示）：已经有 ${Math.floor(silentHours)} 小时没人和你互动，发条消息关心一下他们吧。`;

  const generated = await chatWithMomi({
    userId,
    message: userPrompt,
    recentChatHistory: [],
    triggerSource: force ? 'assistant' : 'proactive',
  });

  if (!generated.success) {
    const aiReason = generated.errorCode || 'ai_failed';
    checked.push({ type: 'proactive_care', hit: false, reason: aiReason });
    await recordProactiveDebug({ sent: false, reason: aiReason, gate, checked });
    return { sent: false, reason: aiReason };
  }

  const careEventType = force ? 'manual_test' : 'proactive_care';
  const careEventKey = force ? `manual_test:${Date.now()}` : `care:${bucket}`;
  const row = await deliver({
    message: generated.content,
    eventKey: careEventKey,
    eventType: careEventType,
    onMessage,
  });

  if (!row) {
    checked.push({ type: 'proactive_care', hit: false, reason: 'deduped' });
    await recordProactiveDebug({ sent: false, reason: 'deduped', gate, checked });
    return { sent: false, reason: 'deduped' };
  }

  await markProactiveSent(state, gate.today);
  await recordProactiveDebug({ sent: true, type: careEventType, gate, checked });
  return { sent: true, type: careEventType, row };
}

export function startForegroundProactiveScheduler({ userId, onMessage }) {
  let disposed = false;
  let lastRunTime = Date.now();

  const run = () => {
    if (!disposed) {
      lastRunTime = Date.now();
      tickProactiveScheduler({ userId, onMessage }).catch((err) =>
        console.warn('[proactiveScheduler] tick 失败:', err.message)
      );
    }
  };

  // 1.2 秒后首跑：重约原生闹钟 + 冷启动补发 + 到期检查
  const startupTimer = setTimeout(() => {
    if (disposed) return;
    rearmUpcomingTaskNotifications(new Date()).catch(() => {});
    checkColdStartTaskBackfill(new Date(), onMessage).catch(() => {});
    run();
  }, 1200);

  // 60 秒轮询（原 5 分钟）：到点提醒最多延迟 1 分钟
  const timer = setInterval(run, POLL_INTERVAL_MS);

  // AppState 回到 active 时立即触发（10 秒节流）
  let appStateSub = null;
  try {
    // eslint-disable-next-line global-require
    const rn = require('react-native');
    if (rn?.AppState?.addEventListener) {
      appStateSub = rn.AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active' && !disposed) {
          if (Date.now() - lastRunTime >= 10000) run();
        }
      });
    }
  } catch {}

  return () => {
    disposed = true;
    clearTimeout(startupTimer);
    clearInterval(timer);
    appStateSub?.remove?.();
  };
}

/**
 * 【V6 新增】启动时重新预约未来 48 小时内的原生通知。
 * 卸载重装、系统重启、被杀后系统清理都会丢弃已预约的闹钟，
 * adapter 内部按 taskId 去重（duplicate_task），重复调用不会双发通知。
 */
export async function rearmUpcomingTaskNotifications(now = new Date()) {
  if (!notificationAdapter?.schedule) return { rearmed: 0, reason: 'adapter_missing' };
  try {
    // eslint-disable-next-line global-require
    const { listMomiTasks } = require('./momiTasks');
    const tasks = await listMomiTasks({ status: 'active', limit: 100 });
    const horizon = now.getTime() + ALARM_HORIZON_MS;
    const upcoming = (Array.isArray(tasks) ? tasks : []).filter((t) => {
      if (!t || t.notified_at) return false;
      const ts = new Date(t.due_at).getTime();
      return Number.isFinite(ts) && ts > now.getTime() && ts <= horizon;
    });
    let rearmed = 0;
    for (const t of upcoming) {
      // eslint-disable-next-line no-await-in-loop
      const res = await scheduleNativeTaskNotification(t);
      if (res?.scheduled) rearmed += 1;
    }
    return { rearmed, total: upcoming.length };
  } catch (err) {
    console.warn('[proactiveScheduler] 重新预约本地提醒失败:', err.message);
    return { rearmed: 0, error: err.message };
  }
}

export async function scheduleNativeTaskNotification(task) {
  if (!notificationAdapter?.schedule || !task?.due_at) return { scheduled: false, reason: 'adapter_missing' };
  const date = new Date(task.due_at);
  if (Number.isNaN(date.getTime())) return { scheduled: false, reason: 'invalid_due_at' };
  try {
    const res = await notificationAdapter.schedule({
      title: 'momi 提醒你 🐾',
      body: task.title,
      date,
      data: { taskId: task.id },
    });
    if (res && res.scheduled === false) return res;
    return { scheduled: true };
  } catch (err) {
    console.warn('[proactiveScheduler] 预约本地提醒失败:', err.message);
    return { scheduled: false, reason: 'schedule_failed', error: err.message };
  }
}

/** 取消指定任务已预约的本地通知（聊天内取消任务时同步调用） */
export async function cancelNativeTaskNotification(taskId) {
  if (!notificationAdapter?.cancel || taskId == null) return { cancelled: false, reason: 'adapter_missing' };
  try {
    return await notificationAdapter.cancel(String(taskId));
  } catch (err) {
    console.warn('[proactiveScheduler] 取消任务通知异常:', err.message);
    return { cancelled: false, error: err.message };
  }
}
