// ═══════════════════════════════════════════════════════
// 腾讯云 IM SDK 封装（基于 @tencentcloud/chat Web SDK v3）
//
// 仅暴露本应用需要的能力：
//   - login(appUserId)   用 userSig 登录
//   - logout()
//   - sendCustom(toAppUserId, data)  发送自定义消息（C2C）
//   - onMessage(cb)        监听收到消息
//   - onReady(cb)          监听 SDK 就绪
//   - onKickedOut(cb)      监听被踢下线
//
// 业务层不应直接 import 这个文件，请使用 realtimeSignal.js。
// ═══════════════════════════════════════════════════════
import TencentCloudChat from '@tencentcloud/chat';
import { getUserSig } from './userSig';
import { TIM_SDKAPPID, toIMUserID, toAppUserID } from './timConfig';

let chat = null;
let readyResolvers = [];
let isReady = false;

// 等待 SDK_READY（login 后异步触发）
// 增加 5 秒超时：SDK 偶发 NOT_READY 时避免 sendCustom 永久挂起导致信号丢失
function waitReady() {
  if (isReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('[tim] SDK_READY 等待超时'));
    }, 5000);
    readyResolvers.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ─── 登录 ───
export async function login(appUserId) {
  if (!TIM_SDKAPPID) {
    throw new Error('[tim] SDKAppID 未配置，请填写 src/lib/timConfig.js');
  }

  // 重复登录保护：同一账号已登录则直接等 ready
  if (chat && chat.isLoggedIn && chat.isLoggedIn()) {
    await waitReady();
    return;
  }

  if (!chat) {
    chat = TencentCloudChat.create({ SDKAppID: TIM_SDKAPPID });
    chat.setLevel?.(0); // 关闭日志输出
    chat.on(TencentCloudChat.EVENT.SDK_READY, () => {
      isReady = true;
      readyResolvers.forEach((r) => r());
      readyResolvers = [];
    });
    chat.on(TencentCloudChat.EVENT.SDK_NOT_READY, () => {
      isReady = false;
    });
  }

  const imUserId = toIMUserID(appUserId);
  const userSig = await getUserSig(imUserId);

  const res = await chat.login({ userID: imUserId, userSig });
  if (res?.code !== 0) {
    throw new Error(`[tim] 登录失败: ${res?.code} ${res?.data?.errorUserInfo || ''}`);
  }
  await waitReady();
}

// ─── 登出 ───
export async function logout() {
  if (!chat) return;
  try {
    await chat.logout();
  } catch (e) {
    console.warn('[tim] logout error:', e.message);
  }
  isReady = false;
}

// ─── 发送自定义消息（C2C）───
// data 是任意可序列化对象，内部 JSON.stringify 后放入 payload.data
export async function sendCustom(toAppUserId, data) {
  if (!chat) throw new Error('[tim] 未登录');
  await waitReady();

  const toIMId = toIMUserID(toAppUserId);
  const message = chat.createCustomMessage({
    to: toIMId,
    conversationType: TencentCloudChat.TYPES.CONV_C2C,
    payload: { data: JSON.stringify(data), description: '', extension: '' },
  });
  const res = await chat.sendMessage(message);
  return res;
}

// ─── 监听收到消息 ───
// cb(messages, fromAppUserId) —— messages 是原生消息数组，
// 已经过滤为只含自定义消息并附带解析后的 data 与 fromAppId
export function onMessage(cb) {
  if (!chat) return () => {};
  const handler = (event) => {
    const list = Array.isArray(event?.data) ? event.data : [];
    const parsed = [];
    for (const msg of list) {
      if (msg.type !== TencentCloudChat.TYPES.MSG_CUSTOM) continue;
      let data = null;
      try {
        data = JSON.parse(msg.payload?.data || '{}');
      } catch (e) {
        continue; // 非 JSON，忽略（可能是其他自定义消息）
      }
      parsed.push({
        data,
        fromAppId: toAppUserID(msg.from),
        raw: msg,
      });
    }
    if (parsed.length > 0) cb(parsed);
  };
  chat.on(TencentCloudChat.EVENT.MESSAGE_RECEIVED, handler);
  return () => chat?.off(TencentCloudChat.EVENT.MESSAGE_RECEIVED, handler);
}

// ─── 监听被踢下线 ───
export function onKickedOut(cb) {
  if (!chat) return () => {};
  const handler = (event) => cb(event);
  chat.on(TencentCloudChat.EVENT.KICKED_OUT, handler);
  return () => chat?.off(TencentCloudChat.EVENT.KICKED_OUT, handler);
}

// ─── 当前是否已登录 ───
export function isLoggedIn() {
  return !!chat && chat.isLoggedIn && chat.isLoggedIn();
}
