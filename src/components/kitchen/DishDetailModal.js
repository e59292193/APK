import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  ScrollView,
  TouchableOpacity,
  Alert,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius, useTheme } from '../../theme';
import { IconButton } from '../ui';
import { CachedImage } from '../../lib/imageCache';
import { CATEGORIES } from '../../lib/kitchenUtils';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

  if (!dish) return null;

  const catConfig = CATEGORIES[dish.category] || CATEGORIES.meat;
  const isCreatedByBaomi = dish.created_by === 'baomi';
  const recipeImages = Array.isArray(dish.recipe_images) ? dish.recipe_images : [];

  const handleConfirmDelete = () => {
    Alert.alert('删除菜品', `确定要删除「${dish.title}」吗？此操作不可撤销。`, [
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
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top > 0 ? insets.top : spacing.sm,
            paddingBottom: insets.bottom > 0 ? insets.bottom : spacing.md,
          },
        ]}
      >
        {/* Navigation bar */}
        <View style={[styles.header, { borderBottomColor: colors.borderLight }]}>
          <IconButton
            name="close"
            size={22}
            color={colors.textSecondary}
            onPress={onClose}
            accessibilityLabel="关闭详情"
          />
          <View style={styles.headerActions}>
            <IconButton
              name="create-outline"
              size={20}
              color={colors.textSecondary}
              onPress={() => {
                onClose();
                onEdit && onEdit(dish);
              }}
              accessibilityLabel="编辑菜品"
            />
            <IconButton
              name="trash-outline"
              size={20}
              color={colors.error}
              onPress={handleConfirmDelete}
              accessibilityLabel="删除菜品"
            />
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Main Cover Image */}
          {dish.image_path ? (
            <View style={[styles.coverWrap, { backgroundColor: colors.surfaceVariant }]}>
              <CachedImage
                path={dish.image_path}
                style={styles.coverImage}
                resizeMode="cover"
              />
            </View>
          ) : (
            <View
              style={[
                styles.coverWrap,
                styles.placeholderCover,
                { backgroundColor: colors.surfaceVariant },
              ]}
            >
              <Text style={styles.placeholderEmoji}>{catConfig.icon}</Text>
              <Text style={[styles.placeholderText, { color: colors.textTertiary }]}>
                暂无菜品封面图
              </Text>
            </View>
          )}

          {/* Dish Header Info */}
          <View style={styles.titleSection}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                {dish.title || '未命名菜品'}
              </Text>
              <View
                style={[
                  styles.categoryTag,
                  { backgroundColor: colors.primary ? colors.primary[50] : colors.meSoft },
                ]}
              >
                <Text style={styles.categoryTagEmoji}>{catConfig.icon}</Text>
                <Text style={[styles.categoryTagText, { color: colors.primaryAction }]}>
                  {catConfig.label}
                </Text>
              </View>
            </View>

            <View style={styles.creatorRow}>
              <Text style={[styles.creatorLabel, { color: colors.textMuted }]}>
                由 {isCreatedByBaomi ? '苞米' : 'momo'} 于{' '}
                {dish.created_at ? dish.created_at.slice(0, 10) : '近期'} 收录
              </Text>
            </View>
          </View>

          {/* Recipe Text */}
          <View style={[styles.recipeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.recipeHeader}>
              <Text style={styles.recipeHeaderEmoji}>📖</Text>
              <Text style={[styles.recipeSectionTitle, { color: colors.textPrimary }]}>
                做法秘籍 / 食材备注
              </Text>
            </View>

            {dish.recipe_text ? (
              <Text style={[styles.recipeText, { color: colors.textSecondary }]}>
                {dish.recipe_text}
              </Text>
            ) : (
              <Text style={[styles.noRecipeText, { color: colors.textMuted }]}>
                主人很懒，还没写下独家秘方哦~ 点击右上角编辑补充配方吧！
              </Text>
            )}
          </View>

          {/* Recipe Step Images */}
          {recipeImages.length > 0 && (
            <View style={styles.imagesSection}>
              <View style={styles.recipeHeader}>
                <Text style={styles.recipeHeaderEmoji}>📸</Text>
                <Text style={[styles.recipeSectionTitle, { color: colors.textPrimary }]}>
                  步骤与成品图 ({recipeImages.length})
                </Text>
              </View>

              <View style={styles.recipeImagesGrid}>
                {recipeImages.map((imgPath, idx) => (
                  <View
                    key={`${imgPath}-${idx}`}
                    style={[
                      styles.recipeImageWrapper,
                      { backgroundColor: colors.surfaceSoft, borderColor: colors.border },
                    ]}
                  >
                    <CachedImage
                      path={imgPath}
                      style={styles.recipeStepImage}
                      resizeMode="cover"
                    />
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        {/* Bottom CTA */}
        <View style={[styles.bottomBar, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.pickActionBtn,
              {
                backgroundColor: isPickedThisWeek ? colors.surfaceSoft : colors.primaryAction,
                borderColor: isPickedThisWeek ? colors.border : colors.primaryAction,
              },
            ]}
            activeOpacity={0.8}
            onPress={() => onTogglePick && onTogglePick(dish)}
          >
            <Ionicons
              name={isPickedThisWeek ? 'checkmark-circle' : 'heart'}
              size={20}
              color={isPickedThisWeek ? colors.primaryAction : '#FFFFFF'}
            />
            <Text
              style={[
                styles.pickActionBtnText,
                { color: isPickedThisWeek ? colors.primaryAction : '#FFFFFF' },
              ]}
            >
              {isPickedThisWeek ? '本周已选（点击取消）' : '本周想吃 ❤️'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  coverWrap: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 0.68,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  placeholderCover: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderEmoji: {
    fontSize: 54,
    marginBottom: spacing.xs,
  },
  placeholderText: {
    ...typography.caption,
  },
  titleSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  title: {
    ...typography.headline,
    fontWeight: '700',
    flex: 1,
  },
  categoryTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  categoryTagEmoji: {
    fontSize: 14,
    marginRight: 4,
  },
  categoryTagText: {
    ...typography.caption,
    fontWeight: '700',
  },
  creatorRow: {
    marginTop: spacing.xs,
  },
  creatorLabel: {
    ...typography.caption,
  },
  recipeCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  recipeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  recipeHeaderEmoji: {
    fontSize: 16,
    marginRight: spacing.xs,
  },
  recipeSectionTitle: {
    ...typography.title,
    fontWeight: '700',
  },
  recipeText: {
    ...typography.body,
    lineHeight: 22,
  },
  noRecipeText: {
    ...typography.body,
    fontStyle: 'italic',
  },
  imagesSection: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  recipeImagesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  recipeImageWrapper: {
    width: (SCREEN_WIDTH - spacing.lg * 2 - spacing.sm) / 2,
    height: (SCREEN_WIDTH - spacing.lg * 2 - spacing.sm) / 2,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  recipeStepImage: {
    width: '100%',
    height: '100%',
  },
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pickActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radius.full,
    borderWidth: 1,
    gap: spacing.xs,
  },
  pickActionBtnText: {
    ...typography.title,
    fontWeight: '700',
  },
});
