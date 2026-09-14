import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius, useTheme } from '../../theme';
import { IconButton } from '../ui';
import { CachedImage } from '../../lib/imageCache';
import { CATEGORIES, formatWeekRangeDisplay } from '../../lib/kitchenUtils';

export function WeeklyPicksModal({
  visible,
  picks = [],
  weekStart,
  onClose,
  onRemovePick,
  onClearPicks,
  onSelectDish,
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const handleConfirmClear = () => {
    Alert.alert(
      '清空本周菜单',
      '确定要清空本周的所有想吃菜品吗？两人都会清空哦~',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定清空',
          style: 'destructive',
          onPress: () => onClearPicks && onClearPicks(),
        },
      ]
    );
  };

  const handleConfirmRemove = (pick) => {
    const dishTitle = pick.dish?.title || '该菜品';
    Alert.alert('移除菜品', `确定将「${dishTitle}」从本周菜单移除吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => onRemovePick && onRemovePick(pick.dish_id || pick.id),
      },
    ]);
  };

  // 分类归集
  const groupedPicks = {
    meat: picks.filter((p) => (p.dish?.category || 'meat') === 'meat'),
    veg: picks.filter((p) => p.dish?.category === 'veg' || p.dish?.category === 'vegetable'),
    snack: picks.filter((p) => p.dish?.category === 'snack'),
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
            paddingTop: insets.top > 0 ? insets.top : spacing.md,
            paddingBottom: insets.bottom > 0 ? insets.bottom : spacing.md,
          },
        ]}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerTitleWrap}>
            <View style={styles.titleRow}>
              <Text style={styles.titleEmoji}>📋</Text>
              <Text style={[styles.title, { color: colors.textPrimary || colors.text }]}>本周想吃菜单</Text>
              <View style={[styles.countBadge, { backgroundColor: colors.primary ? (colors.primary + '20') : '#FFF0EB' }]}>
                <Text style={[styles.countBadgeText, { color: colors.primary || '#FF6B35' }]}>
                  共 {picks.length} 道
                </Text>
              </View>
            </View>
            <Text style={[styles.weekRange, { color: colors.textMuted || colors.textSecondary }]}>
              {formatWeekRangeDisplay(weekStart)}
            </Text>
          </View>
          <IconButton
            name="close"
            size={22}
            color={colors.textSecondary || colors.text}
            onPress={onClose}
            accessibilityLabel="关闭本周菜单"
          />
        </View>

        {/* Content */}
        {picks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={[styles.emptyIconBg, { backgroundColor: colors.surfaceSoft }]}>
              <Ionicons name="restaurant-outline" size={48} color={colors.textMuted} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
              本周菜单还是空的呢~
            </Text>
            <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
              快去菜品列表挑选想吃的美食，点亮「本周想吃」吧！
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {Object.keys(groupedPicks).map((catKey) => {
              const catConfig = CATEGORIES[catKey] || { label: catKey, icon: '🍲' };
              const list = groupedPicks[catKey];
              if (!list || list.length === 0) return null;

              return (
                <View key={catKey} style={styles.categorySection}>
                  <View style={styles.categoryHeader}>
                    <Text style={styles.categoryEmoji}>{catConfig.icon}</Text>
                    <Text style={[styles.categoryTitle, { color: colors.textPrimary }]}>
                      {catConfig.label}
                    </Text>
                    <Text style={[styles.categoryCount, { color: colors.textMuted }]}>
                      ({list.length})
                    </Text>
                  </View>

                  <View style={styles.itemsList}>
                    {list.map((item) => {
                      const dish = item.dish || {};
                      const isPickedByBaomi = item.picked_by === 'baomi';

                      return (
                        <TouchableOpacity
                          key={item.id}
                          style={[
                            styles.itemCard,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                            },
                          ]}
                          activeOpacity={0.7}
                          onPress={() => onSelectDish && onSelectDish(dish)}
                        >
                          {dish.image_path ? (
                            <CachedImage
                              path={dish.image_path}
                              style={styles.itemThumb}
                              resizeMode="cover"
                            />
                          ) : (
                            <View
                              style={[
                                styles.itemThumbPlaceholder,
                                { backgroundColor: colors.surfaceSoft },
                              ]}
                            >
                              <Ionicons
                                name="fast-food-outline"
                                size={22}
                                color={colors.textMuted}
                              />
                            </View>
                          )}

                          <View style={styles.itemInfo}>
                            <Text
                              style={[styles.itemTitle, { color: colors.textPrimary }]}
                              numberOfLines={1}
                            >
                              {dish.title || '未命名菜品'}
                            </Text>

                            <View style={styles.itemMeta}>
                                <View
                                  style={[
                                    styles.pickerBadge,
                                    {
                                      backgroundColor: isPickedByBaomi
                                        ? (colors.accent ? colors.accent + '20' : '#E8F5E9')
                                        : (colors.primary ? colors.primary + '20' : '#FFF0EB'),
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.pickerBadgeText,
                                      {
                                        color: isPickedByBaomi
                                          ? (colors.accent || '#4CAF50')
                                          : (colors.primary || '#FF6B35'),
                                      },
                                    ]}
                                  >
                                    {item.picked_by === 'momo'
                                      ? 'momo 想吃'
                                      : item.picked_by === 'baomi'
                                      ? '苞米 想吃'
                                      : '想吃'}
                                  </Text>
                                </View>
                              {dish.recipe_text ? (
                                <Text style={[styles.hasRecipeText, { color: colors.textMuted }]}>
                                  配方已备好
                                </Text>
                              ) : null}
                            </View>
                          </View>

                          <TouchableOpacity
                            style={[
                              styles.removeBtn,
                              { backgroundColor: colors.surfaceSoft },
                            ]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            onPress={() => handleConfirmRemove(item)}
                            accessibilityLabel={`从本周菜单移除${dish.title}`}
                          >
                            <Ionicons name="trash-outline" size={16} color={colors.error} />
                          </TouchableOpacity>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Footer */}
        {picks.length > 0 && (
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.clearBtn, { borderColor: colors.border }]}
              activeOpacity={0.7}
              onPress={handleConfirmClear}
            >
              <Ionicons name="trash-bin-outline" size={16} color={colors.error} />
              <Text style={[styles.clearBtnText, { color: colors.error }]}>一键清空本周菜单</Text>
            </TouchableOpacity>
          </View>
        )}
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleWrap: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleEmoji: {
    fontSize: 20,
    marginRight: spacing.xs,
  },
  title: {
    ...typography.headline,
    fontWeight: '700',
  },
  countBadge: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  countBadgeText: {
    ...typography.caption,
    fontWeight: '700',
  },
  weekRange: {
    ...typography.caption,
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.headline,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  emptyDesc: {
    ...typography.body,
    textAlign: 'center',
    lineHeight: 20,
  },
  categorySection: {
    marginBottom: spacing.lg,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  categoryEmoji: {
    fontSize: 16,
    marginRight: spacing.xs,
  },
  categoryTitle: {
    ...typography.title,
    fontWeight: '700',
  },
  categoryCount: {
    ...typography.caption,
    marginLeft: spacing.xs,
  },
  itemsList: {
    gap: spacing.sm,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  itemThumb: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
  },
  itemThumbPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.sm,
  },
  itemTitle: {
    ...typography.title,
    fontWeight: '600',
    marginBottom: 4,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickerBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  pickerBadgeText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
  },
  hasRecipeText: {
    ...typography.caption,
    fontSize: 11,
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  clearBtnText: {
    ...typography.body,
    fontWeight: '600',
    marginLeft: spacing.xs,
  },
});
