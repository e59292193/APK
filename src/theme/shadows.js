// Shadow tokens. iOS shadow* + Android elevation kept in sync.
// shadowColor 运行时取当前主题 colors.shadow —— 浅色主题不再是统一紫色阴影。
//
// 用法：
//   旧代码直接展开 shadows.card 也能得到跟随主题的 shadowColor（getter 实时求值）；
//   新代码推荐在工厂样式里用 themedShadow('card', colors) 显式取色。

import { getActiveTheme } from './ThemeContext';

function currentShadowColor() {
  const t = getActiveTheme();
  return (t && t.colors && t.colors.shadow) || '#000000';
}

function makeLevel(offsetY, opacity, radius, elevation) {
  return {
    get shadowColor() {
      return currentShadowColor();
    },
    shadowOffset: { width: 0, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation,
  };
}

export const shadows = {
  none: {
    shadowOpacity: 0,
    elevation: 0,
  },
  soft: makeLevel(3, 0.06, 10, 2),
  // 设计系统两级卡片阴影（规范 3.3）
  card: makeLevel(4, 0.08, 12, 3),
  cardElevated: makeLevel(8, 0.12, 18, 5),
  medium: makeLevel(6, 0.10, 16, 4),
  floating: makeLevel(8, 0.20, 18, 7),
};

/**
 * 在工厂样式中显式生成带主题阴影色的阴影：
 *   const createStyles = (c) => StyleSheet.create({ box: { ...themedShadow('card', c) } });
 */
export function themedShadow(levelName, themeColors) {
  const base = shadows[levelName] || shadows.card;
  return {
    shadowColor: (themeColors && themeColors.shadow) || currentShadowColor(),
    shadowOffset: base.shadowOffset,
    shadowOpacity: base.shadowOpacity,
    shadowRadius: base.shadowRadius,
    elevation: base.elevation,
  };
}

export default shadows;
