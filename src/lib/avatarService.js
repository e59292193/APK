// ═══════════════════════════════════════════════════════
// 头像管理服务 (avatarService.js)
// 管理用户头像与 momi 头像的上传、持久化与实时拉取 (功能4 & 缺陷3 修复)
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

// 使用 Supabase 现有且已放行公开读取的 photos 存储桶（avatars/ 目录隔离）
export const AVATAR_BUCKET = 'photos';
const LOCAL_AVATARS_STORAGE_KEY = '@momo_avatars';

async function getLocalAvatars() {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_AVATARS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

async function saveLocalAvatar(key, url) {
  try {
    const map = await getLocalAvatars();
    map[key] = url;
    await AsyncStorage.setItem(LOCAL_AVATARS_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('[avatarService] 保存本地头像缓存失败:', e.message);
  }
}

/**
 * 批量拉取所有头像（momo, 苞米, momi）
 * @returns {Promise<{ momo: string, '苞米': string, momi: string }>}
 */
export async function fetchAllAvatars() {
  const result = { momo: '', 苞米: '', momi: '' };

  // 1. 先从本地持久化缓存恢复，确保断网或无云端表时瞬间展示
  const localCache = await getLocalAvatars();
  if (localCache.momo) result.momo = localCache.momo;
  if (localCache['苞米']) result['苞米'] = localCache['苞米'];
  if (localCache.momi) result.momi = localCache.momi;

  try {
    // 2. 尝试从云端 user_profiles 表拉取用户头像
    const { data: userProfiles } = await fetchWithTimeout(() =>
      supabase.from('user_profiles').select('user_id, avatar_url')
    ).catch(() => ({ data: [] }));

    if (Array.isArray(userProfiles)) {
      for (const p of userProfiles) {
        if (p.user_id && p.avatar_url) {
          result[p.user_id] = p.avatar_url;
        }
      }
    }

    // 3. 尝试从云端 app_config 表拉取 momi 头像
    const { data: configs } = await fetchWithTimeout(() =>
      supabase.from('app_config').select('key, value').eq('key', 'momi_avatar_url')
    ).catch(() => ({ data: [] }));

    if (Array.isArray(configs) && configs[0] && configs[0].value) {
      result.momi = configs[0].value;
    }
  } catch (err) {
    console.warn('[avatarService] 云端同步头像配置异常 (使用本地缓存兜底):', err.message);
  }

  return result;
}

/**
 * 压缩图片并准备 ArrayBuffer (< 500KB)
 */
async function compressAvatarImage(uri) {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 400 }); // 头像无需超高分辨率，400px 既高清又轻量
  const imageRef = await context.renderAsync();
  const manipulated = await imageRef.saveAsync({
    compress: 0.8,
    format: SaveFormat.JPEG,
  });

  const file = new File(manipulated.uri);
  const arrayBuffer = await file.arrayBuffer();
  return { arrayBuffer, localUri: manipulated.uri };
}

/**
 * 上传用户个人头像
 * @param {string} userId - 'momo' | '苞米'
 * @param {string} localUri - 本地图片 URI
 * @returns {Promise<string>} 上传成功后的 public URL
 */
export async function uploadUserAvatar(userId, localUri) {
  if (!userId || !localUri) throw new Error('缺少参数');

  const { arrayBuffer, localUri: compressedUri } = await compressAvatarImage(localUri);
  const filePath = `avatars/users/${userId}_${Date.now()}.jpg`;
  let publicUrl = compressedUri;

  try {
    const { error: uploadErr } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(filePath, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadErr) {
      console.warn('[avatarService] Storage 上传警告，降级本地存储:', uploadErr.message);
    } else {
      const { data: pubUrlData } = supabase.storage
        .from(AVATAR_BUCKET)
        .getPublicUrl(filePath);

      if (pubUrlData && pubUrlData.publicUrl) {
        publicUrl = pubUrlData.publicUrl;
      }
    }
  } catch (storageErr) {
    console.warn('[avatarService] Storage 网络异常，降级本地存储:', storageErr.message);
  }

  // 1. 本地持久化缓存，确保立即生效且重启不丢
  await saveLocalAvatar(userId, publicUrl);

  // 2. 尝试同步至云端 user_profiles 表（容灾静默）
  try {
    await supabase.from('user_profiles').upsert(
      {
        user_id: userId,
        avatar_url: publicUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  } catch (upsertErr) {
    console.warn('[avatarService] 同步 user_profiles 失败 (已存本地):', upsertErr.message);
  }

  return publicUrl;
}

/**
 * 上传/更换 momi 宠物头像（双方均可更换）
 * @param {string} localUri
 * @returns {Promise<string>}
 */
export async function uploadMomiAvatar(localUri) {
  if (!localUri) throw new Error('缺少图片');

  const { arrayBuffer, localUri: compressedUri } = await compressAvatarImage(localUri);
  const filePath = `avatars/momi/current_${Date.now()}.jpg`;
  let publicUrl = compressedUri;

  try {
    const { error: uploadErr } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(filePath, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadErr) {
      console.warn('[avatarService] Storage 上传警告，降级本地存储:', uploadErr.message);
    } else {
      const { data: pubUrlData } = supabase.storage
        .from(AVATAR_BUCKET)
        .getPublicUrl(filePath);

      if (pubUrlData && pubUrlData.publicUrl) {
        publicUrl = pubUrlData.publicUrl;
      }
    }
  } catch (storageErr) {
    console.warn('[avatarService] Storage 网络异常，降级本地存储:', storageErr.message);
  }

  // 1. 本地持久化缓存
  await saveLocalAvatar('momi', publicUrl);

  // 2. 尝试更新 app_config
  try {
    await supabase.from('app_config').upsert(
      {
        key: 'momi_avatar_url',
        value: publicUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
  } catch (upsertErr) {
    console.warn('[avatarService] 同步 app_config 失败 (已存本地):', upsertErr.message);
  }

  return publicUrl;
}
