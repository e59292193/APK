// ═══════════════════════════════════════════════════════
// realtimeSignal —— 信号抽象层
//
// 业务层只通过这个文件收发实时信号，不直接接触腾讯 IM SDK。
// 后续若更换底层（如换回 Supabase Realtime / WebSocket / LeanCloud），
// 只需改本文件，各 Screen 无需改动。
//
// 使用：
//   import { initSignal, emitSignal, onSignal, disconnectSignal } from '../lib/realtimeSignal';
//
//   // App.js 登录后
//   initSignal(userId);
//
//   // Screen 内
//   useEffect(() => onSignal('chat:message', (msg) => ...), []);
//   emitSignal('chat:message', messageRow);  // 自动发给对方
//
// Topic 约定：
//   - 'chat:message'                       聊天新消息
//   - 'gomoku:${gameId}:update'            五子棋对局行更新
//   - 'gomoku:${gameId}:danmaku'            五子棋弹幕
// ═══════════════════════════════════════════════════════
import * as tim from './tim';
import { getPartnerAppId } from './timConfig';

// topic -> Set<callback>
const subscribers = new Map();

let currentAppUserId = null;
let initialized = false;
let unsubMessage = null;
let unsubKicked = null;
let reconnecting = false;

// ─── 初始化（登录）───
export async function initSignal(appUserId) {
  if (initialized && currentAppUserId === appUserId) return;
  if (initialized) await disconnectSignal();

  currentAppUserId = appUserId;

  try {
    await tim.login(appUserId);
  } catch (e) {
    console.warn('[realtimeSignal] 登录失败，实时信号不可用:', e.message);
    throw e;
  }

  unsubMessage = tim.onMessage((messages) => {
    for (const msg of messages) {
      const { topic, payload } = msg.data || {};
      if (!topic) continue;
      const subs = subscribers.get(topic);
      if (subs) {
        subs.forEach((cb) => {
          try {
            cb(payload, msg.fromAppId);
          } catch (e) {
            console.warn('[realtimeSignal] 订阅回调异常:', topic, e.message);
          }
        });
      }
    }
  });

  unsubKicked = tim.onKickedOut(() => {
    console.warn('[realtimeSignal] 被踢下线，3 秒后尝试重连');
    scheduleReconnect(appUserId);
  });

  initialized = true;
}

// ─── 重连（被踢/网络恢复）───
function scheduleReconnect(appUserId) {
  if (reconnecting) return;
  reconnecting = true;
  setTimeout(async () => {
    reconnecting = false;
    try {
      await tim.login(appUserId);
      console.log('[realtimeSignal] 重连成功');
    } catch (e) {
      console.warn('[realtimeSignal] 重连失败，30 秒后再试:', e.message);
      scheduleReconnect(appUserId);
    }
  }, 3000);
}

// ─── 订阅 topic，返回取消订阅函数 ───
export function onSignal(topic, callback) {
  if (!subscribers.has(topic)) subscribers.set(topic, new Set());
  subscribers.get(topic).add(callback);
  return () => {
    const set = subscribers.get(topic);
    if (set) {
      set.delete(callback);
      if (set.size === 0) subscribers.delete(topic);
    }
  };
}

// ─── 发送信号（自动发给对方）───
export async function emitSignal(topic, payload) {
  const partnerId = getPartnerAppId(currentAppUserId);
  if (!partnerId) {
    console.warn('[realtimeSignal] 无法确定对方账号:', currentAppUserId);
    return;
  }
  try {
    await tim.sendCustom(partnerId, { topic, payload });
  } catch (e) {
    console.warn('[realtimeSignal] 发送失败:', topic, e.message);
  }
}

// ─── 断开（退出登录）───
export async function disconnectSignal() {
  if (unsubMessage) { unsubMessage(); unsubMessage = null; }
  if (unsubKicked) { unsubKicked(); unsubKicked = null; }
  subscribers.clear();
  await tim.logout();
  initialized = false;
  currentAppUserId = null;
}

// ─── 当前是否就绪（供调试）───
export function isReady() {
  return initialized && tim.isLoggedIn();
}
