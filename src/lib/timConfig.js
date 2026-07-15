// ═══════════════════════════════════════════════════════
// 腾讯云 IM 配置
//
// ⚠️ 使用前请先完成腾讯云控制台配置（见会话末尾的指引），
//    然后把下面两个值替换成你的实际值。
// ═══════════════════════════════════════════════════════

// 在【即时通信 IM 控制台】→【应用管理】→ 新建应用 后，
// 应用详情页顶部能看到 SDKAppID（一串数字）
export const TIM_SDKAPPID = 1600149512; // TODO: 替换为你的 SDKAppID（数字类型，例如 1400123456）

// 在应用详情页 →【辅助功能】→【UserSig 工具】或【密钥】处查看
// 一串 64 位十六进制字符串（形如 5bd2850fff3ecb11d7c805251c51ee463a25727bddc2385f3fa8bfee1bb93b5e）
export const TIM_SECRET_KEY = '7364e2eb4c0e4804bb3a332e4ca7074abeb2c145df39c5bfe528ad59147c55ad'; // TODO: 替换为你的 SecretKey

// UserSig 有效期（秒）。180 天 = 180 * 86400
export const USER_SIG_EXPIRE = 180 * 24 * 3600;

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
