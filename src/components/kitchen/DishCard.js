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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// 两列网格卡片宽度（页面两边留 padding，中间留 gap）
const CARD_WIDTH = Math.floor((SCREEN_WIDTH - spacing[4] * 2 - spacing[3]) / 2);
const IMAGE_HEIGHT = Math.floor(CARD_WIDTH * 1.05);

export function DishCard({
  dish,
  isPicked = false,
  onPress,
  onLongPress,
  onTogglePick,
}) {
  const { colors } = useTheme();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      friction: 7,
      tension: 100,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 7,
      tension: 100,
    }).start();
  };

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, styles.wrapper]}>
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: isPicked ? colors.primaryAction : colors.border,
            borderWidth: isPicked ? 1.5 : StyleSheet.hairlineWidth,
          },
        ]}
        activeOpacity={0.9}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={() => onPress && onPress(dish)}
        onLongPress={() => onLongPress && onLongPress(dish)}
      >
        {/* 菜品图片区（约占卡片高度 70%） */}
        <View style={styles.imageWrap}>
          {dish.image_path ? (
            <CachedImage
              source={dish.image_path}
              style={styles.image}
              contentFit="cover"
              previewable={false}
            />
          ) : (
            <View style={[styles.placeholder, { backgroundColor: colors.surfaceSoft }]}>
              <Ionicons name="restaurant-outline" size={36} color={colors.primary[300]} />
            </View>
          )}

          {/* 本周想吃高亮标识 */}
          {isPicked && (
            <View style={[styles.pickedTag, { backgroundColor: colors.primaryAction }]}>
              <Ionicons name="checkmark-circle" size={12} color="#FFFFFF" />
              <Text style={styles.pickedTagText}>想吃</Text>
            </View>
          )}
        </View>

        {/* 标题与快捷操作区 */}
        <View style={styles.content}>
          <Text
            style={[styles.title, { color: colors.textPrimary }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {dish.title}
          </Text>

          <View style={styles.footerRow}>
            {dish.recipe_text || (dish.recipe_images && dish.recipe_images.length > 0) ? (
              <View style={styles.recipeBadge}>
                <Ionicons name="book-outline" size={11} color={colors.textSecondary} />
                <Text style={[styles.recipeBadgeText, { color: colors.textSecondary }]}>有食谱</Text>
              </View>
            ) : (
              <View style={{ flex: 1 }} />
            )}

            <TouchableOpacity
              style={[
                styles.quickPickBtn,
                {
                  backgroundColor: isPicked ? colors.primaryAction : colors.primary[50],
                  borderColor: isPicked ? colors.primaryAction : colors.primary[200],
                },
              ]}
              onPress={() => onTogglePick && onTogglePick(dish)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isPicked ? 'heart' : 'heart-outline'}
                size={14}
                color={isPicked ? '#FFFFFF' : colors.primaryAction}
              />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: CARD_WIDTH,
    marginBottom: spacing[3],
  },
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.sm,
  },
  imageWrap: {
    width: '100%',
    height: IMAGE_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickedTag: {
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
  pickedTagText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  content: {
    padding: spacing[2] + 2,
  },
  title: {
    ...typography.cardTitle,
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 4,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recipeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  recipeBadgeText: {
    fontSize: 10,
  },
  quickPickBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default DishCard;
