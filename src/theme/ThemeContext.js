import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { THEMES, DEFAULT_THEME, THEME_LIST, resolveThemeId } from './themes';

// 现行存储键；旧键仅用于一次性搬家读取
export const THEME_STORAGE_KEY = '@momi_theme';
const LEGACY_THEME_STORAGE_KEY = 'momo.theme.id';

// 模块级激活主题引用，供 colors.js Proxy 同步读取
let currentActiveTheme = DEFAULT_THEME;

export function getActiveTheme() {
  return currentActiveTheme;
}

/**
 * 同步切换模块级激活主题（供 colors Proxy / 启动预取使用）。
 * 未知 key 回退 default 前必须 console.warn，不得静默回退。
 */
export function setActiveThemeSync(themeId) {
  const resolved = resolveThemeId(themeId);
  if (resolved.unknown && typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(`[theme] 未知主题 key「${themeId}」，已回退到 default。请检查调用处。`);
  }
  currentActiveTheme = resolved.theme;
  return resolved.theme;
}

async function readStoredThemeId() {
  try {
    const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
    if (saved) return saved;
    // 一次性搬家：读取旧键并写入新键
    const legacy = await AsyncStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (legacy) {
      const resolved = resolveThemeId(legacy);
      await AsyncStorage.setItem(THEME_STORAGE_KEY, resolved.id).catch(() => {});
      await AsyncStorage.removeItem(LEGACY_THEME_STORAGE_KEY).catch(() => {});
      return resolved.id;
    }
  } catch (e) {
    console.warn('[Theme] 读取主题偏好失败:', e.message);
  }
  return null;
}

/**
 * 启动预取主题 ID（在 App 首帧渲染前调用，防止闪烁）
 */
export async function prefetchThemeId() {
  try {
    const saved = await readStoredThemeId();
    if (saved) {
      const active = setActiveThemeSync(saved);
      return active.id;
    }
  } catch (e) {
    console.warn('[Theme] 预取主题失败:', e.message);
  }
  return DEFAULT_THEME.id;
}

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  themeId: DEFAULT_THEME.id,
  colors: DEFAULT_THEME.colors,
  isDark: DEFAULT_THEME.isDark,
  setTheme: async () => {},
  setThemeId: async () => {},
  availableThemes: THEME_LIST,
});

export function ThemeProvider({ children, initialThemeId }) {
  const [themeId, setThemeIdState] = useState(() => {
    if (initialThemeId) {
      const active = setActiveThemeSync(initialThemeId);
      return active.id;
    }
    return currentActiveTheme.id;
  });

  useEffect(() => {
    let alive = true;
    readStoredThemeId()
      .then((saved) => {
        if (alive && saved) {
          const resolved = setActiveThemeSync(saved);
          if (resolved.id !== themeId) {
            setThemeIdState(resolved.id);
          }
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [themeId]);

  // setTheme：先做 key 规范化（兼容 mint/peach/sky 旧别名），再持久化到现行存储键
  const setTheme = useCallback(async (newId) => {
    const resolved = resolveThemeId(newId);
    if (resolved.unknown) {
      console.warn(`[theme] 未知主题 key「${newId}」，已回退到 default。`);
    }
    const target = setActiveThemeSync(resolved.id);
    setThemeIdState(target.id);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, target.id);
    } catch (e) {
      console.warn('[Theme] 保存主题选择失败:', e.message);
    }
  }, []);

  const currentTheme = useMemo(() => THEMES[themeId] || DEFAULT_THEME, [themeId]);

  const contextValue = useMemo(
    () => ({
      theme: currentTheme,
      themeId,
      colors: currentTheme.colors,
      isDark: currentTheme.isDark,
      setTheme,
      setThemeId: setTheme, // 向后兼容旧调用名
      availableThemes: THEME_LIST,
    }),
    [currentTheme, themeId, setTheme]
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      theme: currentActiveTheme,
      themeId: currentActiveTheme.id,
      colors: currentActiveTheme.colors,
      isDark: currentActiveTheme.isDark,
      setTheme: () => {},
      setThemeId: () => {},
      availableThemes: THEME_LIST,
    };
  }
  return context;
}
