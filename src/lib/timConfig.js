// ═══════════════════════════════════════════════════════
// 腾讯云 IM 配置
//
// ⚠️ SecretKey 绝不出现在客户端。
// UserSig 由 Supabase Edge Function（supabase/functions/usersig）
// 基于已登录会话签发，客户端只保存短期签名。
// SDKAppID 本身是公开标识，可以留在客户端。
// ═══════════════════════════════════════════════════════

// 在【即时通信 IM 控制台】→【应用管理】中查看 SDKAppID（一串数字）
export const TIM_SDKAPPID = 1600149512;

// ─── 用户 ID 映射 ───
// 腾讯 IM 的 userID 只允许大小写字母、数字、下划线、连字符，不支持中文。
// 这里把 App 内的中文昵称映射成 IM userID，业务代码继续用中文昵称，
// 信号层自动转换。
const APP_TO_IM = {
  momo: 'momo',
  '苞米': 'baomi',
};

const IM_TO_APP = {
  momo: 'momo',
  baomi: '苞米',
};

// App 昵称 → IM userID
export function toIMUserID(appUserId) {
  return APP_TO_IM[appUserId] || appUserId;
}

// IM userID → App 昵称
export function toAppUserID(imUserId) {
  return IM_TO_APP[imUserId] || imUserId;
}

// 取对方的 App 昵称
export function getPartnerAppId(currentAppUserId) {
  if (currentAppUserId === 'momo') return '苞米';
  if (currentAppUserId === '苞米') return 'momo';
  return '';
}
