import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing } from '../../theme';

export function LoadingState({ text, style, size = 'large' }) {
  return (
    <View style={[styles.container, style]}>
      <ActivityIndicator size={size} color={colors.primaryAction} />
      {text && <Text style={[typography.body, styles.text]}>{text}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[10] },
  text: { color: colors.textSecondary, marginTop: spacing[3] },
});

export default LoadingState;
