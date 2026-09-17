import { themes, THEME_IDS, DEFAULT_THEME } from '../../theme/themes';
import { colors } from '../../theme/colors';
import { setActiveThemeSync, getActiveTheme } from '../../theme/ThemeContext';

describe('Theme System', () => {
  test('all required themes exist with complete metadata', () => {
    const required = ['default', 'lavender', 'sakura', 'midnight', 'matcha', 'galaxy', 'minimal'];
    required.forEach((id) => {
      const theme = themes[id];
      expect(theme.id).toBe(id); expect(theme.name).toBeTruthy(); expect(theme.emoji).toBeTruthy();
      ['primary', 'background', 'card', 'text', 'textSecondary', 'accent', 'border'].forEach((key) => expect(theme.colors[key]).toBeDefined());
    });
  });
  test('invalid id falls back to DEFAULT_THEME', () => {
    expect(setActiveThemeSync('non_existent_theme').id).toBe(DEFAULT_THEME.id);
    expect(getActiveTheme().id).toBe(DEFAULT_THEME.id);
  });
  test('colors proxy updates with active theme', () => {
    [THEME_IDS.LAVENDER, THEME_IDS.SAKURA, THEME_IDS.MIDNIGHT, THEME_IDS.MATCHA, THEME_IDS.GALAXY, THEME_IDS.MINIMAL, THEME_IDS.DEFAULT].forEach((id) => {
      setActiveThemeSync(id); expect(colors.primary).toBe(themes[id].colors.primary); expect(colors.background).toBe(themes[id].colors.background);
    });
  });
});
