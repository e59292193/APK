// ═══════════════════════════════════════════════════════
// momi厨房 (Momi Kitchen) 业务工具函数
// 涵盖分类定义、自然周计算、菜品 CRUD、周清单操作与图片上传
// ═══════════════════════════════════════════════════════

import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';

export const KITCHEN_BUCKET = 'kitchen-images';

const CATEGORY_ARRAY = [
  { key: 'meat', label: '荤菜', icon: '🥩', ionicon: 'nutrition-outline' },
  { key: 'veg', label: '蔬菜', icon: '🥗', ionicon: 'leaf-outline' },
  { key: 'snack', label: '小吃', icon: '🥟', ionicon: 'pizza-outline' },
];

export const CATEGORIES = Object.assign([...CATEGORY_ARRAY], {
  meat: CATEGORY_ARRAY[0],
  veg: CATEGORY_ARRAY[1],
  vegetable: CATEGORY_ARRAY[1],
  snack: CATEGORY_ARRAY[2],
});

export const CATEGORY_LABELS = {
  meat: '荤菜',
  veg: '蔬菜',
  vegetable: '蔬菜',
  snack: '小吃',
};

/**
 * 获取某个日期所在自然周的周一日期字符串（YYYY-MM-DD）
 * 自然周以周一为起点
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} 'YYYY-MM-DD'
 */
export function getMondayOfWeek(date = new Date()) {
  const d = new Date(date);
  // getDay(): 0 是周日，1-6 是周一到周六
  const day = d.getDay();
  // 距离本周一相差的天数
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));

  const year = monday.getFullYear();
  const month = String(monday.getMonth() + 1).padStart(2, '0');
  const dateNum = String(monday.getDate()).padStart(2, '0');
  return `${year}-${month}-${dateNum}`;
}

/**
 * 格式化周菜单时间范围显示，例如 "9月8日 - 9月14日"
 * @param {string} mondayStr 'YYYY-MM-DD'
 * @returns {string}
 */
export function formatWeekRangeDisplay(mondayStr) {
  if (!mondayStr) return '';
  const [y, m, d] = mondayStr.split('-').map(Number);
  const monday = new Date(y, m - 1, d);
  const sunday = new Date(y, m - 1, d + 6);

  const mMonth = monday.getMonth() + 1;
  const mDate = monday.getDate();
  const sMonth = sunday.getMonth() + 1;
  const sDate = sunday.getDate();

  return `${mMonth}月${mDate}日 - ${sMonth}月${sDate}日`;
}

/**
 * 压缩并上传菜品图片至 kitchen-images 存储桶
 * @param {string} uri 本地图片 URI
 * @param {object} [options]
 * @returns {Promise<string>} 返回 Storage 存储路径
 */
