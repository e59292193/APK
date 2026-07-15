import React, { useRef, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, LayoutChangeEvent } from 'react-native';
import { colors, typography, radius, spacing, shadows } from '../../theme';
import Badge from './Badge';

export function SegmentedControl({ segments, selectedIndex, onChange, style }) {
  const fadeAnim = useRef(new Animated.Value(selectedIndex)).current;
  const [containerW, setContainerW] = useState(0);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: selectedIndex,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [selectedIndex, fadeAnim]);

  const segmentWidth = containerW > 0 ? (containerW - 8) / segments.length : 0;

  return (
    <View
      style={[styles.container, style]}
      onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
    >
      {containerW > 0 && (
        <Animated.View
          style={[
            styles.indicator,
            {
              width: segmentWidth - 4,
              transform: [
                {
                  translateX: fadeAnim.interpolate({
                    inputRange: segments.map((_, i) => i),
                    outputRange: segments.map((_, i) => i * segmentWidth + 2),
                  }),
                },
              ],
            },
          ]}
        />
      )}
      {segments.map((seg, i) => (
        <Pressable
          key={seg.key}
          style={styles.segment}
          onPress={() => onChange(i)}
          accessibilityRole="button"
          accessibilityState={{ selected: i === selectedIndex }}
        >
          <View style={styles.segmentContent}>
            <Text
              style={[
                typography.bodyMedium,
                { color: i === selectedIndex ? colors.primaryAction : colors.textSecondary },
              ]}
            >
              {seg.label}
            </Text>
            {seg.badge != null && seg.badge > 0 && (
              <Badge variant={i === selectedIndex ? 'solidPrimary' : 'neutral'} size="sm" style={styles.badge}>
                {seg.badge > 99 ? '99+' : seg.badge}
              </Badge>
            )}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.neutral[100],
    borderRadius: radius.md,
    padding: 4,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    ...shadows.soft,
  },
  segment: { flex: 1, paddingVertical: 10, zIndex: 1 },
  segmentContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  badge: { marginLeft: spacing[1] },
});

export default SegmentedControl;
