import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, layout, spacing, typography } from '../../theme';

export function FloatingActionButton({ icon = 'add', label, onPress, color }) {
  const insets = useSafeAreaInsets();
  const bgColor = color || colors.primaryAction;
  const bottom = layout.tabBarHeight + layout.fabMarginBottomFromTabBar + insets.bottom;
  const isExtended = !!label;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        isExtended ? styles.extended : styles.round,
        { backgroundColor: bgColor, bottom },
        pressed && styles.pressed,
      ]}
      android_ripple={{ color: colors.primaryActionPressed, radius: 28 }}
      accessibilityRole="button"
      accessibilityLabel={label || '新增'}
    >
      <Ionicons name={icon} size={24} color="#FFFFFF" />
      {label && <Text style={styles.label}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    position: 'absolute',
    right: spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.floating,
  },
  round: {
    width: layout.fabSize,
    height: layout.fabSize,
    borderRadius: layout.fabSize / 2,
  },
  extended: {
    height: layout.fabExtendedHeight,
    borderRadius: layout.fabExtendedHeight / 2,
    paddingHorizontal: spacing[4],
  },
  label: {
    ...typography.bodyMedium,
    color: '#FFFFFF',
    marginLeft: spacing[2],
  },
  pressed: { opacity: 0.88 },
});

export default FloatingActionButton;
