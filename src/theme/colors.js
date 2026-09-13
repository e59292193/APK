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
