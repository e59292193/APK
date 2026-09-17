// ═══════════════════════════════════════════════════════
// 主题令牌完整性校验 (themes.test.js)
// 防止未来新增主题时漏令牌 / 复制遗留 / 回退硬编码阴影
// ═══════════════════════════════════════════════════════

import { themes, resolveThemeId, LEGACY_THEME_ALIASES } from '../themes';

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGBA_RE = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0|1|0?\.\d+)\s*\)$/;

describe('themes 主题令牌完整性', () => {
  const themeIds = Object.keys(themes);
  const baselineKeys = Object.keys(themes.default.colors).sort();

  test('用例1：所有主题的 colors key 全集与 default 完全一致', () => {
    expect(themeIds.length).toBe(7);
    for (const id of themeIds) {
      const keys = Object.keys(themes[id].colors).sort();
      expect(keys).toEqual(baselineKeys);
    }
  });

  test('用例2：每个色值均为合法 hex 或 rgba 字符串', () => {
    for (const id of themeIds) {
      for (const [key, value] of Object.entries(themes[id].colors)) {
        expect(typeof value).toBe('string');
        const valid = HEX_RE.test(value) || RGBA_RE.test(value);
        if (!valid) {
          throw new Error(`主题 ${id} 的令牌 ${key} 色值非法: ${value}`);
        }
        expect(valid).toBe(true);
      }
    }
  });

  test('用例3：任意两套主题的 primary 不相等（防复制遗留）', () => {
    const primaries = themeIds.map((id) => themes[id].colors.primary);
    expect(new Set(primaries).size).toBe(themeIds.length);
  });

  test('用例4：各套主题的 shadow 不全部相等（防回到统一硬编码阴影）', () => {
    const shadows = themeIds.map((id) => themes[id].colors.shadow);
    expect(new Set(shadows).size).toBeGreaterThan(1);
  });

  test('每套主题携带 isDark / statusBarStyle / 预览元数据，且无 backgroundLavender 残留', () => {
    for (const id of themeIds) {
      const t = themes[id];
      expect(typeof t.isDark).toBe('boolean');
      expect(['dark-content', 'light-content']).toContain(t.statusBarStyle);
      expect(t.previewPrimary).toBeTruthy();
      expect(t.previewSecondary).toBeTruthy();
      expect(t.previewBg).toBeTruthy();
      expect(t.emoji).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.subtitle).toBeTruthy();
      expect(t.colors.backgroundLavender).toBeUndefined();
      expect(t.colors.backgroundElevated).toBeTruthy();
    }
    expect(themes.midnight.isDark).toBe(true);
    expect(themes.midnight.statusBarStyle).toBe('light-content');
  });

  test('resolveThemeId：旧别名规范化与未知 key 回退标记', () => {
    expect(resolveThemeId('lavender').id).toBe('lavender');
    for (const [legacy, mapped] of Object.entries(LEGACY_THEME_ALIASES)) {
      const r = resolveThemeId(legacy);
      expect(r.id).toBe(mapped);
      expect(r.wasLegacy).toBe(true);
    }
    const unknown = resolveThemeId('not_a_theme');
    expect(unknown.id).toBe('default');
    expect(unknown.unknown).toBe(true);
    expect(resolveThemeId(null).id).toBe('default');
  });
});
