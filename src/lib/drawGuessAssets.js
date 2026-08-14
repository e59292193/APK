// ═══════════════════════════════════════════════════════
// drawGuessAssets —— 画作导出 / 画廊 / 自定义词库 数据层
//
// 优化点：
//   1. 光栅化固定为 480×480，而不是跟着屏幕宽度走。
//      原来在大屏手机上是 ~1100×1100（纯 JS 逐像素盖圆点），
//      像素量是现在的 5 倍以上，保存一次要卡好几秒。
//   2. 上传统一走 ArrayBuffer，RN 环境最稳。
//   3. 保存前先查同一局同一轮是否已存过，避免双方各存一张重复画作。
// ═══════════════════════════════════════════════════════
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { strokesToPNG } from './drawGuessPng';

export const PNG_SIZE = 480;
export const BUCKET = 'photos';

function scaleStrokes(strokes, scale) {
  return (strokes || []).map((s) => ({
    color: s.color,
    isEraser: !!s.isEraser,
    width: Math.max(1, (s.width || 3) * scale),
    points: (s.points || []).map((p) => ({ x: p.x * scale, y: p.y * scale })),
  }));
}

function toArrayBuffer(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

// ─── 画作 → PNG → Storage ───
export async function uploadDrawing({ gameId, round, strokes, canvasSize }) {
  const scale = PNG_SIZE / Math.max(1, canvasSize || PNG_SIZE);
  const bytes = strokesToPNG(scaleStrokes(strokes, scale), PNG_SIZE, PNG_SIZE);
  const path = 'drawguess/dg_' + gameId + '_r' + round + '_' + Date.now() + '.png';

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, toArrayBuffer(bytes), {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: true,
    });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, publicUrl: data && data.publicUrl };
}

/**
 * 保存一轮画作到画廊。
 * @returns {Promise<{saved: boolean, reason?: string, row?: object}>}
 */
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
  if (!gameId || !strokes || strokes.length === 0) {
    return { saved: false, reason: '画布还是空的' };
  }

  // 同一局同一轮只存一张（双方都点保存也不会重复）
  const { data: exists, error: findError } = await fetchWithTimeout(() =>
    supabase
      .from('drawguess_gallery')
      .select('id')
      .eq('game_id', gameId)
      .eq('round', round)
      .limit(1)
  );
  if (findError) throw findError;
  if (exists && exists.length > 0) {
    return { saved: false, reason: '这一轮的画已经在画廊里了' };
  }

  const { publicUrl } = await uploadDrawing({ gameId, round, strokes, canvasSize });
  if (!publicUrl) throw new Error('未能获取图片地址');

  const { data, error } = await fetchWithTimeout(() =>
    supabase
      .from('drawguess_gallery')
      .insert([
        {
          game_id: gameId,
          drawer_id: drawerId,
          guesser_id: guesserId,
          word: word || '未知题目',
          image_url: publicUrl,
          result: result || 'timeout',
          duration_sec: durationSec != null ? durationSec : null,
          round: round || null,
        },
      ])
      .select()
  );
  if (error) throw error;
  return { saved: true, row: data && data[0] };
}

export async function deleteGalleryItem(item) {
  if (!item || !item.id) return;
  const { error } = await fetchWithTimeout(() =>
    supabase.from('drawguess_gallery').delete().eq('id', item.id)
  );
  if (error) throw error;

  // 顺手清掉 Storage 里的文件（失败不影响主流程）
  try {
    const url = item.image_url || '';
    const marker = '/' + BUCKET + '/';
    const index = url.indexOf(marker);
    if (index >= 0) {
      const path = decodeURIComponent(url.slice(index + marker.length).split('?')[0]);
      await supabase.storage.from(BUCKET).remove([path]);
    }
  } catch (e) {
    console.warn('[DGAssets] 删除图片文件失败（记录已删除）:', e.message);
  }
}

// ─── 自定义词库 ───
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
