import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { layout, useTheme } from '../../theme';

export function IconButton({ icon, name, size = 24, color, onPress, disabled = false, accessibilityLabel, style, hitSlop }) {
  const { colors } = useTheme(); const minTouch = Math.max(layout.touchTarget, size + 16);
  return <Pressable onPress={disabled ? undefined : onPress} disabled={disabled} accessibilityLabel={accessibilityLabel} accessibilityRole="button" hitSlop={hitSlop || 8} style={({ pressed }) => [styles.base, { width: minTouch, height: minTouch, borderRadius: minTouch / 2 }, pressed && !disabled && { backgroundColor: colors.primarySoft }, disabled && styles.disabled, style]}><Ionicons name={icon || name} size={size} color={disabled ? colors.textDisabled : color || colors.text} /></Pressable>;
}
const styles = StyleSheet.create({ base: { alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.4 } });
export default IconButton;
