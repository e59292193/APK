import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, layout } from '../../theme';
import { IconButton } from './IconButton';

export function AppHeader({
  title,
  subtitle,
  leftAction,
  rightAction,
  showBack = false,
  onBack,
  icon,
  compact = false,
  children,
  style,
}) {
  const insets = useSafeAreaInsets();
  const height = compact ? layout.headerHeightCompact : layout.headerHeight;

  return (
    <View style={[styles.container, { paddingTop: insets.top }, style]}>
      <View style={[styles.content, { height }]}>
        <View style={styles.left}>
          {showBack ? (
            <IconButton icon="chevron-back" size={24} onPress={onBack} accessibilityLabel="返回" />
          ) : leftAction ? (
            leftAction
          ) : icon ? (
            <View style={styles.iconWrap}>
              {typeof icon === 'string' ? null : icon}
            </View>
          ) : null}
        </View>

        <View style={styles.center}>
          {title && (
            <Text style={[compact ? typography.cardTitle : typography.pageTitle, styles.title]} numberOfLines={1}>
              {title}
            </Text>
          )}
          {subtitle && (
            <Text style={[typography.caption, styles.subtitle]} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>

        <View style={styles.right}>{rightAction || null}</View>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.backgroundLavender,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
  },
  left: { minWidth: 44, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', marginHorizontal: spacing[1] },
  right: { minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  title: { color: colors.textPrimary },
  subtitle: { color: colors.textSecondary, marginTop: 2 },
  iconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});

export default AppHeader;
