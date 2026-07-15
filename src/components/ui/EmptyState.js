import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';
import Button from './Button';

export function EmptyState({ icon = 'sparkles-outline', title, description, actionLabel, onAction, style }) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={36} color={colors.primary[300]} />
      </View>
      {title && <Text style={[typography.cardTitle, styles.title]}>{title}</Text>}
      {description && <Text style={[typography.body, styles.description]}>{description}</Text>}
      {actionLabel && onAction && (
        <Button variant="secondary" size="small" onPress={onAction} style={styles.action}>
          {actionLabel}
        </Button>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[10],
    paddingHorizontal: spacing[6],
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  title: { color: colors.textPrimary, textAlign: 'center', marginBottom: spacing[2] },
  description: { color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  action: { marginTop: spacing[4] },
});

export default EmptyState;
