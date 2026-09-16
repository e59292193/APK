import React from 'react';
import { Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, typography, layout, useTheme } from '../../theme';

const SIZES = {
  small: { height: layout.buttonHeightSmall, fontSize: 13, padH: 14, icon: 16 },
  medium: { height: layout.buttonHeightMedium, fontSize: 15, padH: 18, icon: 20 },
  large: { height: layout.buttonHeightLarge, fontSize: 16, padH: 22, icon: 22 },
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
  const { colors: currentColors = colors } = useTheme();
  const s = SIZES[size] || SIZES.medium;

  const primaryBg = currentColors.primaryAction || currentColors.primary || '#8B5FC7';
  const primaryBgPressed = currentColors.primaryActionPressed || currentColors.primaryPressed || '#7A4EB6';
  const primaryBgDisabled = currentColors.primaryActionDisabled || currentColors.primaryDisabled || '#D1C2E8';
  const textOnPrimary = currentColors.textOnPrimary || '#FFFFFF';

  const VARIANTS = {
    primary: {
      bg: primaryBg,
      bgPressed: primaryBgPressed,
      bgDisabled: primaryBgDisabled,
      text: textOnPrimary,
      textDisabled: textOnPrimary,
    },
    secondary: {
      bg: currentColors.primarySoft || currentColors.surfaceSoft || '#F5F3F7',
      bgPressed: currentColors.border || '#EAE5EF',
      bgDisabled: '#F5F3F7',
      text: primaryBg,
      textDisabled: currentColors.textDisabled || '#999999',
    },
    ghost: {
      bg: 'transparent',
      bgPressed: currentColors.surfaceSoft || '#F5F3F7',
      bgDisabled: 'transparent',
      text: primaryBg,
      textDisabled: currentColors.textDisabled || '#999999',
    },
    danger: {
      bg: currentColors.errorSoft || '#FDEBE9',
      bgPressed: '#FFE0DE',
      bgDisabled: '#F5F3F7',
      text: currentColors.error || '#F05A4F',
      textDisabled: currentColors.textDisabled || '#999999',
    },
  };

  const v = VARIANTS[variant] || VARIANTS.primary;
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
          opacity: isDisabled ? 0.6 : 1,
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
