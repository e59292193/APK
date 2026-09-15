import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, layout, useTheme } from '../../theme';
import { IconButton } from './IconButton';

export function AppHeader({ title, subtitle, leftAction, rightAction, showBack = false, onBack, icon, compact = false, children, style }) {
  const insets = useSafeAreaInsets(); const { colors } = useTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={[styles.container, { paddingTop: insets.top }, style]}><View style={[styles.content, { height: compact ? layout.headerHeightCompact : layout.headerHeight }]}><View style={styles.left}>{showBack ? <IconButton icon="chevron-back" size={24} onPress={onBack} accessibilityLabel="返回" hitSlop={12} /> : leftAction || (icon && typeof icon !== 'string' ? <View style={styles.iconWrap}>{icon}</View> : null)}</View><View style={styles.center}>{title ? <Text style={[compact ? typography.cardTitle : typography.pageTitle, styles.title]} numberOfLines={1}>{title}</Text> : null}{subtitle ? <Text style={[typography.caption, styles.subtitle]} numberOfLines={1}>{subtitle}</Text> : null}</View><View style={styles.right}>{rightAction || null}</View></View>{children}</View>;
}
const createStyles = (c) => StyleSheet.create({ container: { backgroundColor: c.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }, content: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[2] }, left: { minWidth: 44, justifyContent: 'center' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', marginHorizontal: spacing[1] }, right: { minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' }, title: { color: c.text }, subtitle: { color: c.textSecondary, marginTop: 2 }, iconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' } });
export default AppHeader;
