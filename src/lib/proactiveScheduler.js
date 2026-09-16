// ═══════════════════════════════════════════════════════
// momi 主动消息调度核心 (proactiveScheduler.js)
// 触发器矩阵 / 可降级去重 / 前台 5 分钟轮询 / AppState 唤醒 / 诊断与手动触发
// ═══════════════════════════════════════════════════════

import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { chatWithMomi, saveAssistantMessage, COUPLE_ID } from './momiAssistant';
import { getMomiState, canSendProactive, markProactiveSent } from './momiState';
import { getProactiveSettings, getEffectiveProactiveSettings } from './momiProactiveSettings';
import { getWeather, getWeatherAlert } from './weatherService';
import { hasSentEvent, recordSentEvent } from './proactiveLog';
import { recordProactiveDebug } from './proactiveDebug';

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

async function dueTaskTrigger(now) {
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
    if (error || !data?.[0]) return null;
    return { task: data[0], message: `叮～你让我提醒的「${data[0].title}」到时间啦！别忘记哦 🐾` };
  } catch (err) {
    console.warn('[proactiveScheduler] 到期任务读取异常:', err.message);
    return null;
  }
}

async function markTaskNotified(id, now) {
  try {
    await supabase.from('momi_tasks').update({ notified_at: now.toISOString(), status: 'done' }).eq('id', id);
  } catch (err) {
    console.warn('[proactiveScheduler] 标记任务已通知异常:', err.message);
  }
}

async function anniversaryTrigger(now, settings) {
  if (!settings.anniversaryEnabled) return null;
  try {
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

export async function checkColdStartTaskBackfill(now = new Date(), onMessage) {
  try {
    const twelveHoursAgo = new Date(now.getTime() - 12 * 3600 * 1000).toISOString();
    const { data, error } = await fetchWithTimeout(() =>
      supabase
        .from('momi_tasks')
        .select('*')
        .eq('couple_id', COUPLE_ID)
        .eq('status', 'active')
        .is('notified_at', null)
        .gte('due_at', twelveHoursAgo)
        .lte('due_at', now.toISOString())
        .order('due_at', { ascending: true })
    );
    if (error || !Array.isArray(data) || data.length === 0) return null;

    const eventKey = `task_backfill:${data.map((t) => t.id).sort().join('_')}`;
    let msg = '';
    if (data.length === 1) {
      msg = `叮～你之前让我提醒的「${data[0].title}」到时间啦！别忘记哦 🐾`;
    } else {
      const titles = data.slice(0, 3).map((t) => `「${t.title}」`).join('、');
      msg = `有 ${data.length} 件你让我提醒的事到时间了，包括 ${titles} 等，别忘记查看哦 🐾`;
    }

    const row = await deliver({
      message: msg,
      eventKey,
      eventType: 'scheduled_reminder',
      onMessage,
      data: { taskIds: data.map((t) => t.id) },
    });

    if (row) {
      await Promise.all(
        data.map((t) =>
          supabase.from('momi_tasks').update({ notified_at: now.toISOString(), status: 'done' }).eq('id', t.id)
        )
      );
      return row;
    }
  } catch (err) {
    console.warn('[proactiveScheduler] 冷启动补发提醒失败:', err.message);
  }
  return null;
}

export async function tickProactiveScheduler({ userId, onMessage, now = new Date(), force = false }) {
  const checked = [];
  const settingsGetter = getEffectiveProactiveSettings || getProactiveSettings;
  const settings = await settingsGetter(userId);

  if (!force && !settings.proactiveEnabled) {
    await recordProactiveDebug({ sent: false, reason: 'disabled', checked });
    return { sent: false, reason: 'disabled' };
  }

  const state = await getMomiState();
  const gate = canSendProactive(state, { ...settings, now });

  // 门禁检查（force 模式跳过）
  if (!force && !gate.allowed) {
    await recordProactiveDebug({ sent: false, reason: gate.reason, gate, checked });
    return { sent: false, reason: gate.reason };
  }

  // 1) scheduled_reminder：到期提醒优先判定
  const due = await dueTaskTrigger(now);
  if (due) {
    checked.push({ type: 'scheduled_reminder', hit: true });
    const row = await deliver({
      message: due.message,
      eventKey: `task:${due.task.id}`,
      eventType: 'scheduled_reminder',
      onMessage,
      data: { taskId: due.task.id },
    });
    if (row) {
      await markTaskNotified(due.task.id, now);
      await markProactiveSent(state, gate.today);
      await recordProactiveDebug({ sent: true, type: 'scheduled_reminder', gate, checked });
      return { sent: true, type: 'scheduled_reminder', row };
    }
  } else {
    checked.push({ type: 'scheduled_reminder', hit: false, reason: 'no_due_task' });
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
      tickProactiveScheduler({ userId, onMessage }).catch((err) =>
        console.warn('[proactiveScheduler] tick 失败:', err.message)
      );
    }
  };

  // 1.5 秒后首跑并检查冷启动补发
  const startupTimer = setTimeout(() => {
    if (!disposed) {
      checkColdStartTaskBackfill(new Date(), onMessage).catch(() => {});
      run();
    }
  }, 1500);

  // 5 分钟轮询（原 15 分钟）
  const timer = setInterval(run, 5 * 60 * 1000);

  // AppState 回到 active 时立即触发（60 秒节流）
  let appStateSub = null;
  try {
    // eslint-disable-next-line global-require
    const rn = require('react-native');
    if (rn?.AppState?.addEventListener) {
      appStateSub = rn.AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active' && !disposed) {
          const nowMs = Date.now();
          if (nowMs - lastRunTime >= 60000) {
            lastRunTime = nowMs;
            run();
          }
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

export async function scheduleNativeTaskNotification(task) {
  if (!notificationAdapter?.schedule || !task?.due_at) return { scheduled: false, reason: 'adapter_missing' };
  await notificationAdapter.schedule({
    title: 'momi 提醒你 🐾',
    body: task.title,
    date: new Date(task.due_at),
    data: { taskId: task.id },
  });
  return { scheduled: true };
}
