// ═══════════════════════════════════════════════════════
// MomiKitchenScreen —— momi厨房 (功能9 UI 全面优化 & 功能2 入口)
// 暖橙温暖美食风、渐变 Header、momi小助手入口、本周想吃横向滑动卡片、双列瀑布网格
// ═══════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePolling } from '../hooks/usePolling';
import { supabase } from '../lib/supabase';
import { typography, spacing, radius, shadows, useTheme } from '../theme';
import { CenterToast } from '../components/ui';
import {
  DishCard,
  DishEditModal,
  DishDetailModal,
  WeeklyPicksModal,
} from '../components/kitchen';
import {
  getMondayOfWeek,
  formatWeekRangeDisplay,
  fetchDishes,
  fetchWeeklyPicks,
  toggleWeeklyPick,
  removeWeeklyPick,
  clearWeeklyPicks,
  deleteDish,
} from '../lib/kitchenUtils';
import { CachedImage } from '../lib/imageCache';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const CATEGORIES_DATA = [
  { key: 'meat', label: '荤菜', icon: '🥩' },
  { key: 'veg', label: '蔬菜', icon: '🥗' },
  { key: 'snack', label: '小吃', icon: '🥟' },
];

export default function MomiKitchenScreen({
  userId,
  onBack,
  onNavigateMomiAssistant,
}) {
  const insets = useSafeAreaInsets();
  const { theme, colors } = useTheme();
  const primary = colors.primary || '#FF6B35';
  const bg = colors.background || '#FAFAF7';
  const cardBg = colors.card || '#FFFFFF';
  const textMain = colors.text || '#2D1B00';
  const textMuted = colors.textSecondary || '#8B7355';
  const border = colors.border || '#FFD6C7';

  // ─── State ───
  const [selectedCategory, setSelectedCategory] = useState('meat');
  const [dishes, setDishes] = useState([]);
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modals state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingDish, setEditingDish] = useState(null);

  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedDish, setSelectedDish] = useState(null);

  const [weeklyModalVisible, setWeeklyModalVisible] = useState(false);

  // Toast state
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const currentWeekStart = useMemo(() => getMondayOfWeek(), []);

  const pickedDishIdMap = useMemo(() => {
    const map = new Set();
    for (const p of picks) {
      if (p.dish_id) map.add(p.dish_id);
    }
    return map;
  }, [picks]);

  // 本周想吃关联的菜品列表
  const weeklyPickedDishes = useMemo(() => {
    return dishes.filter((d) => pickedDishIdMap.has(d.id));
  }, [dishes, pickedDishIdMap]);

  // 本周想吃清单（关联完整菜品对象，用于周清单弹窗展示）
  const enrichedPicks = useMemo(() => {
    const dishMap = new Map(dishes.map((d) => [d.id, d]));
    return picks
      .map((p) => {
        const dish = p.dish || dishMap.get(p.dish_id);
        return {
          ...p,
          dish: dish || null,
        };
      })
      .filter((p) => Boolean(p.dish));
  }, [picks, dishes]);

  // 按分类过滤菜品
  const filteredDishes = useMemo(() => {
    return dishes.filter((d) => {
      if (selectedCategory === 'veg') {
        return d.category === 'veg' || d.category === 'vegetable';
      }
      return d.category === selectedCategory;
    });
  }, [dishes, selectedCategory]);

  // ─── 数据加载 ───
  const loadData = useCallback(async () => {
    try {
      const [dishesData, picksData] = await Promise.all([
        fetchDishes(null, 'momo_and_baomi'),
        fetchWeeklyPicks(currentWeekStart, 'momo_and_baomi'),
      ]);
      setDishes(dishesData || []);
      setPicks(picksData || []);
    } catch (err) {
      console.warn('[MomiKitchen] 数据加载失败:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentWeekStart]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 15 秒轮询兜底
  usePolling(loadData, 15000);

  // 实时订阅 Supabase
  useEffect(() => {
    const channel = supabase
      .channel('kitchen_realtime_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'kitchen_dishes' },
        () => loadData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'kitchen_weekly_picks' },
        () => loadData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  // 切换本周想吃
  const handleTogglePick = async (dish) => {
    try {
      const res = await toggleWeeklyPick({
        dishId: dish.id,
        weekStart: currentWeekStart,
        userId: userId || 'momo',
        coupleId: 'momo_and_baomi',
      });

      if (res && res.action === 'picked') {
        setToastMessage('momi厨房正在准备食材，请耐心等待哦~ 🍲');
        setToastVisible(true);
      }
      loadData();
    } catch (err) {
      console.error('[MomiKitchen] 切换本周想吃失败:', err);
    }
  };

  // 删除菜品
  const handleDeleteDish = async (dishId) => {
    try {
      await deleteDish(dishId);
      setDishes((prev) => prev.filter((d) => d.id !== dishId));
      setPicks((prev) => prev.filter((p) => p.dish_id !== dishId));
      if (selectedDish && selectedDish.id === dishId) {
        setDetailModalVisible(false);
        setSelectedDish(null);
      }
    } catch (err) {
      console.error('[MomiKitchen] 删除菜品失败:', err);
      Alert.alert('删除失败', '请稍后重试');
    }
  };

  // 移除本周想吃
  const handleRemoveWeeklyPick = async (dishIdOrPickId) => {
    try {
      const targetPick = picks.find(
        (p) => p.id === dishIdOrPickId || p.dish_id === dishIdOrPickId
      );
      const targetDishId = targetPick ? targetPick.dish_id : dishIdOrPickId;
      await removeWeeklyPick(targetDishId, currentWeekStart, 'momo_and_baomi');
      await loadData();
    } catch (err) {
      console.warn('[MomiKitchen] 移除本周想吃失败:', err.message);
    }
  };

  // 一键清空本周想吃
  const handleClearWeeklyPicks = async () => {
    try {
      await clearWeeklyPicks(currentWeekStart, 'momo_and_baomi');
      await loadData();
    } catch (err) {
      console.warn('[MomiKitchen] 清空本周想吃失败:', err.message);
    }
  };

  const handleDishSaved = (savedDish) => {
    setEditModalVisible(false);
    setEditingDish(null);
    if (!savedDish) {
      loadData();
      return;
    }
    const dishObj = Array.isArray(savedDish?.data)
      ? savedDish.data[0]
      : (savedDish?.data || savedDish);
    if (dishObj && dishObj.id) {
      setDishes((prev) => {
        const idx = prev.findIndex((d) => d.id === dishObj.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = dishObj;
          return next;
        }
        return [dishObj, ...prev];
      });
      if (selectedDish && selectedDish.id === dishObj.id) {
        setSelectedDish(dishObj);
      }
    }
    loadData();
  };

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <CenterToast
        visible={toastVisible}
        message={toastMessage}
        duration={2400}
        onDismiss={() => setToastVisible(false)}
      />

      {/* 顶部 Header：活力主题背景 + momi 助手入口 */}
      <View style={[styles.headerWrap, { paddingTop: insets.top + 8, backgroundColor: primary }]}>
        <View style={styles.headerBar}>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={onBack}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="返回"
          >
            <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>momi厨房</Text>
            <Text style={styles.headerSubtitle}>今天吃什么？两人挑一挑 🍳</Text>
          </View>

          <View style={styles.headerRightActions}>
            {/* momi 助手入口图标按钮 (功能2) */}
            <TouchableOpacity
              style={styles.assistantBtn}
              activeOpacity={0.8}
              onPress={onNavigateMomiAssistant}
              accessibilityLabel="打开 momi 小助手"
            >
              <Text style={{ fontSize: 16 }}>🐾</Text>
              <Text style={[styles.assistantBtnText, { color: primary }]}>小助手</Text>
            </TouchableOpacity>

            {/* 本周菜单胶囊按钮 */}
            <TouchableOpacity
              style={styles.weeklyMenuPill}
              activeOpacity={0.8}
              onPress={() => setWeeklyModalVisible(true)}
              accessibilityLabel="本周菜单"
            >
              <Ionicons name="restaurant-outline" size={14} color="#FFFFFF" />
              <Text style={styles.weeklyMenuPillText}>本周菜单</Text>
              {picks.length > 0 && (
                <View style={styles.picksBadge}>
                  <Text style={[styles.picksBadgeText, { color: primary }]}>{picks.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* 分类 Tab 栏 (圆角胶囊样式) */}
        <View style={styles.tabContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabScrollContent}
          >
            {CATEGORIES_DATA.map((cat) => {
              const active = selectedCategory === cat.key;
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[styles.categoryPill, active && [styles.categoryPillActive, { backgroundColor: cardBg }]]}
                  activeOpacity={0.8}
                  onPress={() => setSelectedCategory(cat.key)}
                >
                  <Text style={{ fontSize: 16, marginRight: 6 }}>{cat.icon}</Text>
                  <Text style={[styles.categoryPillText, active && [styles.categoryPillTextActive, { color: primary }]]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {/* 主内容区 */}
      <ScrollView
        style={styles.mainScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadData();
            }}
            tintColor={primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* 「本周想吃」横向卡片滑动列表 (功能9) */}
        <View style={styles.weeklySection}>
          <View style={styles.weeklySectionHeader}>
            <View style={styles.weeklyTitleRow}>
              <Ionicons name="heart" size={18} color={primary} />
              <Text style={[styles.weeklyTitle, { color: textMain }]}>本周想吃</Text>
              <View style={[styles.weekDateBadge, { backgroundColor: colors.primarySoft || bg }]}>
                <Text style={[styles.weekDateText, { color: primary }]}>{formatWeekRangeDisplay(currentWeekStart)}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => setWeeklyModalVisible(true)}>
              <Text style={[styles.weeklyDetailLink, { color: textMuted }]}>查看清单 ({picks.length}) ›</Text>
            </TouchableOpacity>
          </View>

          {weeklyPickedDishes.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.weeklyCardsScroll}
            >
              {weeklyPickedDishes.map((dish) => (
                <TouchableOpacity
                  key={`pick-${dish.id}`}
                  style={[styles.weeklyCard, { backgroundColor: cardBg, borderColor: border }]}
                  activeOpacity={0.9}
                  onPress={() => {
                    setSelectedDish(dish);
                    setDetailModalVisible(true);
                  }}
                >
                  <CachedImage
                    source={dish.image_path}
                    style={styles.weeklyCardImage}
                    contentFit="cover"
                    previewable={false}
                  />
                  <View style={styles.weeklyCardInfo}>
                    <Text style={[styles.weeklyCardTitle, { color: textMain }]} numberOfLines={1}>
                      {dish.title}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <View style={[styles.weeklyEmptyCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Ionicons name="cart-outline" size={24} color={textMuted} />
              <Text style={[styles.weeklyEmptyText, { color: textMuted }]}>本周还没有挑中想吃的菜，在下方卡片点个心吧~</Text>
            </View>
          )}
        </View>

        {/* 菜品瀑布流网格 */}
        <View style={styles.gridSection}>
          <View style={styles.gridSectionHeader}>
            <Text style={[styles.gridSectionTitle, { color: textMain }]}>
              {CATEGORIES_DATA.find((c) => c.key === selectedCategory)?.label || '菜品'}
              {' '}({filteredDishes.length})
            </Text>
          </View>

          {loading ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="large" color={primary} />
              <Text style={[styles.loadingText, { color: textMuted }]}>正在为您准备菜单...</Text>
            </View>
          ) : filteredDishes.length > 0 ? (
            <View style={styles.dishGrid}>
              {filteredDishes.map((dish) => (
                <DishCard
                  key={dish.id}
                  dish={dish}
                  isPicked={pickedDishIdMap.has(dish.id)}
                  onPress={() => {
                    setSelectedDish(dish);
                    setDetailModalVisible(true);
                  }}
                  onTogglePick={() => handleTogglePick(dish)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyGrid}>
              <Ionicons name="restaurant-outline" size={48} color={textMuted} />
              <Text style={[styles.emptyGridTitle, { color: textMain }]}>这个分类还没有菜品呢</Text>
              <Text style={[styles.emptyGridDesc, { color: textMuted }]}>点击下方按钮或右下角加号，记录你们爱吃的美食吧！</Text>
              <TouchableOpacity
                style={[styles.emptyAddBtn, { backgroundColor: primary }]}
                activeOpacity={0.85}
                onPress={() => {
                  setEditingDish(null);
                  setEditModalVisible(true);
                }}
              >
                <Ionicons name="add" size={18} color="#FFFFFF" />
                <Text style={styles.emptyAddBtnText}>添加新菜品</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* FAB 悬浮添加按钮 (右下角主题色圆形，阴影效果) */}
      <TouchableOpacity
        style={[
          styles.fabBtn,
          {
            bottom: insets.bottom + 24,
            backgroundColor: primary,
            shadowColor: primary,
          },
        ]}
        activeOpacity={0.88}
        onPress={() => {
          setEditingDish(null);
          setEditModalVisible(true);
        }}
        accessibilityLabel="添加新菜品"
      >
        <Ionicons name="add" size={32} color="#FFFFFF" />
      </TouchableOpacity>

      {/* 菜品编辑抽屉 (功能1 & 功能9) */}
      <DishEditModal
        visible={editModalVisible}
        dish={editingDish}
        userId={userId}
        onClose={() => setEditModalVisible(false)}
        onSaved={handleDishSaved}
        onDeleted={handleDeleteDish}
      />

      {/* 菜品详情全屏 (功能9) */}
      <DishDetailModal
        visible={detailModalVisible}
        dish={selectedDish}
        isPickedThisWeek={selectedDish ? pickedDishIdMap.has(selectedDish.id) : false}
        onClose={() => setDetailModalVisible(false)}
        onTogglePick={handleTogglePick}
        onEdit={(dish) => {
          setEditingDish(dish);
          setEditModalVisible(true);
        }}
        onDelete={handleDeleteDish}
      />

      {/* 本周菜单清单 Modal */}
      <WeeklyPicksModal
        visible={weeklyModalVisible}
        picks={enrichedPicks}
        weekStart={currentWeekStart}
        coupleId="momo_and_baomi"
        userId={userId}
        onClose={() => setWeeklyModalVisible(false)}
        onPicksChanged={loadData}
        onRemovePick={handleRemoveWeeklyPick}
        onClearPicks={handleClearWeeklyPicks}
        onSelectDish={(dish) => {
          setWeeklyModalVisible(false);
          setSelectedDish(dish);
          setDetailModalVisible(true);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerWrap: {
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    paddingBottom: 14,
    ...shadows.soft,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    marginBottom: 10,
  },
  headerBtn: {
    padding: 6,
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: 6,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.88)',
    marginTop: 2,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  assistantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    gap: 4,
    ...shadows.soft,
  },
  assistantBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  weeklyMenuPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    gap: 4,
  },
  weeklyMenuPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  picksBadge: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  picksBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  tabContainer: {
    paddingHorizontal: spacing[3],
    marginTop: 4,
  },
  tabScrollContent: {
    flexDirection: 'row',
    gap: 8,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  categoryPillActive: {
    ...shadows.soft,
  },
  categoryPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.92)',
  },
  categoryPillTextActive: {
    fontWeight: '700',
  },
  mainScroll: {
    flex: 1,
  },
  weeklySection: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  weeklySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  weeklyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  weeklyTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  weekDateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  weekDateText: {
    fontSize: 11,
    fontWeight: '600',
  },
  weeklyDetailLink: {
    fontSize: 12,
    fontWeight: '600',
  },
  weeklyCardsScroll: {
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 4,
  },
  weeklyCard: {
    width: 140,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    ...shadows.soft,
  },
  weeklyCardImage: {
    width: 140,
    height: 105, // 4:3 比例
  },
  weeklyCardInfo: {
    padding: 8,
    alignItems: 'center',
  },
  weeklyCardTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  weeklyEmptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
  },
  weeklyEmptyText: {
    fontSize: 12,
    flex: 1,
  },
  gridSection: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
  },
  gridSectionHeader: {
    marginBottom: 12,
  },
  gridSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  dishGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  centerLoading: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 13,
    marginTop: 8,
  },
  emptyGrid: {
    alignItems: 'center',
    paddingVertical: 50,
  },
  emptyGridTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 10,
  },
  emptyGridDesc: {
    fontSize: 12,
    marginTop: 4,
  },
  fabBtn: {
    position: 'absolute',
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 16,
    elevation: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  emptyAddBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
