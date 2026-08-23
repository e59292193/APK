// ═══════════════════════════════════════════════════════
// auth —— 登录身份服务（本地双账号模式）
//
// 应用为两人专属：昵称 + 密码本地校验，会话持久化到 AsyncStorage。
// （2026-08-23：经用户确认保留此登录方式；Supabase Auth 邮箱登录
//  作为后续可选升级，需要先在控制台预建账号并执行
//  supabase/migrations 下的迁移，启用前不要执行 0002 及之后的收紧策略。）
// ═══════════════════════════════════════════════════════
import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const KNOWN_USERS = ['momo', '苞米'];
const SESSION_KEY = 'user_id';

// 应用专属账号（用户指定保留的本地登录方式）
const LOCAL_ACCOUNTS = { momo: '20260225', '苞米': '20260225' };

/**
 * 昵称 + 密码登录
 * @returns {Promise<{username: string}>}
 * @throws {Error} message 为用户可读中文
 */
export async function signIn(nickname, password) {
  const name = String(nickname || '').trim();
  const pass = String(password || '');
  if (!name || !pass) throw new Error('请输入昵称和密码');
  if (!KNOWN_USERS.includes(name)) throw new Error('昵称或密码错误，请重新输入');

  // 校验在本地完成；耗时操作保持 async 以便未来无痛切换到服务端认证
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (LOCAL_ACCOUNTS[name] !== pass) {
    throw new Error('昵称或密码错误，请重新输入');
  }

  await AsyncStorage.setItem(SESSION_KEY, name);
  return { username: name };
}

/**
 * 启动会话恢复。返回 { username } 或 null（未登录）。
 */
export async function restoreSession() {
  try {
    const stored = await AsyncStorage.getItem(SESSION_KEY);
    if (KNOWN_USERS.includes(stored)) return { username: stored };
  } catch (e) {
    // 读取失败按未登录处理
  }
  return null;
}

/**
 * 退出登录：清理本地会话；若存在 Supabase Auth 会话也一并清掉。
 */
export async function signOutSupabase() {
  await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
  try {
    await supabase.auth.signOut();
  } catch (e) {
    // 无网络或无会话时忽略
  }
}
