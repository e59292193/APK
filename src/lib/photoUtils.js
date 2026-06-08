import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Pick an image from the gallery, upload to Supabase Storage, return public URL.
 * @param {object} options - Optional overrides
 * @param {number} options.quality - Image quality 0-1 (default 0.7)
 * @param {number} options.maxWidth - Max width in pixels (default 1024)
 * @param {number} options.maxHeight - Max height in pixels (default 1024)
 * @returns {Promise<string|null>} - The public URL of the uploaded image, or null if cancelled
 */
export async function pickAndUploadImage(options = {}) {
  const {
    quality = 0.7,
    maxWidth = 1024,
    maxHeight = 1024,
  } = options;

  // Request permission
  if (Platform.OS !== 'web') {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('需要相册权限才能上传图片');
    }
  }

  // Launch image picker
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [4, 3],
    quality,
    allowsMultipleSelection: false,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  const uri = asset.uri;

  // Convert to Blob
  let blob;
  if (Platform.OS === 'web') {
    // On web, fetch the URI to get a Blob
    const response = await fetch(uri);
    blob = await response.blob();
  } else {
    // On native, use XMLHttpRequest to convert URI to blob
    blob = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => resolve(xhr.response);
      xhr.onerror = () => reject(new Error('Failed to read image file'));
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send(null);
    });
  }

  // Generate unique filename
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const ext = uri.split('.').pop() || 'jpg';
  const fileName = `photo_${timestamp}_${randomStr}.${ext}`;
  const filePath = `uploads/${fileName}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(filePath, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: false,
    });

  if (uploadError) {
    console.error('Upload error:', uploadError);
    throw new Error('图片上传失败，请重试');
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('photos')
    .getPublicUrl(filePath);

  if (!urlData || !urlData.publicUrl) {
    throw new Error('获取图片链接失败');
  }

  return urlData.publicUrl;
}