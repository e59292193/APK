// momi 主动消息 A 方案：前台定时调度 + B 方案原生通知适配接口
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { chatWithMomi, saveAssistantMessage, COUPLE_ID } from './momiAssistant';
import { getMomiState, canSendProactive, markProactiveSent } from './momiState';
import { getProactiveSettings } from './momiProactiveSettings';
import { getWeather, getWeatherAlert } from './weatherService';

let notificationAdapter = null;

/**
 * B 方案接入点（安装 expo-notifications 后注入）：
 * { schedule({ title, body, date, data }), present({ title, body, data }) }
 */
export function setNotificationAdapter(adapter) {
  notificationAdapter = adapter;
}

async function dedupeEvent(eventKey, eventType, payload = {}) {
  try {
    const existing = await fetchWithTimeout(() =>
      supabase
        .from('momi_proactive_log')
        .select('id')
        .eq('couple_id', COUPLE_ID)
        .eq('event_key', eventKey)
        .maybeSingle()
    );
    if (existing?.data) return false;
    const inserted = await fetchWithTimeout(() =>
      supabase.from('momi_proactive_log').insert([{
        couple_id: COUPLE_ID, event_key: eventKey, event_type: eventType, payload,
      }])
    );
    return !inserted?.error;
  } catch {
    // 网络异常时宁可少发，也不要重复骚扰
    return false;
  }
}

async function deliver({ userId, message, eventKey, eventType, onMessage, data = {} }) {
  const unique = await dedupeEvent(eventKey, eventType, data);
  if (!unique) return null;
  const row = await saveAssistantMessage({
    sender: 'momi', content: message, isProactive: true, triggerSource: eventType,
  });
  if (notificationAdapter?.present) {
    await notificationAdapter.present({ title: 'momi 🐾', body: message, data: { eventKey, ...data } }).catch(() => {});
  }
  onMessage?.(row);
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
  } catch {
    return null;
  }
}

async function markTaskNotified(id, now) {
  await supabase
    .from('momi_tasks')
    .update({ notified_at: now.toISOString(), status: 'done' })
    .eq('id', id);
}

/**
 * 运行一轮调度。优先级：到期任务 > 极端天气 > 静默后自然关心。
 */
export async function tickProactiveScheduler({ userId, onMessage, now = new Date() }) {
  const settings = await getProactiveSettings(userId);
  if (!settings.proactiveEnabled) return { sent: false, reason: 'disabled' };
  const state = await getMomiState();
  const gate = canSendProactive(state, { ...settings, now });
  if (!gate.allowed) return { sent: false, reason: gate.reason };

  // 1. 到期提醒
  const due = await dueTaskTrigger(now);
  if (due) {
    const row = await deliver({
      userId, message: due.message, eventKey: `task:${due.task.id}`,
      eventType: 'scheduled_reminder', onMessage, data: { taskId: due.task.id },
    });
    if (row) {
      await markTaskNotified(due.task.id, now);
      await markProactiveSent(state, gate.today);
      return { sent: true, type: 'scheduled_reminder', row };
    }
  }

  // 2. 天气提醒
  if (settings.weatherEnabled && (settings.city || Number.isFinite(settings.latitude))) {
    try {
      const weather = await getWeather(settings);
      const alert = getWeatherAlert(weather, now);
      if (alert) {
        const row = await deliver({
          userId, message: alert.message, eventKey: `weather:${alert.key}`,
          eventType: 'weather', onMessage, data: { location: weather.location },
        });
        if (row) {
          await markProactiveSent(state, gate.today);
          return { sent: true, type: 'weather', row };
        }
      }
    } catch (err) {
      console.warn('[proactiveScheduler] 天气检查跳过:', err.message);
    }
  }

  // 3. 静默时长达到阈值才生成自然关心；每 2 小时一个去重时间桶
  const last = state.last_interaction_at ? new Date(state.last_interaction_at).getTime() : 0;
  const silentHours = last ? (now.getTime() - last) / 3600000 : Infinity;
  if (silentHours < settings.silenceHours) return { sent: false, reason: 'not_silent_long_enough' };
  const bucket = Math.floor(now.getTime() / (2 * 3600000));
  const generated = await chatWithMomi({
    userId,
    message: `系统触发：已经有 ${Math.floor(silentHours)} 小时没人和你互动。请用一句不超过50字、自然不重复的方式主动关心 momo 和 苞米；不要说“系统触发”。`,
    recentChatHistory: [],
    triggerSource: 'proactive',
  });
  if (!generated.success) return { sent: false, reason: generated.errorCode || 'ai_failed' };
  const row = await deliver({
    userId, message: generated.content, eventKey: `care:${bucket}`,
    eventType: 'proactive_care', onMessage,
  });
  if (!row) return { sent: false, reason: 'deduped' };
  await markProactiveSent(state, gate.today);
  return { sent: true, type: 'proactive_care', row };
}

/** 前台方案 A：登录后调用，立即 tick，之后每 15 分钟 tick；返回清理函数。 */
export function startForegroundProactiveScheduler({ userId, onMessage }) {
  let disposed = false;
  const run = () => {
    if (!disposed) tickProactiveScheduler({ userId, onMessage }).catch((err) => {
      console.warn('[proactiveScheduler] tick 失败:', err.message);
    });
  };
  const startupTimer = setTimeout(run, 2500);
  const timer = setInterval(run, 15 * 60 * 1000);
  return () => {
    disposed = true;
    clearTimeout(startupTimer);
    clearInterval(timer);
  };
}

/**
 * 安装原生通知适配器后，创建任务时同步注册系统级本地通知（B 方案）。
 */
export async function scheduleNativeTaskNotification(task) {
  if (!notificationAdapter?.schedule || !task?.due_at) return { scheduled: false, reason: 'adapter_missing' };
  await notificationAdapter.schedule({
    title: 'momi 提醒你 🐾', body: task.title, date: new Date(task.due_at), data: { taskId: task.id },
  });
  return { scheduled: true };
}
