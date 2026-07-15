import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, radius, spacing } from '../../theme';
import { TouchableOpacity } from 'react-native';

export function ErrorBanner({ message = '加载失败', onRetry, style }) {
  return (
    <View style={[styles.container, style]}>
      <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
      <Text style={[typography.body, styles.text]} numberOfLines={2}>
        {message}
      </Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={styles.retryBtn} accessibilityRole="button" accessibilityLabel="重试">
          <Text style={[typography.label, styles.retryText]}>重试</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.errorSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2] + 2,
    marginBottom: spacing[3],
  },
  text: { flex: 1, color: colors.error, marginLeft: spacing[2] },
  retryBtn: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  retryText: { color: colors.error, fontWeight: '600' },
});

export default ErrorBanner;
