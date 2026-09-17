// ═══════════════════════════════════════════════════════
// Semantic color tokens for the MOMO Corn design system.
// 动态代理：向后兼容存量 import { colors } from './src/theme'，
// 读取时始终代理到当前激活主题的颜色令牌。
//
// 【开发期护栏】__DEV__ 下每次命中新属性输出一次性警告（按属性名去重）：
//   模块顶层 StyleSheet.create 会在 import 时冻结色值快照，导致主题切换不生效。
//   正确姿势：组件内 const { colors } = useTheme() + useMemo 工厂样式。
// 【禁止】不要在 Proxy 中做任何「自动刷新」黑魔法 —— 那在 JS 层面无法实现。
// ═══════════════════════════════════════════════════════

import { getActiveTheme } from './ThemeContext';

// 历史别名 → 现行令牌（仅保留真正改名过的键；其余令牌主题对象上已存在）
const LEGACY_TOKEN_ALIASES = {
  cardBg: 'card',
  textPrimary: 'text',
  textMain: 'text',
  primaryAction: 'primary',
  primaryActionPressed: 'primaryPressed',
  primaryActionDisabled: 'primaryDisabled',
  backgroundLavender: 'backgroundElevated',
};

const warnedKeys = new Set();

function devWarnStaticRead(prop) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (typeof prop !== 'string') return;
  if (warnedKeys.has(prop)) return;
  warnedKeys.add(prop);
  // eslint-disable-next-line no-console
  console.warn(
    `[theme] 检测到静态读取 colors.${prop}，若发生在模块顶层 StyleSheet.create 中会导致主题不跟随。请改用 useTheme() + useMemo 工厂样式。`
  );
}

function createColorProxy(getObj) {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return undefined; // 防误判为 Promise
      if (typeof prop === 'symbol') return undefined;
      const current = getObj();
      if (!current) return undefined;

      devWarnStaticRead(prop);

      // 历史别名映射
      if (prop in LEGACY_TOKEN_ALIASES) {
        return current[LEGACY_TOKEN_ALIASES[prop]];
      }

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
      if (!current) return false;
      return prop in current || prop in LEGACY_TOKEN_ALIASES;
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
