jest.mock('../supabase', () => ({ supabase: {} }));

import {
  getMondayOfWeek,
  formatWeekRangeDisplay,
  CATEGORIES,
  CATEGORY_LABELS,
} from '../kitchenUtils';

describe('kitchenUtils 厨房工具测试', () => {
  test('分类常量完整性', () => {
    expect(CATEGORIES.length).toBe(3);
    expect(CATEGORIES.map((c) => c.key)).toEqual(['meat', 'veg', 'snack']);
    expect(CATEGORY_LABELS.meat).toBe('荤菜');
    expect(CATEGORY_LABELS.veg).toBe('蔬菜');
    expect(CATEGORY_LABELS.vegetable).toBe('蔬菜');
    expect(CATEGORY_LABELS.snack).toBe('小吃');
    expect(CATEGORIES.meat).toBeDefined();
    expect(CATEGORIES.veg).toBeDefined();
    expect(CATEGORIES.snack).toBeDefined();
  });

  test('getMondayOfWeek 正确计算自然周周一', () => {
    // 2026-09-13 是周日 (日历中：2026-09-07 是周一，2026-09-13 是周日)
    const sunday = new Date('2026-09-13T12:00:00Z');
    expect(getMondayOfWeek(sunday)).toBe('2026-09-07');

    // 2026-09-07 本身是周一
    const monday = new Date('2026-09-07T08:00:00Z');
    expect(getMondayOfWeek(monday)).toBe('2026-09-07');

    // 2026-09-09 是周三
    const wednesday = new Date('2026-09-09T18:00:00Z');
    expect(getMondayOfWeek(wednesday)).toBe('2026-09-07');
  });

  test('formatWeekRangeDisplay 格式化周菜单范围', () => {
    expect(formatWeekRangeDisplay('2026-09-07')).toBe('9月7日 - 9月13日');
    expect(formatWeekRangeDisplay('')).toBe('');
  });
});
