// ═══════════════════════════════════════════════════════
// auth —— 登录身份服务
//
// 正式模式：Supabase Auth（邮箱 + 密码）。
//   账号由用户在 Supabase 控制台预建（本项目已关闭公开注册），
//   App 内昵称（momo / 苞米）只是展示字段，从 user_metadata.app_username
//   或 profiles 表推导，不作为密码或权限凭据。
//   会话由 supabase-js 安全持久化（AsyncStorage），支持启动恢复与刷新。
//
// 开发模式（仅 __DEV__ 构建）：允许直接选择测试身份，方便开发与
// 自动化冒烟。release 构建中该路径不存在，数据保护由 RLS 承担。
// ═══════════════════════════════════════════════════════
import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const KNOWN_USERS = ['momo', '苞米'];
const DEV_SESSION_KEY = 'dev_session_user';

// 把 auth.users 行映射为 App 身份（momo / 苞米）。
// 优先级：profiles 表（迁移后权威）→ user_metadata.app_username → 邮箱本地部分。
async function deriveAppUser(user) {
  if (!user) return null;

  let username = null;
  try {
    const { data } = await supabase
      .from('profiles')
      .select('username')
      .eq('auth_uid', user.id)
      .maybeSingle();
    if (data && KNOWN_USERS.includes(data.username)) username = data.username;
  } catch (e) {
    // profiles 表尚未创建（迁移未执行）——继续走 metadata 兜底
  }

  if (!username) {
    const meta = user.user_metadata?.app_username;
    if (KNOWN_USERS.includes(meta)) username = meta;
  }

  if (!username && typeof user.email === 'string') {
    const local = user.email.split('@')[0].trim().toLowerCase();
    if (local === 'momo') username = 'momo';
    if (local === 'baomi' || local === '苞米') username = '苞米';
  }

  return username || null;
}

function mapAuthError(error) {
  const msg = String(error?.message || '');
  if (/invalid login credentials/i.test(msg)) return '邮箱或密码错误，请重试';
  if (/email not confirmed/i.test(msg)) return '邮箱尚未确认，请先在邮箱中完成验证';
  if (/failed to fetch|network|timeout/i.test(msg)) return '网络连接失败，请检查网络后重试';
  if (/too many requests/i.test(msg)) return '尝试次数过多，请稍后再试';
  return msg || '登录失败，请重试';
}

/**
 * 邮箱 + 密码登录
 * @returns {Promise<{username: string, email: string}>}
 * @throws {Error} message 为用户可读中文
 */
export async function signIn(email, password) {
  const trimmedEmail = String(email || '').trim();
  if (!trimmedEmail || !password) throw new Error('请输入邮箱和密码');

  const { data, error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });
  if (error) throw new Error(mapAuthError(error));

  const username = await deriveAppUser(data.user);
  if (!username) {
    // 登录成功但账号未绑定 momo/苞米 身份——服务端配置不完整
    await supabase.auth.signOut();
    throw new Error('该账号尚未绑定 App 身份，请先在 Supabase 控制台为其配置 app_username');
  }
  return { username, email: data.user.email };
}

/**
 * 启动会话恢复。返回 { username, email } 或 null（未登录）。
 */
export async function restoreSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  const session = data?.session;
  if (!session?.user) return null;

  const username = await deriveAppUser(session.user);
  if (!username) return null;
  return { username, email: session.user.email };
}

/**
 * 退出登录：清理 IM 之外的本地会话由调用方负责，这里只处理 Supabase Auth。
 */
export async function signOutSupabase() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    // 网络失败也继续——本地 session 会在下次启动时被刷新失败清除
  }
  await AsyncStorage.removeItem(DEV_SESSION_KEY).catch(() => {});
}

// ─── 开发模式（不进入 release 构建）───
export function isDevLoginAvailable() {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export async function devLogin(nickname) {
  if (!isDevLoginAvailable()) throw new Error('开发登录仅在调试构建可用');
  if (!KNOWN_USERS.includes(nickname)) throw new Error('未知身份');
  await AsyncStorage.setItem(DEV_SESSION_KEY, nickname);
  return { username: nickname, email: null };
}

export async function restoreDevSession() {
  if (!isDevLoginAvailable()) return null;
  try {
    const nickname = await AsyncStorage.getItem(DEV_SESSION_KEY);
    if (KNOWN_USERS.includes(nickname)) return { username: nickname, email: null };
  } catch (e) { /* ignore */ }
  return null;
}
