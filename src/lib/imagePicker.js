// ═══════════════════════════════════════════════════════
// 全局统一相册与图片选取工具 (imagePicker.js - 功能5)
// 移除固定比例限制，支持自由比例裁剪与高质量压缩
// ═══════════════════════════════════════════════════════

import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

/**
 * 从系统相册中选取图片（自由比例裁剪或不裁剪）
 * @param {object} options
 * @param {boolean} [options.allowsEditing=true] - 是否启用裁剪（无 aspect，自由尺寸）
 * @param {number} [options.quality=0.8] - 图片质量 0~1
 * @param {boolean} [options.allowsMultipleSelection=false] - 是否多选
 * @param {number} [options.selectionLimit=1] - 最大多选数量
 * @returns {Promise<ImagePicker.ImagePickerAsset[] | null>} 选取结果数组，取消则返回 null
 */
export async function pickImage(options = {}) {
  const {
    allowsEditing = true,
    quality = 0.8,
    allowsMultipleSelection = false,
    selectionLimit = 1,
  } = options;

  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('提示', '需要相册访问权限才能选取图片哦');
    return null;
  }

  const pickerConfig = {
    mediaTypes: ['images'],
    allowsEditing: allowsEditing,
    // 【重要修复】：移除 aspect 参数，让用户自由裁剪，不再强制任何固定比例
    quality,
    allowsMultipleSelection,
    selectionLimit: allowsMultipleSelection ? selectionLimit : 1,
  };

  const result = await ImagePicker.launchImageLibraryAsync(pickerConfig);

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  return result.assets;
}

/**
 * 选取单张图片并返回其本地 URI
 * @param {object} options
 * @returns {Promise<string | null>}
 */
export async function pickSingleImageUri(options = {}) {
  const assets = await pickImage({ ...options, allowsMultipleSelection: false });
  if (!assets || assets.length === 0) return null;
  return assets[0].uri;
}
