// ═══════════════════════════════════════════════════════
// Semantic color tokens for the MOMO Corn design system.
// 动态代理：向后兼容存量 import { colors } from './src/theme'，
// 读取时始终代理到当前激活主题的颜色令牌。
// ═══════════════════════════════════════════════════════

import { getActiveTheme } from './ThemeContext';

function createColorProxy(getObj) {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return undefined; // 防误判为 Promise
      const current = getObj();
      if (!current) return undefined;

      // 语义与别名智能映射
      if (prop === 'surface' || prop === 'cardBg') return current.card || current.surface || '#FFFFFF';
      if (prop === 'textPrimary' || prop === 'textMain') return current.text || current.textPrimary || '#111111';
      if (prop === 'textMuted') return current.textSecondary || current.textMuted || '#888888';
      if (prop === 'textDisabled') return current.border || current.textDisabled || '#CCCCCC';
      if (prop === 'borderStrong') return current.border || '#E0E0E0';
      if (prop === 'primaryAction') return current.primary || current.primaryAction;
      if (prop === 'primaryActionPressed') return current.primary || current.primaryActionPressed;
      if (prop === 'primaryActionDisabled') return current.border || current.primaryActionDisabled;
      if (prop === 'primarySoft') return current.primarySoft || current.background;
      if (prop === 'me') return current.primary || current.me;
      if (prop === 'meSoft') return current.background || current.meSoft;
      if (prop === 'partner') return current.accent || current.partner;
      if (prop === 'partnerSoft') return current.background || current.partnerSoft;
      if (prop === 'backgroundLavender') return current.background;
      if (prop === 'surfaceSoft') return current.card || current.surfaceSoft;

      // 针对存量组件可能的色板对象访问（如 neutral, coral, mint, amber 等）做安全代理，防止 undefined 崩溃
      if (['neutral', 'coral', 'mint', 'amber'].includes(prop)) {
        return new Proxy({}, {
          get(_t, subProp) {
            if (subProp === '50' || subProp === '100') return current.background;
            if (subProp === '200' || subProp === '300' || subProp === '400') return current.border;
            if (subProp === '700' || subProp === '800' || subProp === '900') return current.text;
            return current.accent || current.primary;
          },
        });
      }

      const val = current[prop];
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        return createColorProxy(() => {
          const c = getObj();
          return c ? c[prop] : undefined;
        });
      }
      return val;
    },
    has(_target, prop) {
      const current = getObj();
      return current ? prop in current : false;
    },
    ownKeys(_target) {
      const current = getObj();
      return current ? Reflect.ownKeys(current) : [];
    },
    getOwnPropertyDescriptor(_target, prop) {
      const current = getObj();
      if (!current) return undefined;
      return Reflect.getOwnPropertyDescriptor(current, prop);
    },
  });
}

export const colors = createColorProxy(() => getActiveTheme().colors);

export default colors;
