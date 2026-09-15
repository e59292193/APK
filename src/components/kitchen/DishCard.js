import React, { useMemo, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, useTheme } from '../../theme';
import { CachedImage } from '../../lib/imageCache';
import { CATEGORY_LABELS, normalizeCategory } from '../../lib/kitchenUtils';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.floor((SCREEN_WIDTH - spacing[4] * 2 - 12) / 2);
const IMAGE_HEIGHT = Math.floor(CARD_WIDTH * 2 / 3);

export function DishCard({ dish, isPicked = false, onPress, onLongPress, onTogglePick }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const scale = useRef(new Animated.Value(1)).current;
  if (!dish) return null;
  const categoryLabel = CATEGORY_LABELS[dish.category] || CATEGORY_LABELS[normalizeCategory(dish.category)] || '菜品';
  const creatorInitial = String(dish.created_by || 'm').charAt(0).toUpperCase();
  const animateTo = (toValue) => Animated.spring(scale, { toValue, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  return <Animated.View style={[styles.container, { transform: [{ scale }] }]}>
    <TouchableOpacity
      style={styles.card} activeOpacity={0.92}
      onPress={() => onPress?.(dish)} onLongPress={() => onLongPress?.(dish)}
      onPressIn={() => animateTo(0.96)} onPressOut={() => animateTo(1)}
      accessibilityRole="button" accessibilityLabel={`${dish.title}, ${categoryLabel}`}
    >
      <View style={styles.imageWrap}>
        {dish.image_path ? <CachedImage source={dish.image_path} style={styles.image} contentFit="cover" previewable={false} /> : <View style={styles.placeholder}><Ionicons name={normalizeCategory(dish.category) === 'drink' ? 'cafe-outline' : 'restaurant-outline'} size={32} color={colors.textMuted} /></View>}
        {isPicked ? <View style={styles.pickedBadge}><Ionicons name="checkmark-circle" size={12} color={colors.textOnPrimary} /><Text style={styles.pickedText}>想吃</Text></View> : null}
        <TouchableOpacity style={[styles.heart, isPicked && styles.heartPicked]} onPress={(event) => { event.stopPropagation(); onTogglePick?.(dish); }} hitSlop={8} accessibilityLabel={isPicked ? '移出本周想吃' : '加入本周想吃'}>
          <Ionicons name={isPicked ? 'heart' : 'heart-outline'} size={17} color={isPicked ? colors.primary : colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>{dish.title}</Text>
        <View style={styles.footer}>
          <View style={styles.tag}><Text style={styles.tagText}>{categoryLabel}</Text></View>
          <View style={styles.creator}><View style={styles.avatar}><Text style={styles.avatarText}>{creatorInitial}</Text></View><Text style={styles.creatorName} numberOfLines={1}>{dish.created_by || '我们'}</Text></View>
        </View>
      </View>
    </TouchableOpacity>
  </Animated.View>;
}

const createStyles = (c) => StyleSheet.create({
  container: { width: CARD_WIDTH, marginBottom: 14 },
  card: { backgroundColor: c.card, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: c.border, shadowColor: c.shadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 },
  imageWrap: { width: '100%', height: IMAGE_HEIGHT, backgroundColor: c.surfaceSoft, position: 'relative', overflow: 'hidden' }, image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceSoft },
  pickedBadge: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.primary }, pickedText: { color: c.textOnPrimary, fontSize: 10, fontWeight: '700' },
  heart: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }, heartPicked: { backgroundColor: c.primarySoft },
  content: { padding: 12 }, title: { fontSize: 14, fontWeight: '700', lineHeight: 19, minHeight: 38, color: c.text },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }, tag: { borderWidth: 1, borderColor: c.border, backgroundColor: c.primarySoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }, tagText: { fontSize: 10, fontWeight: '600', color: c.primary },
  creator: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '55%' }, avatar: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft }, avatarText: { fontSize: 9, fontWeight: '700', color: c.accent }, creatorName: { fontSize: 11, color: c.textMuted },
});

export default DishCard;
