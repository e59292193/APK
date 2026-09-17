import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { typography, radius, spacing, useTheme } from '../../theme';
import Badge from './Badge';

export function SegmentedControl({ segments, selectedIndex, onChange, style }) {
  const { colors } = useTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const position = useRef(new Animated.Value(selectedIndex)).current; const [width, setWidth] = useState(0);
  useEffect(() => { Animated.timing(position, { toValue: selectedIndex, duration: 200, useNativeDriver: false }).start(); }, [selectedIndex, position]);
  const itemWidth = width > 0 ? (width - 8) / segments.length : 0;
  return <View style={[styles.container, style]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    {width > 0 ? <Animated.View style={[styles.indicator, { width: itemWidth - 4, transform: [{ translateX: position.interpolate({ inputRange: segments.map((_, i) => i), outputRange: segments.map((_, i) => i * itemWidth + 2) }) }] }]} /> : null}
    {segments.map((segment, index) => <Pressable key={segment.key} style={styles.segment} onPress={() => onChange(index)} accessibilityRole="button" accessibilityState={{ selected: index === selectedIndex }}><View style={styles.content}><Text style={[typography.bodyMedium, { color: index === selectedIndex ? colors.primary : colors.textSecondary }]}>{segment.label}</Text>{segment.badge > 0 ? <Badge variant={index === selectedIndex ? 'solidPrimary' : 'neutral'} size="sm" style={styles.badge}>{segment.badge > 99 ? '99+' : segment.badge}</Badge> : null}</View></Pressable>)}
  </View>;
}
const createStyles = (c) => StyleSheet.create({ container: { flexDirection: 'row', backgroundColor: c.surfaceSoft, borderRadius: radius.md, padding: 4, position: 'relative' }, indicator: { position: 'absolute', top: 4, bottom: 4, backgroundColor: c.card, borderRadius: radius.sm, shadowColor: c.shadow, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 }, segment: { flex: 1, paddingVertical: 10, zIndex: 1 }, content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }, badge: { marginLeft: spacing[1] } });
export default SegmentedControl;
