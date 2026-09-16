// ═══════════════════════════════════════════════════════
// 主题令牌完整性检查 (themeIntegrity.js)
// 确保关键动作色、文本色、背景色在所有主题下均存在安全回退，
// 避免因 token 缺失导致按钮白底白字、透明背景等视觉严重缺陷。
// ═══════════════════════════════════════════════════════

export const CRITICAL_THEME_TOKENS = [
  'primaryAction',
  'primaryActionPressed',
  'textOnPrimary',
  'background',
  'surface',
  'border',
  'textPrimary',
  'textMuted',
];

export const SAFE_FALLBACK_COLORS = {
  primaryAction: '#8B5FC7',
  primaryActionPressed: '#7A4EB6',
  primaryActionDisabled: '#D1C2E8',
  textOnPrimary: '#FFFFFF',
  background: '#FFF8F5',
  surface: '#FFFFFF',
  border: '#FFD6C7',
  textPrimary: '#2D1B00',
  textMuted: '#8B7355',
  card: '#FFFFFF',
  error: '#F05A4F',
};

const warnedThemes = new Set();

/**
 * 校验主题对象的令牌完整性。
 * @param {object} theme - 主题对象 { id, name, colors }
 * @returns {object} 带有安全回退的 colors 对象
 */
export function assertThemeTokens(theme) {
  if (!theme || !theme.colors) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[themeIntegrity] 传入的主题对象缺少 colors 属性，已应用全量安全回退色。');
    }
    return { ...SAFE_FALLBACK_COLORS };
  }

  const colors = theme.colors;
  const missing = [];

  for (const token of CRITICAL_THEME_TOKENS) {
    if (colors[token] === undefined) {
      // 允许别名映射回退
      if (token === 'primaryAction' && colors.primary !== undefined) continue;
      if (token === 'primaryActionPressed' && (colors.primaryPressed !== undefined || colors.primary !== undefined)) continue;
      if (token === 'textPrimary' && colors.text !== undefined) continue;
      if (token === 'textMuted' && colors.textSecondary !== undefined) continue;
      missing.push(token);
    }
  }

  const themeId = theme.id || 'unknown';
  if (missing.length > 0 && typeof __DEV__ !== 'undefined' && __DEV__ && !warnedThemes.has(themeId)) {
    warnedThemes.add(themeId);
    // eslint-disable-next-line no-console
    console.warn(`[themeIntegrity] 主题「${themeId}」缺少关键令牌: ${missing.join(', ')}。已自动注入安全回退值。`);
  }

  return {
    ...SAFE_FALLBACK_COLORS,
    ...colors,
    primaryAction: colors.primaryAction || colors.primary || SAFE_FALLBACK_COLORS.primaryAction,
    primaryActionPressed: colors.primaryActionPressed || colors.primaryPressed || SAFE_FALLBACK_COLORS.primaryActionPressed,
    primaryActionDisabled: colors.primaryActionDisabled || colors.primaryDisabled || SAFE_FALLBACK_COLORS.primaryActionDisabled,
    textOnPrimary: colors.textOnPrimary || SAFE_FALLBACK_COLORS.textOnPrimary,
    textPrimary: colors.textPrimary || colors.text || SAFE_FALLBACK_COLORS.textPrimary,
    textMuted: colors.textMuted || colors.textSecondary || SAFE_FALLBACK_COLORS.textMuted,
  };
}
