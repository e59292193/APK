import { Alert, Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import {
  Asset,
  Album,
  getPermissionsAsync,
  requestPermissionsAsync,
} from 'expo-media-library';

function getImageExtension(uri) {
  const cleanUri = String(uri || '').split('?')[0].split('#')[0];
  const match = cleanUri.match(/\.([a-zA-Z0-9]+)$/);
  const ext = match?.[1]?.toLowerCase();
  if (ext === 'png' || ext === 'webp' || ext === 'gif' || ext === 'heic' || ext === 'heif') return ext;
  return 'jpg';
}

async function ensureMediaLibraryPermission() {
  const current = await getPermissionsAsync();
  if (current.granted) return true;

  const requested = await requestPermissionsAsync();
  return requested.granted;
}

async function downloadRemoteImageToCache(uri) {
  const extension = getImageExtension(uri);
  const fileName = `saved_${Date.now()}.${extension}`;
  const destinationFile = new File(Paths.cache, fileName);

  // File.downloadFileAsync throws on non-2xx HTTP status (UnableToDownload error),
  // so no manual status check is needed.
  const downloadedFile = await File.downloadFileAsync(uri, destinationFile, {
    headers: {
      Accept: 'image/*',
    },
    idempotent: true,
  });

  return downloadedFile.uri;
}

export async function saveImageToGallery(uri) {
  if (!uri) {
    Alert.alert('保存失败', '图片地址为空');
    return false;
  }

  try {
    const hasPermission = await ensureMediaLibraryPermission();
    if (!hasPermission) {
      Alert.alert('需要权限', '请允许访问相册后再保存图片');
      return false;
    }

    const localUri = String(uri).startsWith('http')
      ? await downloadRemoteImageToCache(uri)
      : uri;

    // Use the new class-based API: Asset.create() replaces deprecated createAssetAsync.
    const asset = await Asset.create(localUri);

    if (Platform.OS === 'android') {
      try {
        // Album.get() replaces deprecated getAlbumAsync.
        let album = await Album.get('Download');
        if (!album) {
          // Album.create() replaces deprecated createAlbumAsync.
          // Pass false for moveAssets so the asset is copied, not moved.
          album = await Album.create('Download', [asset], false);
        } else {
          // album.add() replaces deprecated addAssetsToAlbumAsync.
          await album.add(asset);
        }
      } catch (albumError) {
        console.warn('Saved image but could not add to Download album:', albumError);
      }
    }

    Alert.alert('保存成功', '图片已保存到相册');
    return true;
  } catch (error) {
    console.error('Save image error:', error);
    Alert.alert('保存失败', error?.message || '请检查相册权限后重试');
    return false;
  }
}

export default saveImageToGallery;
