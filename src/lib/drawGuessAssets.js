// 画作导出、画廊与私房词库数据层。
// PNG 固定输出 480×480，避免高分辨率设备在 JS 中逐像素光栅化导致明显卡顿。
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { strokesToPNG } from './drawGuessPng';

export const PNG_SIZE = 480;
export const BUCKET = 'photos';

function scaleStrokes(strokes, scale) {
  return (strokes || []).map((stroke) => ({
    color: stroke.color,
    isEraser: !!stroke.isEraser,
    width: Math.max(1, (stroke.width || 3) * scale),
    points: (stroke.points || []).map((point) => ({
      x: point.x * scale,
      y: point.y * scale,
    })),
  }));
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function removeUploadedPath(path) {
  if (!path) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch (error) {
    console.warn('[DrawGuessAssets] 回滚上传文件失败:', error.message);
  }
}

export async function uploadDrawing({ gameId, round, strokes, canvasSize }) {
  const scale = PNG_SIZE / Math.max(1, canvasSize || PNG_SIZE);
  const bytes = strokesToPNG(scaleStrokes(strokes, scale), PNG_SIZE, PNG_SIZE);
  const path = `drawguess/dg_${gameId}_r${round}_${Date.now()}.png`;

  // 上传不使用自动重试：超时后盲目重试会生成不可追踪的孤儿文件。
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, toArrayBuffer(bytes), {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: true,
    });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = data && data.publicUrl;
  if (!publicUrl) {
    await removeUploadedPath(path);
    throw new Error('未能获取图片地址');
  }
  return { path, publicUrl };
}

export async function saveDrawingToGallery({
  gameId,
  round,
  word,
  strokes,
  canvasSize,
  drawerId,
  guesserId,
  result,
  durationSec,
}) {
  if (!gameId || !round || !strokes || strokes.length === 0) {
    return { saved: false, reason: '画布还是空的' };
  }

  const { data: existingRows, error: findError } = await fetchWithTimeout(() =>
    supabase
      .from('drawguess_gallery')
      .select('*')
      .eq('game_id', gameId)
      .eq('round', round)
      .limit(1)
  );
  if (findError) throw findError;
  if (existingRows && existingRows[0]) {
    return {
      saved: false,
      reason: '这一轮的画已经在画廊里了',
      row: existingRows[0],
    };
  }

  const uploaded = await uploadDrawing({ gameId, round, strokes, canvasSize });
  const record = {
    game_id: gameId,
    drawer_id: drawerId,
    guesser_id: guesserId,
    word: word || '未知题目',
    image_url: uploaded.publicUrl,
    result: result || 'timeout',
    duration_sec: durationSec != null ? durationSec : null,
    round,
  };

  const { data, error } = await fetchWithTimeout(() =>
    supabase.from('drawguess_gallery').insert([record]).select()
  );

  if (error) {
    // 双方同时点保存时，唯一索引只允许一个写入。若这是本次请求在网络超时前
    // 已成功落库，则保留文件并返回成功；若对方先写入，则删除自己的多余上传。
    if (error.code === '23505') {
      const { data: rows } = await supabase
        .from('drawguess_gallery')
        .select('*')
        .eq('game_id', gameId)
        .eq('round', round)
        .limit(1);
      const existing = rows && rows[0];
      if (existing && existing.image_url === uploaded.publicUrl) {
        return { saved: true, row: existing };
      }
      await removeUploadedPath(uploaded.path);
      return {
        saved: false,
        reason: '这一轮的画已经被对方保存了',
        row: existing || null,
      };
    }
    await removeUploadedPath(uploaded.path);
    throw error;
  }

  return { saved: true, row: data && data[0] };
}

export async function deleteGalleryItem(item) {
  if (!item || !item.id) return;
  const { error } = await fetchWithTimeout(() =>
    supabase.from('drawguess_gallery').delete().eq('id', item.id)
  );
  if (error) throw error;

  try {
    const url = item.image_url || '';
    const marker = '/' + BUCKET + '/';
    const index = url.indexOf(marker);
    if (index >= 0) {
      const path = decodeURIComponent(url.slice(index + marker.length).split('?')[0]);
      await removeUploadedPath(path);
    }
  } catch (cleanupError) {
    console.warn('[DrawGuessAssets] 记录已删除，但图片文件清理失败:', cleanupError.message);
  }
}

export async function addCustomWord(userId, word) {
  const value = String(word || '').trim();
  if (!userId || !value) return null;
  const { data, error } = await fetchWithTimeout(() =>
    supabase
      .from('drawguess_custom_words')
      .insert([{ user_id: userId, word: value }])
      .select()
  );
  if (error) throw error;
  return data && data[0] ? data[0] : null;
}

export async function deleteCustomWord(id) {
  if (!id) return;
  const { error } = await fetchWithTimeout(() =>
    supabase.from('drawguess_custom_words').delete().eq('id', id)
  );
  if (error) throw error;
}
