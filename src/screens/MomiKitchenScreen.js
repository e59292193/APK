/**
 * MomiKitchenScreen — momi厨房
 *
 * 两人共同打理的美食厨房模块：
 * - 3大分类 Tab：荤菜 / 蔬菜 / 小吃
 * - 菜品双列卡片瀑布流，支持图文菜谱、多图步骤查看
 * - "本周想吃" 点选，按自然周（周一为起点）归集
 * - 触发点选时弹出居中 Toast: "momi厨房正在准备食材，请耐心等待哦~"
 * - 实时同步 (Supabase Realtime)
 * - 菜单一键清空与单道移除
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePolling } from '../hooks/usePolling';
import { supabase } from '../lib/supabase';
import { typography, spacing } from '../theme';
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

const CATEGORY_KEYS = ['meat', 'veg', 'snack'];

const KITCHEN_CATEGORY_CONFIG = {
  meat: {
    key: 'meat',
    label: '荤菜',
    image: require('../../assets/kitchen/cat_meat.png'),
    emptyImage: require('../../assets/kitchen/empty_meat.png'),
  },
  veg: {
    key: 'veg',
    label: '蔬菜',
    image: require('../../assets/kitchen/cat_veg.png'),
    emptyImage: require('../../assets/kitchen/empty_veg.png'),
  },
  snack: {
    key: 'snack',
    label: '小吃',
    image: require('../../assets/kitchen/cat_snack.png'),
    emptyImage: require('../../assets/kitchen/empty_snack.png'),
  },
};

const THEME_BG = '#FAF7EE';

export default function MomiKitchenScreen({ userId, onBack }) {
  const insets = useSafeAreaInsets();

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

  // 当前周一日期 (YYYY-MM-DD)
  const currentWeekStart = useMemo(() => getMondayOfWeek(), []);

  // 快速查询某菜品本周是否已选
  const pickedDishIdMap = useMemo(() => {
    const map = new Set();
    const list = Array.isArray(picks) ? picks : (picks && picks.data) || [];
    list.forEach((p) => {
      if (p && p.dish_id) map.add(p.dish_id);
    });
    return map;
  }, [picks]);

  // 当前分类下的菜品列表
  const filteredDishes = useMemo(() => {
    const list = Array.isArray(dishes) ? dishes : (dishes && dishes.data) || [];
    return list.filter((d) => (d && (d.category || 'meat')) === selectedCategory);
  }, [dishes, selectedCategory]);

  // ─── Data Loading ───
  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [dishesRes, picksRes] = await Promise.all([
        fetchDishes(),
        fetchWeeklyPicks(currentWeekStart),
      ]);
      const safeDishes = Array.isArray(dishesRes) ? dishesRes : (dishesRes && dishesRes.data) || [];
      const safePicks = Array.isArray(picksRes) ? picksRes : (picksRes && picksRes.data) || [];
      setDishes(safeDishes);
      setPicks(safePicks);
    } catch (err) {
      console.error('[MomiKitchen] 数据加载失败:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentWeekStart]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 轮询兜底机制（与其他 Screen 架构统一保持 15s 活跃轮询）
  usePolling(loadData, 15000);

  // ─── Realtime Subscription ───
  useEffect(() => {
    let channel;
    try {
      if (supabase && typeof supabase.channel === 'function') {
        channel = supabase
          .channel('kitchen-realtime-sync')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'kitchen_dishes' },
            (payload) => {
              if (payload.eventType === 'INSERT') {
                setDishes((prev) => [payload.new, ...prev.filter((d) => d.id !== payload.new.id)]);
              } else if (payload.eventType === 'UPDATE') {
                setDishes((prev) =>
                  prev.map((d) => (d.id === payload.new.id ? payload.new : d))
                );
                setSelectedDish((curr) => (curr && curr.id === payload.new.id ? payload.new : curr));
              } else if (payload.eventType === 'DELETE') {
                setDishes((prev) => prev.filter((d) => d.id !== payload.old.id));
                setPicks((prev) => prev.filter((p) => p.dish_id !== payload.old.id));
                setSelectedDish((curr) => (curr && curr.id === payload.old.id ? null : curr));
              }
            }
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'kitchen_weekly_picks' },
            () => {
              fetchWeeklyPicks(currentWeekStart).then((res) => {
                const safe = Array.isArray(res) ? res : (res && res.data) || [];
                setPicks(safe);
              });
            }
          )
          .subscribe();
      }
    } catch (e) {
      console.warn('[MomiKitchen] Realtime 订阅失败:', e.message);
    }

    return () => {
      try {
        if (channel && supabase && typeof supabase.removeChannel === 'function') {
          supabase.removeChannel(channel);
        }
      } catch (e) {}
    };
  }, [currentWeekStart]);

  // ─── Actions ───

  // 点选 / 取消点选 "本周想吃"
  const handleTogglePick = async (dish) => {
    if (!dish || !dish.id) return;

    try {
      const result = await toggleWeeklyPick({
        dishId: dish.id,
        weekStart: currentWeekStart,
        userId,
      });

      if (result.action === 'picked') {
        // 刚加入本周菜单，按要求弹出特定文案的居中提示
        setToastMessage('momi厨房正在准备食材，请耐心等待哦~');
        setToastVisible(true);
      }

      // 刷新本周选菜列表
      const updatedPicks = await fetchWeeklyPicks(currentWeekStart);
      setPicks(updatedPicks || []);
    } catch (err) {
      console.error('[MomiKitchen] 切换想吃状态失败:', err);
      Alert.alert('操作失败', '网络繁忙，请稍后重试');
    }
  };

  // 从周菜单中移除单道菜
  const handleRemovePick = async (dishId) => {
    try {
      await removeWeeklyPick(dishId, currentWeekStart);
      setPicks((prev) => prev.filter((p) => p.dish_id !== dishId && p.id !== dishId));
    } catch (err) {
      console.error('[MomiKitchen] 移除菜品失败:', err);
      Alert.alert('移除失败', '请检查网络连接后重试');
    }
  };

  // 一键清空本周菜单
  const handleClearPicks = async () => {
    try {
      await clearWeeklyPicks(currentWeekStart);
      setPicks([]);
    } catch (err) {
      console.error('[MomiKitchen] 清空菜单失败:', err);
      Alert.alert('清空失败', '请检查网络连接后重试');
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

  // 菜品保存成功
  const handleDishSaved = (savedDish) => {
    setEditModalVisible(false);
    setEditingDish(null);
    setDishes((prev) => {
      const idx = prev.findIndex((d) => d.id === savedDish.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = savedDish;
        return next;
      }
      return [savedDish, ...prev];
    });
    // 如果正在查看详情，同步更新详情
    if (selectedDish && selectedDish.id === savedDish.id) {
      setSelectedDish(savedDish);
    }
  };

  // 渲染单道菜品卡片
  const renderDishItem = ({ item }) => {
    const isPicked = pickedDishIdMap.has(item.id);
    return (
      <DishCard
        dish={item}
        isPicked={isPicked}
        onPress={() => {
          setSelectedDish(item);
          setDetailModalVisible(true);
        }}
        onTogglePick={() => handleTogglePick(item)}
      />
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: THEME_BG }]}>
      {/* 居中 Toast */}
      <CenterToast
        visible={toastVisible}
        message={toastMessage}
        duration={2500}
        onDismiss={() => setToastVisible(false)}
      />

      {/* 顶部导航栏 (1:1 复刻图一) */}
      <View style={[styles.customHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          activeOpacity={0.7}
          onPress={onBack}
          accessibilityLabel="返回"
        >
          <Ionicons name="chevron-back" size={26} color="#2D312E" />
        </TouchableOpacity>

        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>momi厨房</Text>
          <Text style={styles.headerSubtitle}>今天吃什么？两人挑一挑</Text>
        </View>

        <TouchableOpacity
          style={styles.headerRightPill}
          activeOpacity={0.75}
          onPress={() => setWeeklyModalVisible(true)}
          accessibilityLabel="查看本周菜单"
        >
          <Ionicons name="restaurant-outline" size={14} color="#558E73" style={{ marginRight: 4 }} />
          <Text style={styles.headerRightPillText}>本周菜单</Text>
          {picks.length > 0 && (
            <View style={styles.headerPillBadge}>
              <Text style={styles.headerPillBadgeText}>{picks.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* 自然周浮动卡片 (1:1 复刻图一) */}
      <View style={styles.weekCard}>
        <View style={styles.weekCardLeft}>
          <View style={styles.weekCardRow}>
            <Ionicons name="calendar-outline" size={15} color="#7A807A" style={styles.weekCardIcon} />
            <Text style={styles.weekCardRange}>{formatWeekRangeDisplay(currentWeekStart)}</Text>
          </View>
          <View style={[styles.weekCardRow, { marginTop: 6 }]}>
            <Ionicons name="bag-handle-outline" size={15} color="#7A807A" style={styles.weekCardIcon} />
            <Text style={styles.weekCardPicks}>
              已挑 <Text style={styles.weekCardPicksBold}>{picks.length}</Text> 道
            </Text>
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setWeeklyModalVisible(true)}
        >
          <Text style={styles.weekCardLink}>查看清单 &gt;</Text>
        </TouchableOpacity>
      </View>

      {/* 三大分类选择器 (带 3D 拟物立体插图，1:1 复刻图一) */}
      <View style={styles.categoryBar}>
        {CATEGORY_KEYS.map((catKey, index) => {
          const catConfig = KITCHEN_CATEGORY_CONFIG[catKey] || {
            label: catKey,
            image: null,
          };
          const isSelected = selectedCategory === catKey;
          const count = dishes.filter((d) => (d.category || 'meat') === catKey).length;

          return (
            <View key={catKey} style={styles.categoryCol}>
              <TouchableOpacity
                style={styles.categoryItem}
                activeOpacity={0.8}
                onPress={() => setSelectedCategory(catKey)}
              >
                {/* 3D 拟物大图 */}
                <Image
                  source={catConfig.image}
                  style={styles.categoryImage}
                  resizeMode="contain"
                />

                {/* 胶囊标签 */}
                <View
                  style={[
                    styles.categoryPill,
                    isSelected ? styles.categoryPillSelected : styles.categoryPillUnselected,
                  ]}
                >
                  <Text
                    style={[
                      styles.categoryLabel,
                      isSelected ? styles.categoryLabelSelected : styles.categoryLabelUnselected,
                    ]}
                  >
                    {catConfig.label}
                  </Text>
                  <View
                    style={[
                      styles.categoryCountBadge,
                      isSelected ? styles.categoryBadgeSelected : styles.categoryBadgeUnselected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.categoryCountText,
                        isSelected ? styles.categoryBadgeTextSelected : styles.categoryBadgeTextUnselected,
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              {/* 列间分割线 */}
              {index < CATEGORY_KEYS.length - 1 && <View style={styles.categoryDivider} />}
            </View>
          );
        })}
      </View>

      {/* 菜品列表 / 空状态 (1:1 复刻图一) */}
      {loading ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color="#558E73" />
          <Text style={styles.loadingText}>
            momi厨房正在加载美味...
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredDishes}
          keyExtractor={(item) => item.id}
          renderItem={renderDishItem}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 90 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              tintColor="#558E73"
              colors={['#558E73']}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Image
                source={
                  (KITCHEN_CATEGORY_CONFIG[selectedCategory] || KITCHEN_CATEGORY_CONFIG.meat).emptyImage
                }
                style={styles.emptyImage}
                resizeMode="contain"
              />
              <Text style={styles.emptyTitle}>
                {(KITCHEN_CATEGORY_CONFIG[selectedCategory]?.label || '菜品')}池空空如也哦
              </Text>
              <Text style={styles.emptySubtitle}>
                点击右下角「+」号，记录你们喜爱的{'\n'}专属私房菜吧！
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* 悬浮添加按钮 (FAB 1:1 复刻图一) */}
      <TouchableOpacity
        style={[
          styles.fab,
          {
            bottom: insets.bottom > 0 ? insets.bottom + 20 : 28,
          },
        ]}
        activeOpacity={0.85}
        onPress={() => {
          setEditingDish(null);
          setEditModalVisible(true);
        }}
        accessibilityLabel="添加菜品"
      >
        <Ionicons name="add" size={32} color="#FFFFFF" />
      </TouchableOpacity>

      {/* 菜品编辑 / 新增弹窗 */}
      <DishEditModal
        visible={editModalVisible}
        dish={editingDish}
        userId={userId}
        onClose={() => {
          setEditModalVisible(false);
          setEditingDish(null);
        }}
        onSaved={handleDishSaved}
        onDeleted={(deletedId) => handleDeleteDish(deletedId)}
      />

      {/* 菜品详情与做法弹窗 */}
      <DishDetailModal
        visible={detailModalVisible}
        dish={selectedDish}
        isPickedThisWeek={selectedDish ? pickedDishIdMap.has(selectedDish.id) : false}
        onClose={() => {
          setDetailModalVisible(false);
          setSelectedDish(null);
        }}
        onTogglePick={(dish) => handleTogglePick(dish)}
        onEdit={(dish) => {
          setDetailModalVisible(false);
          setEditingDish(dish);
          setEditModalVisible(true);
        }}
        onDelete={(dishId) => handleDeleteDish(dishId)}
      />

      {/* 本周想吃清单弹窗 */}
      <WeeklyPicksModal
        visible={weeklyModalVisible}
        picks={picks}
        weekStart={currentWeekStart}
        onClose={() => setWeeklyModalVisible(false)}
        onRemovePick={handleRemovePick}
        onClearPicks={handleClearPicks}
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
    backgroundColor: THEME_BG,
  },
  // ── Custom Header (1:1 复刻图一) ──
  customHeader: {
    backgroundColor: THEME_BG,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#2B302C',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#7C837D',
    marginTop: 2,
  },
  headerRightPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#B4D5C2',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 11,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  headerRightPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#528A6D',
  },
  headerPillBadge: {
    marginLeft: 4,
    backgroundColor: '#528A6D',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  headerPillBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },

  // ── Floating Natural Week Card (1:1 复刻图一) ──
  weekCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#3A423D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  weekCardLeft: {
    flex: 1,
  },
  weekCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weekCardIcon: {
    marginRight: 8,
  },
  weekCardRange: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2B302C',
  },
  weekCardPicks: {
    fontSize: 13,
    color: '#636A65',
  },
  weekCardPicksBold: {
    fontWeight: '700',
    color: '#2B302C',
  },
  weekCardLink: {
    fontSize: 14,
    fontWeight: '600',
    color: '#528A6D',
  },

  // ── 3D Category Bar (1:1 复刻图一) ──
  categoryBar: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 6,
  },
  categoryCol: {
    flex: 1,
    position: 'relative',
  },
  categoryItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  categoryImage: {
    width: 78,
    height: 60,
    marginBottom: 6,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  categoryPillSelected: {
    backgroundColor: '#B7D8C6',
  },
  categoryPillUnselected: {
    backgroundColor: 'transparent',
  },
  categoryLabel: {
    fontSize: 15,
    fontWeight: '700',
    marginRight: 4,
  },
  categoryLabelSelected: {
    color: '#1C4B34',
  },
  categoryLabelUnselected: {
    color: '#2D312E',
    fontWeight: '600',
  },
  categoryCountBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryBadgeSelected: {
    backgroundColor: '#8DBEA3',
  },
  categoryBadgeUnselected: {
    backgroundColor: '#DEE7E2',
  },
  categoryCountText: {
    fontSize: 11,
    fontWeight: '700',
  },
  categoryBadgeTextSelected: {
    color: '#1C4B34',
  },
  categoryBadgeTextUnselected: {
    color: '#558770',
  },
  categoryDivider: {
    position: 'absolute',
    right: 0,
    top: 36,
    height: 36,
    width: 1,
    backgroundColor: '#E5E1D5',
  },

  // ── List & Empty State (1:1 复刻图一) ──
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...typography.caption,
    marginTop: spacing.sm,
    color: '#7C837D',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 30,
    paddingHorizontal: 20,
  },
  emptyImage: {
    width: 320,
    height: 250,
    borderRadius: 18,
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#2B302C',
    marginTop: 18,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#7C837D',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },

  // ── FAB (1:1 复刻图一) ──
  fab: {
    position: 'absolute',
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#5BA888',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5BA888',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.38,
    shadowRadius: 8,
    elevation: 6,
  },
});
