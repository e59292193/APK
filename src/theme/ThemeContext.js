import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { THEMES, THEME_IDS, DEFAULT_THEME } from './themes';

export const THEME_STORAGE_KEY = 'momo.theme.id';

// 模块级激活主题引用，供 colors.js Proxy 同步读取
let currentActiveTheme = DEFAULT_THEME;

export function getActiveTheme() {
  return currentActiveTheme;
}

export function setActiveThemeSync(themeId) {
  const target = THEMES[themeId] || DEFAULT_THEME;
  currentActiveTheme = target;
  return target;
}

/**
 * 启动预取主题 ID（在 App 首帧渲染前调用，防止闪烁）
 */
export async function prefetchThemeId() {
  try {
    const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
    if (saved && THEMES[saved]) {
      setActiveThemeSync(saved);
      return saved;
    }
  } catch (e) {
    console.warn('[Theme] 预取主题失败:', e.message);
  }
  return THEME_IDS.LAVENDER;
}

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  themeId: THEME_IDS.LAVENDER,
  colors: DEFAULT_THEME.colors,
  setThemeId: async () => {},
});

export function ThemeProvider({ children, initialThemeId }) {
  const [themeId, setThemeIdState] = useState(() => {
    if (initialThemeId && THEMES[initialThemeId]) {
      setActiveThemeSync(initialThemeId);
      return initialThemeId;
    }
    return currentActiveTheme.id;
  });

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((saved) => {
        if (alive && saved && THEMES[saved] && saved !== themeId) {
          setActiveThemeSync(saved);
          setThemeIdState(saved);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [themeId]);

  const setThemeId = useCallback(async (newId) => {
    if (!THEMES[newId]) return;
    setActiveThemeSync(newId);
    setThemeIdState(newId);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newId);
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
      setThemeId,
    }),
    [currentTheme, themeId, setThemeId]
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
      setThemeId: () => {},
    };
  }
  return context;
}
