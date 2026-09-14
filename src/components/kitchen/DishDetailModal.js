// ═══════════════════════════════════════════════════════
// DishDetailModal —— 菜品大图沉浸式详情 (功能9 UI 全面优化)
// 40% 屏幕大图、渐变大标题、24px 圆角白色卡片、食材分组、带圈数字步骤、底部操作栏
// ═══════════════════════════════════════════════════════

import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors as COLORS, typography, spacing, radius, shadows, useTheme } from '../../theme';
import { CachedImage } from '../../lib/imageCache';
import { CATEGORIES } from '../../lib/kitchenUtils';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = Math.floor(SCREEN_HEIGHT * 0.4);

/**
 * 将菜谱文本智能解析为食材与步骤
 */
function parseRecipeText(rawText) {
  if (!rawText) return { ingredients: [], steps: [] };

  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  const ingredients = [];
  const steps = [];
  let currentSection = 'ingredients';

  for (const line of lines) {
    if (line.includes('【步骤】') || line.startsWith('步骤') || line.startsWith('做法')) {
      currentSection = 'steps';
      continue;
    }
    if (line.includes('【食材】') || line.startsWith('食材') || line.startsWith('用料')) {
      currentSection = 'ingredients';
      continue;
    }

    if (currentSection === 'ingredients') {
      // 匹配 "- 鸡蛋：2个" 或 "鸡蛋 2个"
      const clean = line.replace(/^[-*•\s]+/, '');
      if (clean) ingredients.push(clean);
    } else {
      // 匹配 "1. xxx" 或直接文本
      const clean = line.replace(/^\d+[\.、\s]+/, '');
      if (clean) steps.push(clean);
    }
  }

  // 如果未能分组，根据是否有数字序号智能兜底
  if (steps.length === 0 && ingredients.length > 0) {
    return {
      ingredients: [],
      steps: lines,
    };
  }

  return { ingredients, steps };
}

