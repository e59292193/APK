// ═══════════════════════════════════════════════════════
// DishCard —— 菜品网格卡片 (功能9 UI 全面优化 & 主题跟随)
// 3:2 图片比例、白底阴影、深棕加粗菜名、主题胶囊标签、创建者微头像
// ═══════════════════════════════════════════════════════

import React, { useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius, shadows, useTheme } from '../../theme';
import { CachedImage } from '../../lib/imageCache';
import { CATEGORY_LABELS } from '../../lib/kitchenUtils';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.floor((SCREEN_WIDTH - spacing[4] * 2 - 12) / 2);
const IMAGE_HEIGHT = Math.floor(CARD_WIDTH * (2 / 3)); // 3:2 比例

export function DishCard({
  dish,
  isPicked = false,
  onPress,
  onLongPress,
  onTogglePick,
}) {
  const { colors } = useTheme();
  const primary = colors.primary || '#FF6B35';
  const cardBg = colors.card || '#FFFFFF';
  const textMain = colors.text || '#2D1B00';
  const textMuted = colors.textSecondary || '#8B7355';
  const border = colors.border || '#F2ECE4';
  const tagBg = colors.primarySoft || colors.background || '#FFF7F4';

  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 30,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 4,
    }).start();
  };

  if (!dish) return null;

  const categoryLabel = CATEGORY_LABELS[dish.category] || '菜品';
  const creatorInitial = (dish.created_by || 'm').charAt(0).toUpperCase();

  return (
    <Animated.View
      style={[
        styles.cardContainer,
        {
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      <TouchableOpacity
        style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}
        activeOpacity={0.92}
        onPress={() => onPress && onPress(dish)}
        onLongPress={() => onLongPress && onLongPress(dish)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={`${dish.title}, ${categoryLabel}`}
      >
        {/* 顶部头图 (3:2 比例，裁切圆角) */}
        <View style={styles.imageWrap}>
          {dish.image_path ? (
            <CachedImage
              source={dish.image_path}
              style={styles.image}
              contentFit="cover"
              previewable={false}
            />
          ) : (
            <View style={styles.placeholder}>
              <Ionicons name="restaurant-outline" size={32} color="#D1C4B5" />
            </View>
          )}

          {/* 本周想吃高光标签 */}
          {isPicked && (
            <View style={[styles.pickedBadge, { backgroundColor: primary }]}>
              <Ionicons name="checkmark-circle" size={12} color="#FFFFFF" />
              <Text style={styles.pickedBadgeText}>想吃</Text>
            </View>
          )}

          {/* 快捷点选本周想吃心形按钮 */}
          <TouchableOpacity
            style={[styles.heartBtn, isPicked && { backgroundColor: tagBg }]}
            activeOpacity={0.8}
            onPress={(e) => {
              e.stopPropagation();
              onTogglePick && onTogglePick(dish);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={isPicked ? 'heart' : 'heart-outline'}
              size={16}
              color={isPicked ? primary : textMuted}
            />
          </TouchableOpacity>
        </View>

        {/* 信息区 */}
        <View style={[styles.content, { backgroundColor: cardBg }]}>
          <Text style={[styles.title, { color: textMain }]} numberOfLines={2}>
            {dish.title}
          </Text>

          <View style={styles.footerRow}>
            {/* 分类标签小胶囊 */}
            <View style={[styles.categoryTag, { borderColor: border, backgroundColor: tagBg }]}>
              <Text style={[styles.categoryTagText, { color: primary }]}>{categoryLabel}</Text>
            </View>

            {/* 创建者微头像与昵称 */}
            <View style={styles.creatorWrap}>
              <View style={[styles.creatorAvatar, { backgroundColor: tagBg }]}>
                <Text style={[styles.creatorAvatarText, { color: primary }]}>{creatorInitial}</Text>
              </View>
              <Text style={[styles.creatorName, { color: textMuted }]} numberOfLines={1}>
                {dish.created_by || '我们'}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    width: CARD_WIDTH,
    marginBottom: 14,
  },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    ...shadows.soft,
  },
  imageWrap: {
    width: '100%',
    height: IMAGE_HEIGHT,
    backgroundColor: '#F5EFEB',
    position: 'relative',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAF5EE',
  },
  pickedBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
    gap: 3,
  },
  pickedBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  heartBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
    minHeight: 38,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  categoryTag: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoryTagText: {
    fontSize: 10,
    fontWeight: '600',
  },
  creatorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '55%',
  },
  creatorAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorAvatarText: {
    fontSize: 9,
    fontWeight: '700',
  },
  creatorName: {
    fontSize: 11,
  },
});

export default DishCard;
