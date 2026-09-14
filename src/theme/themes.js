// ═══════════════════════════════════════════════════════
// MOMO Corn 清新多主题注册表 (themes.js)
// 包含 6 套核心主题，统一定义为 themes 对象。
// ═══════════════════════════════════════════════════════

export const THEME_IDS = {
  DEFAULT: 'default',
  LAVENDER: 'lavender',
  SAKURA: 'sakura',
  MIDNIGHT: 'midnight',
  MATCHA: 'matcha',
  GALAXY: 'galaxy',
  MINIMAL: 'minimal',
  // 存量兼容
  MINT: 'matcha',
  PEACH: 'sakura',
  SKY: 'galaxy',
};

function createThemeColors(spec) {
  const {
    primary,
    background,
    card,
    text,
    textSecondary,
    accent,
    border,
    isDark = false,
  } = spec;

  return {
    // 规范核心 7 个属性
    primary,
    background,
    card,
    text,
    textSecondary,
    accent,
    border,

    // 语义兼容令牌
    surface: card,
    textPrimary: text,
    textMuted: textSecondary,
    textDisabled: border,
    borderStrong: border,
    primaryAction: primary,
    primaryActionPressed: primary,
    primaryActionDisabled: border,
    primarySoft: background,
    me: primary,
    meSoft: background,
    partner: accent,
    partnerSoft: background,
    backgroundLavender: background,
    surfaceSoft: card,
    success: '#52C41A',
    warning: '#FAAD14',
    error: '#FF4D4F',
    errorSoft: isDark ? '#3E1C24' : '#FFF1F0',
    overlay: isDark ? 'rgba(0, 0, 0, 0.72)' : 'rgba(0, 0, 0, 0.42)',
    shadow: isDark ? '#000000' : '#4A365D',
  };
}

export const themes = {
  default: {
    id: 'default',
    name: '暖橙',
    emoji: '☀️',
    subtitle: '温暖阳光 · 活力橙',
    statusBarStyle: 'dark-content',
    previewPrimary: '#FF6B35',
    previewSecondary: '#FF8C5A',
    previewBg: '#FFF8F5',
    colors: createThemeColors({
      primary: '#FF6B35',
      background: '#FFF8F5',
      card: '#FFFFFF',
      text: '#2D1B00',
      textSecondary: '#8B7355',
      accent: '#FF8C5A',
      border: '#FFD6C7',
    }),
  },

  lavender: {
    id: 'lavender',
    name: '薰衣草物语',
    emoji: '💜',
    subtitle: '温柔梦幻 · 经典紫',
    statusBarStyle: 'dark-content',
    previewPrimary: '#8C69CA',
    previewSecondary: '#69B79B',
    previewBg: '#F8F5FF',
    colors: createThemeColors({
      primary: '#8C69CA',
      background: '#FAF9FC',
      card: '#FFFFFF',
      text: '#27222F',
      textSecondary: '#706879',
      accent: '#69B79B',
      border: '#EAE5EF',
    }),
  },

  sakura: {
    id: 'sakura',
    name: '樱花粉',
    emoji: '🌸',
    subtitle: '春日浪漫 · 甜心粉',
    statusBarStyle: 'dark-content',
    previewPrimary: '#FFB7C5',
    previewSecondary: '#FF8FA3',
    previewBg: '#FFF0F5',
    colors: createThemeColors({
      primary: '#FFB7C5',
      background: '#FFF0F5',
      card: '#FFFFFF',
      text: '#4A2C3A',
      textSecondary: '#9B6B7A',
      accent: '#FF8FA3',
      border: '#FFD6E0',
    }),
  },

  midnight: {
    id: 'midnight',
    name: '深夜蓝',
    emoji: '🌙',
    subtitle: '星河寂静 · 极客暗黑',
    statusBarStyle: 'light-content',
    previewPrimary: '#E94560',
    previewSecondary: '#E94560',
    previewBg: '#1A1A2E',
    colors: createThemeColors({
      primary: '#E94560',
      background: '#1A1A2E',
      card: '#16213E',
      text: '#EAEAEA',
      textSecondary: '#A0A0B0',
      accent: '#E94560',
      border: '#0F3460',
      isDark: true,
    }),
  },

  matcha: {
    id: 'matcha',
    name: '抹茶绿',
    emoji: '🍃',
    subtitle: '清新舒缓 · 自然绿',
    statusBarStyle: 'dark-content',
    previewPrimary: '#5B9B6F',
    previewSecondary: '#A8D5A2',
    previewBg: '#F0FFF4',
    colors: createThemeColors({
      primary: '#5B9B6F',
      background: '#F0FFF4',
      card: '#FFFFFF',
      text: '#1A3A2A',
      textSecondary: '#5A7A65',
      accent: '#A8D5A2',
      border: '#C8E6C9',
    }),
  },

  galaxy: {
    id: 'galaxy',
    name: '星空紫',
    emoji: '🌌',
    subtitle: '深邃梦幻 · 宇宙紫',
    statusBarStyle: 'dark-content',
    previewPrimary: '#6C63FF',
    previewSecondary: '#A89CFF',
    previewBg: '#F5F3FF',
    colors: createThemeColors({
      primary: '#6C63FF',
      background: '#F5F3FF',
      card: '#FFFFFF',
      text: '#2D1B6E',
      textSecondary: '#7B6FA0',
      accent: '#A89CFF',
      border: '#E0DBFF',
    }),
  },

  minimal: {
    id: 'minimal',
    name: '极简白',
    emoji: '🤍',
    subtitle: '克制优雅 · 黑白极简',
    statusBarStyle: 'dark-content',
    previewPrimary: '#222222',
    previewSecondary: '#444444',
    previewBg: '#FFFFFF',
    colors: createThemeColors({
      primary: '#222222',
      background: '#FFFFFF',
      card: '#F7F7F7',
      text: '#111111',
      textSecondary: '#888888',
      accent: '#444444',
      border: '#E5E5E5',
    }),
  },
};

// 兼容别名导出
export const THEMES = themes;
export const DEFAULT_THEME = themes.default;
export const THEME_LIST = Object.values(themes);

export default themes;