export function DishDetailModal({
  visible,
  dish,
  isPickedThisWeek = false,
  onClose,
  onTogglePick,
  onEdit,
  onDelete,
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const primary = colors.primary || '#FF6B35';
  const cardBg = colors.card || '#FFFFFF';
  const textMain = colors.text || '#2D1B00';
  const textMuted = colors.textSecondary || '#8B7355';
  const border = colors.border || '#F2ECE4';
  const bg = colors.background || '#FAF8F5';

  if (!dish) return null;

  const catConfig = CATEGORIES[dish.category] || CATEGORIES.meat;
  const recipeImages = Array.isArray(dish.recipe_images) ? dish.recipe_images : [];
  const { ingredients, steps } = parseRecipeText(dish.recipe_text);

  const handleConfirmDelete = () => {
    Alert.alert('删除菜品', `确定要删除「${dish.title}」吗？删除后不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          onClose();
          onDelete && onDelete(dish.id);
        },
      },
    ]);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
          showsVerticalScrollIndicator={false}
          bounces={true}
        >
          {/* 顶部 40% 屏幕大图 */}
          <View style={[styles.heroWrap, { height: HERO_HEIGHT }]}>
            {dish.image_path ? (
              <CachedImage
                source={dish.image_path}
                style={styles.heroImage}
                contentFit="cover"
                previewable={true}
              />
            ) : (
              <View style={styles.placeholderHero}>
                <Ionicons name="restaurant-outline" size={56} color="#D8C9BB" />
              </View>
            )}

            {/* 渐变遮罩 (深色蒙版使大标题清晰可见) */}
            <View style={styles.gradientOverlay}>
              <View style={styles.heroHeaderInfo}>
                <View style={styles.categoryCapsule}>
                  <Text style={{ fontSize: 13, marginRight: 4 }}>{catConfig.icon}</Text>
                  <Text style={styles.categoryCapsuleText}>{catConfig.label}</Text>
                </View>
                <Text style={styles.heroTitle}>{dish.title}</Text>
                <Text style={styles.heroMeta}>
                  收录于 {dish.created_by || '我们'} · {dish.created_at ? dish.created_at.slice(0, 10) : '今日'}
                </Text>
              </View>
            </View>

            {/* 浮动返回与删除按钮 */}
            <TouchableOpacity
              style={[styles.floatingCircleBtn, { top: insets.top + 10, left: 16 }]}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Ionicons name="chevron-down" size={24} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.floatingCircleBtn, { top: insets.top + 10, right: 16 }]}
              onPress={handleConfirmDelete}
              activeOpacity={0.8}
            >
              <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* 内容区卡片 (顶部圆角 24px，向上轻叠大图) */}
          <View style={styles.contentCard}>
            {/* 食材清单 */}
            {ingredients.length > 0 && (
              <View style={styles.detailSection}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="leaf-outline" size={20} color={COLORS.primary} />
                  <Text style={styles.sectionTitle}>准备食材 ({ingredients.length})</Text>
                </View>
                <View style={styles.ingredientsGrid}>
                  {ingredients.map((item, idx) => (
                    <View key={`ing-${idx}`} style={styles.ingredientChip}>
                      <View style={styles.ingDot} />
                      <Text style={styles.ingredientText}>{item}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* 烹饪步骤 (带序号圆圈 + 分隔线) */}
            {steps.length > 0 ? (
              <View style={styles.detailSection}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="flame-outline" size={20} color={COLORS.primary} />
                  <Text style={styles.sectionTitle}>烹饪秘籍步骤</Text>
                </View>
                <View style={styles.stepsList}>
                  {steps.map((step, idx) => (
                    <View key={`step-${idx}`} style={styles.stepItemRow}>
                      <View style={styles.stepNumCircle}>
                        <Text style={styles.stepNumText}>{idx + 1}</Text>
                      </View>
                      <View style={styles.stepContentWrap}>
                        <Text style={styles.stepDesc}>{step}</Text>
                        {idx < steps.length - 1 && <View style={styles.stepDivider} />}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : dish.recipe_text ? (
              <View style={styles.detailSection}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="restaurant-outline" size={20} color={COLORS.primary} />
                  <Text style={styles.sectionTitle}>秘籍说明</Text>
                </View>
                <Text style={styles.recipeRawText}>{dish.recipe_text}</Text>
              </View>
            ) : (
              <View style={styles.detailSection}>
                <Text style={styles.emptyRecipeText}>
                  还没有记录烹饪秘籍，点击底部「编辑」按钮添加详细用料与步骤吧~
                </Text>
              </View>
            )}

            {/* 食谱多图相册 */}
            {recipeImages.length > 0 && (
              <View style={styles.detailSection}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="images-outline" size={20} color={COLORS.primary} />
                  <Text style={styles.sectionTitle}>笔记与步骤图</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recipeGallery}>
                  {recipeImages.map((uri, idx) => (
                    <CachedImage
                      key={`gallery-${idx}`}
                      source={uri}
                      style={styles.galleryThumb}
                      contentFit="cover"
                      previewable={true}
                    />
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        </ScrollView>

        {/* 底部吸底操作栏 (「加入本周」「编辑」) */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TouchableOpacity
            style={[
              styles.pickToggleBtn,
              { borderColor: primary },
              isPickedThisWeek && [styles.pickToggleBtnActive, { backgroundColor: primary, borderColor: primary }],
            ]}
            onPress={() => onTogglePick && onTogglePick(dish)}
            activeOpacity={0.85}
          >
            <Ionicons
              name={isPickedThisWeek ? 'heart' : 'heart-outline'}
              size={18}
              color={isPickedThisWeek ? '#FFFFFF' : primary}
            />
            <Text
              style={[
                styles.pickToggleText,
                { color: primary },
                isPickedThisWeek && styles.pickToggleTextActive,
              ]}
            >
              {isPickedThisWeek ? '已在想吃清单' : '加入本周想吃'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.editBtn, { backgroundColor: primary }]}
            onPress={() => {
              onClose();
              onEdit && onEdit(dish);
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="create-outline" size={18} color="#FFFFFF" />
            <Text style={styles.editBtnText}>编辑菜品</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF8F5',
  },
  scroll: {
    flex: 1,
  },
  heroWrap: {
    width: SCREEN_WIDTH,
    position: 'relative',
    backgroundColor: '#EFE7DE',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  placeholderHero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5EFE6',
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 160,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing[5],
    paddingBottom: 28,
  },
  heroHeaderInfo: {},
  categoryCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginBottom: 6,
  },
  categoryCapsuleText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  heroMeta: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 4,
  },
  floatingCircleBtn: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentCard: {
    backgroundColor: COLORS.cardBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -20,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    minHeight: 400,
    ...shadows.soft,
  },
  detailSection: {
    marginBottom: spacing[5],
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing[3],
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textMain,
  },
  ingredientsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ingredientChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7F2',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FFE3D6',
  },
  ingDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.primary,
    marginRight: 6,
  },
  ingredientText: {
    fontSize: 13,
    color: COLORS.textMain,
    fontWeight: '500',
  },
  stepsList: {
    marginTop: 4,
  },
  stepItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepNumCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  stepNumText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  stepContentWrap: {
    flex: 1,
  },
  stepDesc: {
    fontSize: 14,
    color: COLORS.textMain,
    lineHeight: 22,
  },
  stepDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 12,
  },
  recipeRawText: {
    fontSize: 14,
    color: COLORS.textMain,
    lineHeight: 22,
    backgroundColor: '#FAF7F2',
    padding: spacing[3],
    borderRadius: radius.md,
  },
  emptyRecipeText: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 20,
    textAlign: 'center',
    paddingVertical: spacing[3],
  },
  recipeGallery: {
    flexDirection: 'row',
    marginTop: 4,
  },
  galleryThumb: {
    width: 110,
    height: 110,
    borderRadius: radius.md,
    marginRight: 10,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingTop: 10,
    gap: 12,
    ...shadows.soft,
  },
  pickToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: '#FFFFFF',
  },
  pickToggleBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  pickToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
  pickToggleTextActive: {
    color: '#FFFFFF',
  },
  editBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#3D3025',
  },
  editBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
