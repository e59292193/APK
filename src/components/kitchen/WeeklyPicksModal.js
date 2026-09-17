import React, { useMemo } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography, useTheme } from '../../theme';
import { IconButton } from '../ui';
import { CachedImage } from '../../lib/imageCache';
import { CATEGORY_LABELS, formatWeekRangeDisplay, normalizeCategory } from '../../lib/kitchenUtils';

const GROUPS = [
  { key: 'meat', label: '荤菜', icon: '🥩' },
  { key: 'vegetable', label: '蔬菜', icon: '🥗' },
  { key: 'snack', label: '小吃', icon: '🥟' },
  { key: 'drink', label: '饮品', icon: '🧋' },
];

export function WeeklyPicksModal({ visible, picks = [], weekStart, onClose, onRemovePick, onClearPicks, onSelectDish }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const grouped = useMemo(() => GROUPS.map((group) => ({ ...group, items: picks.filter((p) => normalizeCategory(p.dish?.category) === group.key) })), [picks]);
  const clear = () => Alert.alert('清空本周菜单', '确定清空所有想吃菜品吗？两个人都会看到这个变化。', [{ text: '取消', style: 'cancel' }, { text: '清空', style: 'destructive', onPress: onClearPicks }]);
  const remove = (pick) => Alert.alert('移除菜品', `从本周菜单移除「${pick.dish?.title || '该菜品'}」？`, [{ text: '取消', style: 'cancel' }, { text: '移除', style: 'destructive', onPress: () => onRemovePick?.(pick.dish_id || pick.id) }]);
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={[styles.container, { paddingTop: insets.top || spacing[3], paddingBottom: insets.bottom || spacing[3] }]}>
      <View style={styles.header}><View><View style={styles.titleRow}><Text style={styles.title}>📋 本周想吃菜单</Text><Text style={styles.count}>共 {picks.length} 道</Text></View><Text style={styles.week}>{formatWeekRangeDisplay(weekStart)}</Text></View><IconButton name="close" size={22} color={colors.textSecondary} onPress={onClose} /></View>
      {!picks.length ? <View style={styles.empty}><Ionicons name="restaurant-outline" size={52} color={colors.textMuted} /><Text style={styles.emptyTitle}>本周菜单还是空的</Text><Text style={styles.muted}>去菜品列表点亮爱心吧～</Text></View> : <ScrollView contentContainerStyle={styles.scroll}>
        {grouped.map((group) => !group.items.length ? null : <View key={group.key} style={styles.group}><Text style={styles.groupTitle}>{group.icon} {group.label} · {group.items.length}</Text>{group.items.map((pick) => {
          const dish = pick.dish || {};
          return <TouchableOpacity key={pick.id} style={styles.item} onPress={() => onSelectDish?.(dish)}>
            {dish.image_path ? <CachedImage source={dish.image_path} style={styles.thumb} contentFit="cover" previewable={false} /> : <View style={styles.placeholder}><Ionicons name={group.key === 'drink' ? 'cafe-outline' : 'fast-food-outline'} size={22} color={colors.textMuted} /></View>}
            <View style={styles.itemInfo}><Text style={styles.itemTitle} numberOfLines={1}>{dish.title || '未命名'}</Text><View style={styles.metaRow}><Text style={styles.category}>{CATEGORY_LABELS[dish.category] || group.label}</Text><Text style={styles.picker}>{pick.picked_by === 'momo' ? 'momo 想吃' : pick.picked_by === '苞米' ? '苞米 想吃' : '想吃'}</Text></View></View>
            <TouchableOpacity style={styles.remove} onPress={() => remove(pick)}><Ionicons name="trash-outline" size={17} color={colors.error} /></TouchableOpacity>
          </TouchableOpacity>;
        })}</View>)}
      </ScrollView>}
      {picks.length ? <View style={styles.footer}><TouchableOpacity style={styles.clear} onPress={clear}><Ionicons name="trash-bin-outline" size={16} color={colors.error} /><Text style={styles.clearText}>一键清空本周菜单</Text></TouchableOpacity></View> : null}
    </View>
  </Modal>;
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing[4], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { ...typography.cardTitle, color: c.text },
  count: { fontSize: 11, color: c.primary, backgroundColor: c.primarySoft, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill }, week: { ...typography.caption, color: c.textMuted, marginTop: 3 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' }, emptyTitle: { ...typography.cardTitle, color: c.text, marginTop: spacing[3], marginBottom: spacing[1] }, muted: { ...typography.caption, color: c.textMuted },
  scroll: { padding: spacing[4], paddingBottom: spacing[8] }, group: { marginBottom: spacing[4] }, groupTitle: { ...typography.cardTitle, color: c.text, marginBottom: spacing[2] },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing[2], marginBottom: spacing[2] },
  thumb: { width: 54, height: 54, borderRadius: radius.sm }, placeholder: { width: 54, height: 54, borderRadius: radius.sm, backgroundColor: c.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  itemInfo: { flex: 1, marginHorizontal: spacing[2] }, itemTitle: { ...typography.bodyMedium, color: c.text, fontWeight: '700' }, metaRow: { flexDirection: 'row', gap: 7, marginTop: 5 },
  category: { fontSize: 10, color: c.primary, backgroundColor: c.primarySoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }, picker: { fontSize: 10, color: c.textSecondary },
  remove: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.errorSoft, alignItems: 'center', justifyContent: 'center' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, padding: spacing[4] }, clear: { height: 44, borderWidth: 1, borderColor: c.error, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, clearText: { ...typography.body, color: c.error, fontWeight: '600' },
});
