import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, layout } from '../../theme';

export function IconButton({
  icon,
  size = 24,
  color = colors.textPrimary,
  onPress,
  disabled = false,
  accessibilityLabel,
  style,
  hitSlop,
}) {
  const minTouch = Math.max(layout.touchTarget, size + 16);
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
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={disabled ? colors.textDisabled : color} />
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
