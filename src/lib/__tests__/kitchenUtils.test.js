jest.mock('../supabase', () => ({ supabase: {} }));

import { getMondayOfWeek, formatWeekRangeDisplay, CATEGORIES, CATEGORY_LABELS, normalizeCategory, getCategoryQueryValues } from '../kitchenUtils';

describe('kitchenUtils 厨房工具测试', () => {
  test('分类常量完整性（含饮品）', () => {
    expect(CATEGORIES.length).toBe(4);
    expect(CATEGORIES.map((category) => category.key)).toEqual(['meat', 'veg', 'snack', 'drink']);
    expect(CATEGORY_LABELS.meat).toBe('荤菜');
    expect(CATEGORY_LABELS.veg).toBe('蔬菜');
    expect(CATEGORY_LABELS.vegetable).toBe('蔬菜');
    expect(CATEGORY_LABELS.snack).toBe('小吃');
    expect(CATEGORY_LABELS.drink).toBe('饮品');
    expect(CATEGORY_LABELS.drinks).toBe('饮品');
    expect(CATEGORY_LABELS.beverage).toBe('饮品');
    expect(CATEGORIES.drink.icon).toBeTruthy();
  });

  test('分类白名单与别名规范化', () => {
    expect(normalizeCategory('drink')).toBe('drink');
    expect(normalizeCategory('drinks')).toBe('drink');
    expect(normalizeCategory('beverage')).toBe('drink');
    expect(normalizeCategory('veg')).toBe('vegetable');
    expect(normalizeCategory('vegetable')).toBe('vegetable');
    expect(normalizeCategory('meat')).toBe('meat');
    expect(normalizeCategory('snack')).toBe('snack');
  });

  test('开发环境未知值先报错再兜底', () => {
    const previous = global.__DEV__;
    global.__DEV__ = true;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(normalizeCategory('dessert')).toBe('meat');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    if (previous === undefined) delete global.__DEV__; else global.__DEV__ = previous;
  });

  test('空值兜底 meat', () => {
    expect(normalizeCategory('')).toBe('meat');
    expect(normalizeCategory(null)).toBe('meat');
    expect(normalizeCategory(undefined)).toBe('meat');
  });

  test('反查同一 DB 值的全部别名', () => {
    expect(getCategoryQueryValues('veg').sort()).toEqual(['veg', 'vegetable']);
    expect(getCategoryQueryValues('vegetable').sort()).toEqual(['veg', 'vegetable']);
    expect(getCategoryQueryValues('drink').sort()).toEqual(['beverage', 'drink', 'drinks']);
    expect(getCategoryQueryValues('meat')).toEqual(['meat']);
    expect(getCategoryQueryValues('snack')).toEqual(['snack']);
  });

  test('自然周周一与显示范围', () => {
    expect(getMondayOfWeek(new Date('2026-09-13T12:00:00Z'))).toBe('2026-09-07');
    expect(getMondayOfWeek(new Date('2026-09-07T08:00:00Z'))).toBe('2026-09-07');
    expect(getMondayOfWeek(new Date('2026-09-09T18:00:00Z'))).toBe('2026-09-07');
    expect(formatWeekRangeDisplay('2026-09-07')).toBe('9月7日 - 9月13日');
    expect(formatWeekRangeDisplay('')).toBe('');
  });
});
