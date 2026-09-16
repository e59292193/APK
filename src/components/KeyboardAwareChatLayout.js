// ═══════════════════════════════════════════════════════
// KeyboardAwareChatLayout.js —— 统一键盘交互与输入布局
// 统一处理 iOS padding / Android height 与 resize 协同、
// 垂直偏移量、自动滚动到底、全面屏手势条安全区防遮挡。
// ═══════════════════════════════════════════════════════

import React, { useEffect, useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

  const keyboardVerticalOffset = useMemo(() => {
    const topInset = (insets && insets.top) || 0;
    const baseOffset = headerHeight + topInset;
    if (Platform.OS === 'android') {
      const statusBarHeight = StatusBar.currentHeight || 0;
      return Math.max(0, baseOffset - statusBarHeight);
    }
    return baseOffset;
  }, [headerHeight, insets]);

  useEffect(() => {
    const eventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const showSub = Keyboard.addListener(eventName, () => {
      setTimeout(() => {
        if (listRef?.current?.scrollToEnd) {
          listRef.current.scrollToEnd({ animated: true });
        } else if (listRef?.current?.scrollToOffset) {
          listRef.current.scrollToOffset({ offset: 0, animated: true });
        }
      }, 100);
    });
    return () => {
      showSub.remove();
    };
  }, [listRef]);

  return (
    <KeyboardAvoidingView
      style={[styles.flex, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
