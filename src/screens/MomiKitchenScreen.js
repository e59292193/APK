// momi 厨房 V2：四分类 / 两列网格 / 本周菜单 / 375pt 响应式
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePolling } from '../hooks/usePolling';
import { supabase } from '../lib/supabase';
import { spacing, radius, useTheme } from '../theme';
import { CenterToast } from '../components/ui';
import { DishCard, DishEditModal, DishDetailModal, WeeklyPicksModal } from '../components/kitchen';
import { getMondayOfWeek, formatWeekRangeDisplay, fetchDishes, fetchWeeklyPicks, toggleWeeklyPick, removeWeeklyPick, clearWeeklyPicks, deleteDish, normalizeCategory } from '../lib/kitchenUtils';
import { CachedImage } from '../lib/imageCache';

const CATEGORIES_DATA = [
  { key: 'meat', label: '荤菜', icon: '🥩' }, { key: 'veg', label: '蔬菜', icon: '🥗' },
  { key: 'snack', label: '小吃', icon: '🥟' }, { key: 'drink', label: '饮品', icon: '🧋' },
];

export default function MomiKitchenScreen({ userId, onBack, onNavigateMomiAssistant }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const deleteTimerRef = useRef(null);
  const [selectedCategory, setSelectedCategory] = useState('meat');
  const [dishes, setDishes] = useState([]);
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editingDish, setEditingDish] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedDish, setSelectedDish] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const weekStart = useMemo(() => getMondayOfWeek(), []);

  const loadData = useCallback(async () => {
    try {
      const [dishRows, pickRows] = await Promise.all([fetchDishes(null, 'momo_and_baomi'), fetchWeeklyPicks(weekStart, 'momo_and_baomi')]);
      setDishes(dishRows || []); setPicks(pickRows || []);
    } catch (error) { setToast(`厨房加载失败：${error.message}`); }
    finally { setLoading(false); setRefreshing(false); }
  }, [weekStart]);

  useEffect(() => { loadData(); }, [loadData]);
  usePolling(loadData, 15000);
  useEffect(() => {
    const channel = supabase.channel('kitchen_v2_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kitchen_dishes' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kitchen_weekly_picks' }, loadData).subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadData]);
  useEffect(() => () => clearTimeout(deleteTimerRef.current), []);

  const pickedIds = useMemo(() => new Set(picks.map((pick) => pick.dish_id).filter(Boolean)), [picks]);
  const filtered = useMemo(() => dishes.filter((dish) => {
    const normalized = normalizeCategory(dish.category);
    return selectedCategory === 'veg' ? normalized === 'vegetable' : normalized === selectedCategory;
  }), [dishes, selectedCategory]);
  const weeklyDishes = useMemo(() => dishes.filter((dish) => pickedIds.has(dish.id)), [dishes, pickedIds]);
  const enrichedPicks = useMemo(() => {
    const map = new Map(dishes.map((dish) => [dish.id, dish]));
    return picks.map((pick) => ({ ...pick, dish: pick.dish || map.get(pick.dish_id) })).filter((pick) => pick.dish);
  }, [picks, dishes]);

  const togglePick = async (dish) => {
    try {
      const result = await toggleWeeklyPick({ dishId: dish.id, weekStart, userId, coupleId: 'momo_and_baomi' });
      if (result?.action === 'picked') setToast('已加入本周想吃 🍲');
      await loadData();
    } catch (error) { setToast(`操作失败：${error.message}`); }
  };

  const scheduleDelete = (dishId) => {
    if (pendingDelete) {
      Alert.alert('请稍等', '上一道菜仍在 5 秒撤销期内，请先撤销或等待删除完成。');
      return;
    }
    const dish = dishes.find((item) => item.id === dishId);
    if (!dish) return;
    const removedPicks = picks.filter((pick) => pick.dish_id === dishId);
    setPendingDelete({ dish, picks: removedPicks });
    setDishes((previous) => previous.filter((item) => item.id !== dishId));
    setPicks((previous) => previous.filter((pick) => pick.dish_id !== dishId));
    setDetailOpen(false); setEditOpen(false); setEditingDish(null);
    deleteTimerRef.current = setTimeout(async () => {
      try { await deleteDish(dishId); setPendingDelete(null); }
      catch (error) {
        setPendingDelete(null);
        setDishes((previous) => previous.some((item) => item.id === dish.id) ? previous : [dish, ...previous]);
        setPicks((previous) => [...removedPicks, ...previous]);
        Alert.alert('删除失败', error.message || '请稍后重试');
      }
    }, 5000);
  };

  const undoDelete = () => {
    if (!pendingDelete) return;
    clearTimeout(deleteTimerRef.current);
    const { dish, picks: removedPicks } = pendingDelete;
    setDishes((previous) => previous.some((item) => item.id === dish.id) ? previous : [dish, ...previous]);
    setPicks((previous) => [...removedPicks.filter((pick) => !previous.some((item) => item.id === pick.id)), ...previous]);
    setPendingDelete(null); setToast('已撤销删除');
  };

  const handleSaved = (saved) => {
    setEditOpen(false); setEditingDish(null);
    const row = Array.isArray(saved?.data) ? saved.data[0] : saved?.data || saved;
    if (row?.id) setDishes((previous) => previous.some((dish) => dish.id === row.id) ? previous.map((dish) => dish.id === row.id ? row : dish) : [row, ...previous]);
    loadData();
  };

  const categoryMeta = CATEGORIES_DATA.find((item) => item.key === selectedCategory);
  return <View style={styles.container}>
    <CenterToast visible={Boolean(toast)} message={toast} duration={2200} onDismiss={() => setToast('')} />
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <View style={styles.titleRow}><TouchableOpacity style={styles.circleButton} onPress={onBack}><Ionicons name="chevron-back" size={24} color={colors.textOnPrimary} /></TouchableOpacity><View style={styles.titleText}><Text style={styles.title}>momi厨房</Text><Text style={styles.subtitle}>今天吃什么？两人挑一挑 🍳</Text></View></View>
      <View style={styles.headerActions}><TouchableOpacity style={styles.headerAction} onPress={onNavigateMomiAssistant}><Text style={styles.headerActionEmoji}>🐾</Text><Text style={styles.headerActionText}>问 momi</Text></TouchableOpacity><TouchableOpacity style={styles.headerAction} onPress={() => setWeeklyOpen(true)}><Ionicons name="restaurant-outline" size={16} color={colors.primary} /><Text style={styles.headerActionText}>本周菜单 {picks.length ? `· ${picks.length}` : ''}</Text></TouchableOpacity></View>
      <View style={styles.tabs}>{CATEGORIES_DATA.map((category) => { const active = category.key === selectedCategory; return <TouchableOpacity key={category.key} style={[styles.tab, active && styles.tabActive]} onPress={() => setSelectedCategory(category.key)}><Text style={styles.tabEmoji}>{category.icon}</Text><Text style={[styles.tabText, active && styles.tabTextActive]}>{category.label}</Text></TouchableOpacity>; })}</View>
    </View>

    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={colors.primary} />} contentContainerStyle={{ paddingBottom: insets.bottom + 96 }} showsVerticalScrollIndicator={false}>
      <View style={styles.section}><View style={styles.sectionHead}><Text style={styles.sectionTitle}>❤️ 本周想吃</Text><Text style={styles.week}>{formatWeekRangeDisplay(weekStart)}</Text><TouchableOpacity onPress={() => setWeeklyOpen(true)}><Text style={styles.link}>查看清单 ›</Text></TouchableOpacity></View>
        {weeklyDishes.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weeklyScroll}>{weeklyDishes.map((dish) => <TouchableOpacity key={dish.id} style={styles.weeklyCard} onPress={() => { setSelectedDish(dish); setDetailOpen(true); }}><CachedImage source={dish.image_path} style={styles.weeklyImage} contentFit="cover" previewable={false} /><Text style={styles.weeklyName} numberOfLines={1}>{dish.title}</Text></TouchableOpacity>)}</ScrollView> : <View style={styles.weeklyEmpty}><Ionicons name="cart-outline" size={22} color={colors.textMuted} /><Text style={styles.muted}>点菜品卡片上的爱心，把想吃的加进来</Text></View>}
      </View>
      <View style={styles.gridSection}><Text style={styles.sectionTitle}>{categoryMeta?.icon} {categoryMeta?.label} · {filtered.length}</Text>
        {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在准备菜单...</Text></View> : filtered.length ? <View style={styles.grid}>{filtered.map((dish) => <DishCard key={dish.id} dish={dish} isPicked={pickedIds.has(dish.id)} onPress={() => { setSelectedDish(dish); setDetailOpen(true); }} onTogglePick={() => togglePick(dish)} />)}</View> : <View style={styles.empty}><Ionicons name={selectedCategory === 'drink' ? 'cafe-outline' : 'restaurant-outline'} size={48} color={colors.textMuted} /><Text style={styles.emptyTitle}>这个分类还没有记录</Text><Text style={styles.muted}>添加你们喜欢的{selectedCategory === 'drink' ? '饮品' : '美食'}吧</Text><TouchableOpacity style={styles.emptyButton} onPress={() => { setEditingDish(null); setEditOpen(true); }}><Ionicons name="add" size={18} color={colors.textOnPrimary} /><Text style={styles.emptyButtonText}>添加新菜品</Text></TouchableOpacity></View>}
      </View>
    </ScrollView>

    <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 22 }]} onPress={() => { setEditingDish(null); setEditOpen(true); }}><Ionicons name="add" size={30} color={colors.textOnPrimary} /></TouchableOpacity>
    {pendingDelete ? <View style={[styles.undoBar, { bottom: insets.bottom + 16 }]}><Text style={styles.undoText}>已移除「{pendingDelete.dish.title}」</Text><TouchableOpacity onPress={undoDelete}><Text style={styles.undoAction}>撤销</Text></TouchableOpacity></View> : null}

    <DishEditModal visible={editOpen} dish={editingDish} userId={userId} onClose={() => setEditOpen(false)} onSaved={handleSaved} onDeleteRequest={scheduleDelete} />
    <DishDetailModal visible={detailOpen} dish={selectedDish} isPickedThisWeek={selectedDish ? pickedIds.has(selectedDish.id) : false} onClose={() => setDetailOpen(false)} onTogglePick={togglePick} onEdit={(dish) => { setDetailOpen(false); setEditingDish(dish); setEditOpen(true); }} onDelete={scheduleDelete} />
    <WeeklyPicksModal visible={weeklyOpen} picks={enrichedPicks} weekStart={weekStart} onClose={() => setWeeklyOpen(false)} onRemovePick={async (id) => { const pick = picks.find((item) => item.id === id || item.dish_id === id); await removeWeeklyPick(pick?.dish_id || id, weekStart, 'momo_and_baomi'); loadData(); }} onClearPicks={async () => { await clearWeeklyPicks(weekStart, 'momo_and_baomi'); loadData(); }} onSelectDish={(dish) => { setWeeklyOpen(false); setSelectedDish(dish); setDetailOpen(true); }} />
  </View>;
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background }, header: { backgroundColor: c.primary, paddingHorizontal: spacing[3], paddingBottom: spacing[3], borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  titleRow: { flexDirection: 'row', alignItems: 'center' }, circleButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' }, titleText: { flex: 1, marginLeft: spacing[1] }, title: { fontSize: 21, fontWeight: '800', color: c.textOnPrimary }, subtitle: { fontSize: 11, color: c.textOnPrimary, opacity: 0.85, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }, headerAction: { flex: 1, minHeight: 38, borderRadius: radius.pill, backgroundColor: c.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, headerActionEmoji: { fontSize: 16 }, headerActionText: { fontSize: 12, color: c.primary, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 5, marginTop: spacing[3] }, tab: { flex: 1, minWidth: 0, height: 38, borderRadius: radius.pill, backgroundColor: c.overlayOnPrimary || 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 3 }, tabActive: { backgroundColor: c.card }, tabEmoji: { fontSize: 13 }, tabText: { fontSize: 11, color: c.textOnPrimary, fontWeight: '600' }, tabTextActive: { color: c.primary, fontWeight: '800' },
  section: { paddingHorizontal: spacing[4], paddingTop: spacing[4] }, sectionHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing[2] }, sectionTitle: { fontSize: 16, fontWeight: '800', color: c.text, flexShrink: 1 }, week: { fontSize: 10, color: c.primary, backgroundColor: c.primarySoft, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, marginLeft: 6 }, link: { fontSize: 11, color: c.textSecondary, marginLeft: 6 },
  weeklyScroll: { gap: spacing[2], paddingBottom: spacing[1] }, weeklyCard: { width: 130, borderRadius: radius.lg, backgroundColor: c.card, overflow: 'hidden', borderWidth: 1, borderColor: c.border }, weeklyImage: { width: 130, height: 92, backgroundColor: c.surfaceSoft }, weeklyName: { fontSize: 12, fontWeight: '700', color: c.text, padding: 8 }, weeklyEmpty: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing[3] },
  gridSection: { paddingHorizontal: spacing[4], paddingTop: spacing[4] }, grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: spacing[3] }, center: { paddingVertical: 60, alignItems: 'center', gap: spacing[2] }, muted: { fontSize: 12, color: c.textMuted, textAlign: 'center' }, empty: { alignItems: 'center', paddingVertical: 50 }, emptyTitle: { fontSize: 15, fontWeight: '700', color: c.text, marginTop: spacing[2], marginBottom: 3 }, emptyButton: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.primary, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 10, marginTop: spacing[3] }, emptyButtonText: { color: c.textOnPrimary, fontSize: 13, fontWeight: '700' },
  fab: { position: 'absolute', right: 20, width: 58, height: 58, borderRadius: 29, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: c.shadow, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, undoBar: { position: 'absolute', left: 16, right: 16, minHeight: 52, borderRadius: radius.md, backgroundColor: c.text, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], elevation: 12 }, undoText: { flex: 1, color: c.background, fontSize: 13 }, undoAction: { color: c.primarySoft, fontWeight: '800', padding: spacing[2] },
});
