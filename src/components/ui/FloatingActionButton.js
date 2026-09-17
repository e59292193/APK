import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { layout, spacing, typography, useTheme } from '../../theme';

export function FloatingActionButton({ icon = 'add', label, onPress, color }) {
  const insets = useSafeAreaInsets(); const { colors } = useTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const bottom = layout.tabBarHeight + layout.fabMarginBottomFromTabBar + insets.bottom;
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.base, label ? styles.extended : styles.round, { backgroundColor: color || colors.primary, bottom }, pressed && styles.pressed]} android_ripple={{ color: colors.primaryPressed, radius: 28 }} accessibilityRole="button" accessibilityLabel={label || '新增'}><Ionicons name={icon} size={24} color={colors.textOnPrimary} />{label ? <Text style={styles.label}>{label}</Text> : null}</Pressable>;
}
const createStyles = (c) => StyleSheet.create({ base: { position: 'absolute', right: spacing[5], flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: c.shadow, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 18, elevation: 7 }, round: { width: layout.fabSize, height: layout.fabSize, borderRadius: layout.fabSize / 2 }, extended: { height: layout.fabExtendedHeight, borderRadius: layout.fabExtendedHeight / 2, paddingHorizontal: spacing[4] }, label: { ...typography.bodyMedium, color: c.textOnPrimary, marginLeft: spacing[2] }, pressed: { opacity: 0.88 } });
export default FloatingActionButton;
