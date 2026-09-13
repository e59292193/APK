import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, radius, shadows, useTheme } from '../../theme';

/**
 * 居中弹入浮层 Toast
 * 规范：居中圆角卡片、轻微缩放弹入（60fps）、约 1.8 秒后淡出、不阻塞操作（pointerEvents="none"）
 *
 * @param {boolean} visible - 是否显示
 * @param {string} message - 提示文案（必须一字不差）
 * @param {string} [icon] - 选用图标（Ionicons 名称）
 * @param {function} [onDismiss] - 隐藏后回调
 * @param {number} [duration=1800] - 停留时间（毫秒）
 */
export function CenterToast({
  visible,
  message,
  icon = 'sparkles',
  onDismiss,
  duration = 1800,
}) {
  const { colors } = useTheme();
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      scale.setValue(0.85);
      opacity.setValue(0);
      return undefined;
    }

    // 弹入动画
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();

    // 自动淡出
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 0.92,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start(() => {
        if (onDismiss) onDismiss();
      });
    }, duration);

    return () => {
      clearTimeout(timer);
    };
  }, [visible, duration, onDismiss, scale, opacity]);

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View
        style={[
          styles.toastCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            transform: [{ scale }],
            opacity,
          },
        ]}
      >
        {icon ? (
          <View style={[styles.iconWrap, { backgroundColor: colors.primary[100] }]}>
            <Ionicons name={icon} size={22} color={colors.primaryAction} />
          </View>
        ) : null}
        <Text style={[styles.messageText, { color: colors.textPrimary }]}>{message}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  toastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '85%',
    ...shadows.lg,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  messageText: {
    ...typography.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
  },
});

export default CenterToast;
