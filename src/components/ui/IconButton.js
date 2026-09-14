import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, layout, useTheme } from '../../theme';

export function IconButton({
  icon,
  name,
  size = 24,
  color,
  onPress,
  disabled = false,
  accessibilityLabel,
  style,
  hitSlop,
}) {
  const { colors: currentColors = colors } = useTheme();
  const iconName = icon || name;
  const minTouch = Math.max(layout.touchTarget, size + 16);
  const activeColor = color || currentColors.text || currentColors.textPrimary;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={hitSlop || { top: 8, bottom: 8, left: 8, right: 8 }}
      style={({ pressed }) => [
        styles.base,
        { width: minTouch, height: minTouch, borderRadius: minTouch / 2 },
        pressed && !disabled && [styles.pressed, { backgroundColor: currentColors.primarySoft || currentColors.background }],
        disabled && styles.disabled,
        style,
      ]}
    >
      <Ionicons name={iconName} size={size} color={disabled ? (currentColors.border || colors.textDisabled) : activeColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.primary[50] },
  disabled: { opacity: 0.4 },
});

export default IconButton;
