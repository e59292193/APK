import { THEMES, THEME_IDS, DEFAULT_THEME } from '../../theme/themes';
import { colors } from '../../theme/colors';
import { setActiveThemeSync, getActiveTheme } from '../../theme/ThemeContext';

describe('Theme System', () => {
  test('all 4 required themes exist with complete metadata', () => {
    const themeIds = Object.keys(THEMES);
    expect(themeIds).toContain('lavender');
    expect(themeIds).toContain('mint');
    expect(themeIds).toContain('peach');
    expect(themeIds).toContain('sky');

    themeIds.forEach((id) => {
      const t = THEMES[id];
      expect(t.id).toBe(id);
      expect(t.name).toBeTruthy();
      expect(t.previewPrimary).toBeTruthy();
      expect(t.previewSecondary).toBeTruthy();
      expect(t.colors).toBeDefined();
    });
  });

  test('fallback to DEFAULT_THEME when given invalid theme id', () => {
    const result = setActiveThemeSync('non_existent_theme');
    expect(result.id).toBe(DEFAULT_THEME.id);
    expect(getActiveTheme().id).toBe(DEFAULT_THEME.id);
  });

  test('all themes have parity across core color token keys', () => {
    const defaultColorKeys = Object.keys(DEFAULT_THEME.colors);

    Object.keys(THEMES).forEach((id) => {
      const themeColors = THEMES[id].colors;
      expect(themeColors.primaryAction).toBeDefined();
      expect(themeColors.background).toBeDefined();
      expect(themeColors.surface).toBeDefined();
      expect(themeColors.textPrimary).toBeDefined();
      expect(themeColors.textSecondary).toBeDefined();

      // Ensure key scales exist
      expect(themeColors.primary).toBeDefined();
      expect(themeColors.primary[500]).toBeDefined();

      // Ensure zero missing keys from default theme
      defaultColorKeys.forEach((key) => {
        expect(themeColors[key]).toBeDefined();
      });
    });
  });

  test('colors proxy dynamically updates when active theme colors change', () => {
    // Switch to mint
    setActiveThemeSync(THEME_IDS.MINT);
    expect(colors.primaryAction).toBe(THEMES.mint.colors.primaryAction);

    // Switch to peach
    setActiveThemeSync(THEME_IDS.PEACH);
    expect(colors.primaryAction).toBe(THEMES.peach.colors.primaryAction);

    // Switch to sky
    setActiveThemeSync(THEME_IDS.SKY);
    expect(colors.primaryAction).toBe(THEMES.sky.colors.primaryAction);

    // Switch back to lavender
    setActiveThemeSync(THEME_IDS.LAVENDER);
    expect(colors.primaryAction).toBe(THEMES.lavender.colors.primaryAction);
  });
});
