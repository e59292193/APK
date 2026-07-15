import React from 'react';
import { Pressable, Text, ActivityIndicator, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, typography, layout } from '../../theme';

const SIZES = {
  small: { height: layout.buttonHeightSmall, fontSize: 13, padH: 14, icon: 16 },
  medium: { height: layout.buttonHeightMedium, fontSize: 15, padH: 18, icon: 20 },
  large: { height: layout.buttonHeightLarge, fontSize: 16, padH: 22, icon: 22 },
};

const VARIANTS = {
  primary: {
    bg: colors.primaryAction,
    bgPressed: colors.primaryActionPressed,
    bgDisabled: colors.primaryActionDisabled,
    text: '#FFFFFF',
    textDisabled: '#FFFFFF',
  },
  secondary: {
    bg: colors.primary[100],
    bgPressed: colors.primary[200],
    bgDisabled: colors.neutral[100],
    text: colors.primary[700],
    textDisabled: colors.textDisabled,
  },
  ghost: {
    bg: 'transparent',
    bgPressed: colors.primary[50],
    bgDisabled: 'transparent',
    text: colors.primaryAction,
    textDisabled: colors.textDisabled,
  },
  danger: {
    bg: colors.errorSoft,
    bgPressed: '#FFE0DE',
    bgDisabled: colors.neutral[100],
    text: colors.error,
    textDisabled: colors.textDisabled,
  },
};

export function Button({
  children,
  title,
  variant = 'primary',
  size = 'medium',
  loading = false,
  disabled = false,
  iconLeft,
  iconRight,
  fullWidth = false,
  onPress,
  style,
  textStyle,
}) {
  const s = SIZES[size];
  const v = VARIANTS[variant];
  const isDisabled = disabled || loading;
  const bg = isDisabled ? v.bgDisabled : v.bg;

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          height: s.height,
          paddingHorizontal: s.padH,
          backgroundColor: pressed && !isDisabled ? v.bgPressed : bg,
          opacity: variant === 'ghost' && isDisabled ? 0.5 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
      android_ripple={{ color: v.bgPressed, radius: radius.md, borderless: false }}
    >
      {loading && <ActivityIndicator color={v.text} size="small" style={styles.loader} />}
      {!loading && iconLeft && <Ionicons name={iconLeft} size={s.icon} color={v.text} style={styles.iconLeft} />}
      <Text
        style={[
          { color: isDisabled ? v.textDisabled : v.text, fontSize: s.fontSize },
          typography.bodyMedium,
          styles.text,
          textStyle,
        ]}
        numberOfLines={1}
      >
        {title || children}
      </Text>
      {!loading && iconRight && <Ionicons name={iconRight} size={s.icon} color={v.text} style={styles.iconRight} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  fullWidth: { width: '100%' },
  loader: { marginRight: 8 },
  iconLeft: { marginRight: 8 },
  iconRight: { marginLeft: 8 },
  text: { textAlign: 'center' },
});

export default Button;
