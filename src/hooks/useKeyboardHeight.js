import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

/**
 * 原始键盘高度（不做任何扣除）。
 * 适合「键盘弹起时隐藏底部栏 / 切换紧凑布局」这类显示判断。
 */
export const useRawKeyboardHeight = () => {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const handleShow = (e) => {
      const h = e?.endCoordinates?.height || 0;
      if (h > 0) setKeyboardHeight(h);
    };
    const handleHide = () => {
      setKeyboardHeight(0);
    };

    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', handleShow),
      Keyboard.addListener('keyboardDidShow', handleShow),
      Keyboard.addListener('keyboardWillHide', handleHide),
      Keyboard.addListener('keyboardDidHide', handleHide),
    ];

    return () => {
      subscriptions.forEach((sub) => sub.remove());
    };
  }, []);

  return keyboardHeight;
};

/**
 * 应用还需要自行补偿的键盘高度（自适应 adjustPan / adjustResize 两种模式）。
 *
 * 背景：app.json 配置了 android softwareKeyboardLayoutMode = "resize"，
 * 键盘弹起时系统已经把整个窗口压缩了。若此时再按完整键盘高度做
 * KeyboardAvoidingView / marginBottom 补偿，会被二次抬高，在键盘与输入框之间
 * 形成一块长方形空白区，且收起键盘后可能不回落。
 *
 * 这里用 window 尺寸变化实时检测系统已经压缩掉的高度并扣除：
 * - resize 模式：返回值约等于 0（系统已处理，输入框天然紧贴键盘）
 * - pan 模式（或不含 resize 配置的旧安装包）：返回完整键盘高度（手动顶起输入框）
 * 两种模式下键盘弹起都紧贴输入框，收起后输入框回到底部。
 */
export const useAdaptiveKeyboardPadding = () => {
  const keyboardHeight = useRawKeyboardHeight();
  // 挂载时（键盘未弹起）记录窗口基准高度
  const baseWindowHeightRef = useRef(Dimensions.get('window').height);
  const [resizedBy, setResizedBy] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const handleWindowChange = ({ window }) => {
      if (!window) return;
      const base = baseWindowHeightRef.current;
      // 窗口变高（键盘完全收起）时刷新基准，避免手势栏/分屏导致基准漂移
      if (window.height >= base) {
        baseWindowHeightRef.current = window.height;
        setResizedBy(0);
        return;
      }
      setResizedBy(Math.max(0, base - window.height));
    };
    const dimSub = Dimensions.addEventListener('change', handleWindowChange);
    return () => dimSub?.remove?.();
  }, []);

  if (Platform.OS !== 'android') return keyboardHeight;
  return Math.max(0, keyboardHeight - resizedBy);
};

/**
 * 历史导出名，语义升级为「自适应键盘补偿高度」。
 * 注意：需要判断「键盘是否弹起」时（如隐藏底部 Tab、切换紧凑布局）
 * 请改用 useRawKeyboardHeight —— resize 模式下键盘弹起时自适应值约为 0，
 * 直接当键盘高度判断会失效。
 */
export const useKeyboardHeight = useAdaptiveKeyboardPadding;
