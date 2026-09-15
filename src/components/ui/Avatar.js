import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

export function Avatar({ uri, fallback, size = 40, style }) {
  const { colors } = useTheme(); const fontSize = Math.round(size * 0.42);
  return <View style={[styles.base, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft }, style]}>{uri ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} /> : <Text style={[styles.fallback, { fontSize, color: colors.primary }]}>{fallback || 'M'}</Text>}</View>;
}
const styles = StyleSheet.create({ base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, fallback: { fontWeight: '600' } });
export default Avatar;
