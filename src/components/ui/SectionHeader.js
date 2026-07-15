import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing } from '../../theme';
import Button from './Button';

export function SectionHeader({ title, subtitle, rightAction, icon, style }) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.left}>
        {icon && <Ionicons name={icon} size={20} color={colors.primaryAction} style={styles.icon} />}
        <View>
          {title && <Text style={[typography.sectionTitle, styles.title]}>{title}</Text>}
          {subtitle && <Text style={[typography.caption, styles.subtitle]}>{subtitle}</Text>}
        </View>
      </View>
      {rightAction}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
    marginTop: spacing[2],
  },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  icon: { marginRight: spacing[2] },
  title: { color: colors.textPrimary },
  subtitle: { color: colors.textSecondary, marginTop: 2 },
});

export default SectionHeader;
