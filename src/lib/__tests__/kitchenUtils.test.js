jest.mock('../supabase', () => ({ supabase: {} }));

import {
  getMondayOfWeek,
  formatWeekRangeDisplay,
  CATEGORIES,
  CATEGORY_LABELS,
  normalizeCategory,
  getCategoryQueryValues,
} from '../kitchenUtils';

describe('kitchenUtils 厨房工具测试', () => {
  test('分类常量完整性（含饮品）', () => {
    expect(CATEGORIES.length).toBe(4);
    expect(CATEGORIES.map((c) => c.key)).toEqual(['meat', 'veg', 'snack', 'drink']);
    expect(CATEGORY_LABELS.meat).toBe('荤菜');
    expect(CATEGORY_LABELS.veg).toBe('蔬菜');
    expect(CATEGORY_LABELS.vegetable).toBe('蔬菜');
    expect(CATEGORY_LABELS.snack).toBe('小吃');
    expect(CATEGORY_LABELS.drink).toBe('饮品');
    expect(CATEGORY_LABELS.drinks).toBe('饮品');
    expect(CATEGORY_LABELS.beverage).toBe('饮品');
    expect(CATEGORIES.meat).toBeDefined();
    expect(CATEGORIES.veg).toBeDefined();
    expect(CATEGORIES.snack).toBeDefined();
    expect(CATEGORIES.drink).toBeDefined();
    expect(CATEGORIES.drink.icon).toBeTruthy();
  });

  test('normalizeCategory 白名单：drink/drinks/beverage 全部映射到 drink', () => {
    expect(normalizeCategory('drink')).toBe('drink');
    expect(normalizeCategory('drinks')).toBe('drink');
    expect(normalizeCategory('beverage')).toBe('drink');
  });

  test('normalizeCategory 白名单：veg/vegetable 映射到 vegetable', () => {
    expect(normalizeCategory('veg')).toBe('vegetable');
    expect(normalizeCategory('vegetable')).toBe('vegetable');
    expect(normalizeCategory('meat')).toBe('meat');
    expect(normalizeCategory('snack')).toBe('snack');
  });

  test('normalizeCategory：未知值先报错再兜底（绝不静默转成 meat）', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(normalizeCategory('dessert')).toBe('meat'); // 最后兜底
    expect(errSpy).toHaveBeenCalled(); // 但必须先报错提醒注册
    errSpy.mockRestore();
  });

  test('normalizeCategory：空值兜底 meat（不报错）', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(normalizeCategory('')).toBe('meat');
    expect(normalizeCategory(null)).toBe('meat');
    expect(normalizeCategory(undefined)).toBe('meat');
    errSpy.mockRestore();
  });

  test('getCategoryQueryValues：反查同一 DB 值的全部别名', () => {
    expect(getCategoryQueryValues('veg').sort()).toEqual(['veg', 'vegetable']);
    expect(getCategoryQueryValues('vegetable').sort()).toEqual(['veg', 'vegetable']);
    expect(getCategoryQueryValues('drink').sort()).toEqual(['beverage', 'drink', 'drinks']);
    expect(getCategoryQueryValues('meat')).toEqual(['meat']);
    expect(getCategoryQueryValues('snack')).toEqual(['snack']);
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
