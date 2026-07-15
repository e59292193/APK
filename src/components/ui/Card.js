import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { colors, radius, shadows, spacing } from '../../theme';

const VARIANTS = {
  standard: { bg: colors.surface, border: colors.border, shadow: shadows.soft, pad: spacing[4] },
  soft: { bg: colors.surfaceSoft, border: colors.border, shadow: shadows.none, pad: spacing[4] },
  interactive: { bg: colors.surface, border: colors.border, shadow: shadows.soft, pad: spacing[4] },
  media: { bg: colors.surface, border: 'transparent', shadow: shadows.none, pad: 0 },
  statistic: { bg: colors.surface, border: colors.border, shadow: shadows.none, pad: spacing[4] },
};

export function Card({ children, variant = 'standard', onPress, style, contentStyle }) {
  const v = VARIANTS[variant] || VARIANTS.standard;
  const isInteractive = variant === 'interactive' && onPress;

  if (isInteractive) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.base,
          { backgroundColor: v.bg, borderColor: v.border, padding: v.pad },
          v.shadow,
          pressed && styles.pressed,
          style,
        ]}
        android_ripple={{ color: colors.primary[50], borderless: false }}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={[styles.base, { backgroundColor: v.bg, borderColor: v.border, padding: v.pad }, v.shadow, style]}>
      <View style={contentStyle}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.85 },
});

export default Card;
