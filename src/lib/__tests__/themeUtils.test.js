import { themes, THEMES, THEME_IDS, DEFAULT_THEME } from '../../theme/themes';
import { colors } from '../../theme/colors';
import { setActiveThemeSync, getActiveTheme } from '../../theme/ThemeContext';

describe('Theme System', () => {
  test('all required themes exist with complete metadata', () => {
    const requiredThemeIds = ['default', 'lavender', 'sakura', 'midnight', 'matcha', 'galaxy', 'minimal'];
    const themeIds = Object.keys(themes);

    requiredThemeIds.forEach((id) => {
      expect(themeIds).toContain(id);
      const t = themes[id];
      expect(t.id).toBe(id);
      expect(t.name).toBeTruthy();
      expect(t.emoji).toBeTruthy();
      expect(t.colors).toBeDefined();

      // Check required 7 core tokens
      expect(t.colors.primary).toBeTruthy();
      expect(t.colors.background).toBeTruthy();
      expect(t.colors.card).toBeTruthy();
      expect(t.colors.text).toBeTruthy();
      expect(t.colors.textSecondary).toBeTruthy();
      expect(t.colors.accent).toBeTruthy();
      expect(t.colors.border).toBeTruthy();
    });
  });

  test('fallback to DEFAULT_THEME when given invalid theme id', () => {
    const result = setActiveThemeSync('non_existent_theme');
    expect(result.id).toBe(DEFAULT_THEME.id);
    expect(getActiveTheme().id).toBe(DEFAULT_THEME.id);
  });

  test('all themes have parity across core color token keys', () => {
    const coreKeys = ['primary', 'background', 'card', 'text', 'textSecondary', 'accent', 'border'];

    Object.keys(themes).forEach((id) => {
      const themeColors = themes[id].colors;
      coreKeys.forEach((key) => {
        expect(themeColors[key]).toBeDefined();
      });
    });
  });

  test('colors proxy dynamically updates when active theme colors change', () => {
    // Switch to lavender
    setActiveThemeSync(THEME_IDS.LAVENDER);
    expect(colors.primary).toBe(themes.lavender.colors.primary);
    expect(colors.background).toBe(themes.lavender.colors.background);

    // Switch to sakura
    setActiveThemeSync(THEME_IDS.SAKURA);
    expect(colors.primary).toBe(themes.sakura.colors.primary);
    expect(colors.background).toBe(themes.sakura.colors.background);

    // Switch to midnight
    setActiveThemeSync(THEME_IDS.MIDNIGHT);
    expect(colors.primary).toBe(themes.midnight.colors.primary);
    expect(colors.background).toBe(themes.midnight.colors.background);

    // Switch to matcha
    setActiveThemeSync(THEME_IDS.MATCHA);
    expect(colors.primary).toBe(themes.matcha.colors.primary);

    // Switch to galaxy
    setActiveThemeSync(THEME_IDS.GALAXY);
    expect(colors.primary).toBe(themes.galaxy.colors.primary);

    // Switch to minimal
    setActiveThemeSync(THEME_IDS.MINIMAL);
    expect(colors.primary).toBe(themes.minimal.colors.primary);

    // Switch back to default
    setActiveThemeSync(THEME_IDS.DEFAULT);
    expect(colors.primary).toBe(themes.default.colors.primary);
  });
});
