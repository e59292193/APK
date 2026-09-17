// ═══════════════════════════════════════════════════════
// KeyboardAwareChatLayout.js —— 统一键盘交互与输入布局
// iOS：KeyboardAvoidingView padding 行为；
// Android：不再使用 KeyboardAvoidingView —— app.json 已配置
//   softwareKeyboardLayoutMode: "resize"，系统会压缩窗口；
//   旧实现再叠加 height 行为会二次补偿，在键盘与输入框之间
//   产生长方形空白区，且收起键盘后不回落（本次修复的 bug）。
//   Android 改为普通容器 + 自适应补偿 padding（resize/pan 双模式安全），
//   并保留键盘弹起自动滚动到底。
// ═══════════════════════════════════════════════════════

import React, { useEffect, useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Keyboard,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAdaptiveKeyboardPadding } from '../hooks/useKeyboardHeight';

export const CHAT_LIST_KEYBOARD_PROPS = {
  keyboardShouldPersistTaps: 'handled',
  keyboardDismissMode: Platform.OS === 'ios' ? 'interactive' : 'on-drag',
};

export const MAX_COMPOSER_INPUT_HEIGHT = 120; // 最多扩充到 5 行后内部滚动

/**
 * 计算消息列表底边距，确保最后一条消息不被输入框与手势条遮挡
 */
export function getChatListPaddingBottom(insets, composerHeight = 56) {
  const bottomInset = (insets && insets.bottom) || 0;
  return composerHeight + bottomInset + 12;
}

export function KeyboardAwareChatLayout({
  children,
  headerHeight = 56,
  listRef,
  style,
}) {
  const insets = useSafeAreaInsets();
  // Android：系统 resize 已压缩的部分会被自动扣除，通常得到 0；
  // 若运行在不含 resize 配置的旧安装包（pan 模式），则得到完整键盘高度。
  const androidKeyboardPadding = useAdaptiveKeyboardPadding();

  const keyboardVerticalOffset = useMemo(() => {
    const topInset = (insets && insets.top) || 0;
    return headerHeight + topInset;
  }, [headerHeight, insets]);

  useEffect(() => {
    const handleScroll = () => {
      [50, 200, 350].forEach((delay) => {
        setTimeout(() => {
          if (listRef?.current?.scrollToEnd) {
            listRef.current.scrollToEnd({ animated: true });
          } else if (listRef?.current?.scrollToOffset) {
            listRef.current.scrollToOffset({ offset: 0, animated: true });
          }
        }, delay);
      });
    };

    const subs = [
      Keyboard.addListener('keyboardWillShow', handleScroll),
      Keyboard.addListener('keyboardDidShow', handleScroll),
    ];
    return () => {
      subs.forEach((s) => s.remove());
    };
  }, [listRef]);

  // Android：resize 模式下系统已处理窗口压缩，禁用 KeyboardAvoidingView，
  // 仅以自适应 padding 补足差额（pan 模式下等于完整键盘高度）。
  if (Platform.OS === 'android') {
    return (
      <View
        style={[
          styles.flex,
          style,
          androidKeyboardPadding > 0 ? { paddingBottom: androidKeyboardPadding } : null,
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, style]}
      behavior="padding"
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});

export default KeyboardAwareChatLayout;