export async function uploadKitchenImage(uri, options = {}) {
  const { maxWidth = 1080, quality = 0.6 } = options;
  const { ImageManipulator, SaveFormat } = require('expo-image-manipulator');
  const { File } = require('expo-file-system');
  const FileSystemLegacy = require('expo-file-system/legacy');

  let workUri = uri;
  // If Android content:// URI, copy to local cache directory first to guarantee file access
  if (uri && uri.startsWith('content://')) {
    try {
      const cacheDir = FileSystemLegacy.cacheDirectory || '';
      const tempPath = `${cacheDir}dish_temp_${Date.now()}.jpg`;
      await FileSystemLegacy.copyAsync({ from: uri, to: tempPath });
      workUri = tempPath;
    } catch (copyErr) {
      console.warn('[uploadKitchenImage] copyAsync warning, using original URI:', copyErr);
    }
  }

  let arrayBuffer = null;
  let contentType = 'image/jpeg';

  // 1. Attempt compression with ImageManipulator
  try {
    const context = ImageManipulator.manipulate(workUri);
    context.resize({ width: maxWidth });
    const imageRef = await context.renderAsync();
    const manipulated = await imageRef.saveAsync({
      compress: quality,
      format: SaveFormat.JPEG,
    });
    const compressedFile = new File(manipulated.uri);
    arrayBuffer = await compressedFile.arrayBuffer();
  } catch (manipErr) {
    console.warn('[uploadKitchenImage] ImageManipulator failed, falling back to direct byte read:', manipErr);
    // 2. Resilient fallback: read file bytes directly
    try {
      const fallbackFile = new File(workUri);
      arrayBuffer = await fallbackFile.arrayBuffer();
    } catch (fErr) {
      const resp = await fetch(uri);
      arrayBuffer = await resp.arrayBuffer();
    }
  }

  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const fileName = `dish_${timestamp}_${randomStr}.jpg`;
  const filePath = `uploads/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from(KITCHEN_BUCKET)
    .upload(filePath, arrayBuffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error('菜品图片上传失败: ' + uploadError.message);
  }

  return filePath;
}

/**
 * 拉取菜品列表
 * @param {string} [category] 分类筛选 (可选，如果传入 'momo_and_baomi' 等 coupleId 则作为 coupleId 查询全部)
 * @param {string} [coupleId='momo_and_baomi']
 */
export async function fetchDishes(category, coupleId = 'momo_and_baomi') {
  let targetCategory = category;
  let targetCoupleId = coupleId;

  // 容错：当第一个参数是 coupleId (例如 'momo_and_baomi' 或包含下划线) 时，查询该情侣全部菜品
  if (category && (category === 'momo_and_baomi' || category.includes('_'))) {
    targetCoupleId = category;
    targetCategory = null;
  }

  const res = await fetchWithTimeout(() => {
    let query = supabase
      .from('kitchen_dishes')
      .select('*')
      .eq('couple_id', targetCoupleId)
      .order('created_at', { ascending: false });

    if (targetCategory) {
      if (targetCategory === 'veg' || targetCategory === 'vegetable') {
        query = query.in('category', ['veg', 'vegetable']);
      } else {
        query = query.eq('category', targetCategory);
      }
    }
    return query;
  });
  if (res && res.error) throw res.error;
  return (res && res.data) || (Array.isArray(res) ? res : []);
}

/**
 * 创建或更新菜品
 */
export async function saveDish(dishData, dishId, userId) {
  const targetId = dishData?.id || dishId;
  const isEdit = Boolean(targetId);
  const now = new Date().toISOString();

  // 数据库 check 约束要求 ('meat', 'vegetable', 'snack')，将前端简写 'veg' 统一规范化为 'vegetable'
  const normalizeCategory = (cat) => {
    if (!cat) return 'meat';
    if (cat === 'veg' || cat === 'vegetable') return 'vegetable';
    if (cat === 'snack') return 'snack';
    return 'meat';
  };

  if (isEdit) {
    const { id: _unused, ...updates } = dishData;
    if (updates.category) {
      updates.category = normalizeCategory(updates.category);
    }
    updates.updated_at = now;
    const res = await fetchWithTimeout(() =>
      supabase.from('kitchen_dishes').update(updates).eq('id', targetId).select()
    );
    if (res && res.error) throw res.error;
    return (Array.isArray(res?.data) ? res.data[0] : res?.data) || { id: targetId, ...dishData };
  }

  const payload = {
    ...dishData,
    category: normalizeCategory(dishData?.category),
    couple_id: dishData.couple_id || 'momo_and_baomi',
    created_by: dishData.created_by || userId || 'momo',
    created_at: now,
    updated_at: now,
  };
  // 确保新增时不传递任何 id 字段（避免传入 null/undefined 破坏 Postgres gen_random_uuid 默认值）
  delete payload.id;

  const res = await fetchWithTimeout(() =>
    supabase.from('kitchen_dishes').insert([payload]).select()
  );
  if (res && res.error) throw res.error;
  return (Array.isArray(res?.data) ? res.data[0] : res?.data) || payload;
}

/**
 * 删除菜品（级联删除周清单）
 */
export async function deleteDish(id) {
  const res = await fetchWithTimeout(() =>
    supabase.from('kitchen_dishes').delete().eq('id', id)
  );
  if (res && res.error) throw res.error;
  return res;
}

/**
 * 拉取本周清单
 * @param {string} weekStart 'YYYY-MM-DD'
 * @param {string} [coupleId='momo_and_baomi']
 */
export async function fetchWeeklyPicks(weekStart, coupleId = 'momo_and_baomi') {
  const res = await fetchWithTimeout(() =>
    supabase
      .from('kitchen_weekly_picks')
      .select(`
        id,
        couple_id,
        dish_id,
        picked_by,
        week_start,
        created_at,
        dish:kitchen_dishes(*)
      `)
      .eq('couple_id', coupleId)
      .eq('week_start', weekStart)
      .order('created_at', { ascending: true })
  );
  if (res && res.error) throw res.error;
  return (res && res.data) || (Array.isArray(res) ? res : []);
}

/**
 * 加入本周清单
 */
export async function addWeeklyPick(dishId, pickedBy, weekStart, coupleId = 'momo_and_baomi') {
  return fetchWithTimeout(() =>
    supabase
      .from('kitchen_weekly_picks')
      .insert([
        {
          couple_id: coupleId,
          dish_id: dishId,
          picked_by: pickedBy,
          week_start: weekStart,
        },
      ])
      .select()
  );
}

/**
 * 移除本周清单中的菜品
 */
export async function removeWeeklyPick(dishId, weekStart, coupleId = 'momo_and_baomi') {
  return fetchWithTimeout(() =>
    supabase
      .from('kitchen_weekly_picks')
      .delete()
      .eq('couple_id', coupleId)
      .eq('dish_id', dishId)
      .eq('week_start', weekStart)
  );
}

/**
 * 清空本周清单
 */
export async function clearWeeklyPicks(weekStart, coupleId = 'momo_and_baomi') {
  return fetchWithTimeout(() =>
    supabase
      .from('kitchen_weekly_picks')
      .delete()
      .eq('couple_id', coupleId)
      .eq('week_start', weekStart)
  );
}

/**
 * 切换菜品的本周想吃状态 (toggle)
 * @param {object} params - { dishId, weekStart, userId, coupleId }
 * @returns {Promise<{ action: 'picked' | 'unpicked' }>}
 */
export async function toggleWeeklyPick({ dishId, weekStart, userId, coupleId = 'momo_and_baomi' }) {
  const res = await fetchWithTimeout(() =>
    supabase
      .from('kitchen_weekly_picks')
      .select('id')
      .eq('couple_id', coupleId)
      .eq('dish_id', dishId)
      .eq('week_start', weekStart)
  );

  const existing = (res && res.data) || (Array.isArray(res) ? res : []);

  if (existing && existing.length > 0) {
    await removeWeeklyPick(dishId, weekStart, coupleId);
    return { action: 'unpicked' };
  } else {
    await addWeeklyPick(dishId, userId, weekStart, coupleId);
    return { action: 'picked' };
  }
}
