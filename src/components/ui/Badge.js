import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, radius, spacing } from '../../theme';

const VARIANTS = {
  primary: { bg: colors.primary[100], text: colors.primary[700] },
  mint: { bg: colors.partnerSoft, text: colors.mint[700] },
  coral: { bg: colors.coral[50], text: colors.coral[600] },
  amber: { bg: colors.amber[50], text: colors.amber[500] },
  neutral: { bg: colors.neutral[100], text: colors.neutral[600] },
  success: { bg: colors.partnerSoft, text: colors.success },
  error: { bg: colors.errorSoft, text: colors.error },
  solidPrimary: { bg: colors.primaryAction, text: '#FFFFFF' },
};

export function Badge({ children, variant = 'primary', size = 'md', style, textStyle }) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const isSmall = size === 'sm';
  return (
    <View style={[styles.base, { backgroundColor: v.bg }, isSmall && styles.small, style]}>
      <Text
        style={[
          isSmall ? typography.label : typography.caption,
          { color: v.text, fontWeight: '600' },
          styles.text,
          textStyle,
        ]}
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1] - 1,
    borderRadius: radius.xs,
  },
  small: {
    paddingHorizontal: spacing[1] + 2,
    paddingVertical: 1,
  },
  text: { letterSpacing: 0.2 },
});

export default Badge;
