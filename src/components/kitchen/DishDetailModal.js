// 菜品沉浸详情 V2：四分类 / 运行时主题 / 分组配方 / 危险操作二次确认
import React, { useMemo } from 'react';
import { Alert, Dimensions, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, useTheme } from '../../theme';
import { CachedImage } from '../../lib/imageCache';
import { CATEGORIES, normalizeCategory } from '../../lib/kitchenUtils';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = Math.floor(SCREEN_HEIGHT * 0.38);

function parseRecipe(raw) {
  if (!raw) return { ingredients: [], steps: [] };
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  const ingredients = []; const steps = []; let section = '';
  for (const line of lines) {
    if (/步骤|做法/.test(line)) { section = 'steps'; continue; }
    if (/食材|用料/.test(line)) { section = 'ingredients'; continue; }
    const clean = line.replace(/^[-*•\s]+/, '').replace(/^\d+[.、\s]+/, '');
    if (section === 'ingredients') ingredients.push(clean); else if (section === 'steps') steps.push(clean);
  }
  if (!ingredients.length && !steps.length) return { ingredients: [], steps: lines };
  return { ingredients, steps };
}

export function DishDetailModal({ visible, dish, isPickedThisWeek, onClose, onTogglePick, onEdit, onDelete }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!dish) return null;
  const normalized = normalizeCategory(dish.category);
  const cat = CATEGORIES.find((item) => normalizeCategory(item.key) === normalized) || { icon: '🍲', label: '菜品' };
  const { ingredients, steps } = parseRecipe(dish.recipe_text);
  const images = Array.isArray(dish.recipe_images) ? dish.recipe_images : [];
  const confirmDelete = () => Alert.alert('删除菜品', `确定删除「${dish.title}」吗？接下来 5 秒内仍可撤销。`, [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => onDelete?.(dish.id) }]);
  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}>
        <View style={[styles.hero, { height: HERO_HEIGHT }]}>
          {dish.image_path ? <CachedImage source={dish.image_path} style={styles.heroImage} contentFit="cover" previewable /> : <View style={styles.heroEmpty}><Ionicons name={normalized === 'drink' ? 'cafe-outline' : 'restaurant-outline'} size={58} color={colors.textMuted} /></View>}
          <View style={styles.scrim}><Text style={styles.category}>{cat.icon} {cat.label}</Text><Text style={styles.title}>{dish.title}</Text><Text style={styles.meta}>收录于 {dish.created_by || '我们'} · {dish.created_at?.slice(0, 10) || '今日'}</Text></View>
          <TouchableOpacity style={[styles.floating, { top: insets.top + 10, left: 16 }]} onPress={onClose}><Ionicons name="chevron-down" size={24} color="#fff" /></TouchableOpacity>
          <TouchableOpacity style={[styles.floating, { top: insets.top + 10, right: 16 }]} onPress={confirmDelete}><Ionicons name="trash-outline" size={20} color="#fff" /></TouchableOpacity>
        </View>
        <View style={styles.content}>
          {ingredients.length ? <View style={styles.section}><Text style={styles.sectionTitle}>🌿 准备食材 · {ingredients.length}</Text><View style={styles.chips}>{ingredients.map((x, i) => <View key={`i-${i}`} style={styles.chip}><Text style={styles.chipText}>• {x}</Text></View>)}</View></View> : null}
          {steps.length ? <View style={styles.section}><Text style={styles.sectionTitle}>🔥 烹饪步骤</Text>{steps.map((x, i) => <View key={`s-${i}`} style={styles.step}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{i + 1}</Text></View><Text style={styles.stepText}>{x}</Text></View>)}</View> : <View style={styles.emptyRecipe}><Text style={styles.emptyRecipeText}>还没有烹饪秘籍，点「编辑菜品」补上吧～</Text></View>}
          {images.length ? <View style={styles.section}><Text style={styles.sectionTitle}>🖼️ 笔记与步骤图</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{images.map((uri, i) => <CachedImage key={`${uri}-${i}`} source={uri} style={styles.gallery} contentFit="cover" previewable />)}</ScrollView></View> : null}
        </View>
      </ScrollView>
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity style={[styles.outline, isPickedThisWeek && styles.outlineActive]} onPress={() => onTogglePick?.(dish)}><Ionicons name={isPickedThisWeek ? 'heart' : 'heart-outline'} size={18} color={isPickedThisWeek ? colors.textOnPrimary : colors.primary} /><Text style={[styles.outlineText, isPickedThisWeek && { color: colors.textOnPrimary }]}>{isPickedThisWeek ? '已加入本周' : '加入本周想吃'}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.edit} onPress={() => onEdit?.(dish)}><Ionicons name="create-outline" size={18} color={colors.textOnPrimary} /><Text style={styles.editText}>编辑菜品</Text></TouchableOpacity>
      </View>
    </View>
  </Modal>;
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background }, hero: { position: 'relative', backgroundColor: c.surfaceSoft }, heroImage: { width: '100%', height: '100%' }, heroEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 150, justifyContent: 'flex-end', padding: spacing[5], paddingBottom: 28, backgroundColor: 'rgba(0,0,0,0.45)' },
  category: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.92)', color: c.primary, fontSize: 11, fontWeight: '700', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  title: { fontSize: 26, fontWeight: '800', color: '#fff', marginTop: 7 }, meta: { color: 'rgba(255,255,255,0.86)', fontSize: 12, marginTop: 4 },
  floating: { position: 'absolute', width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center' },
  content: { marginTop: -20, minHeight: 420, backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing[5] }, section: { marginBottom: spacing[5] }, sectionTitle: { fontSize: 17, fontWeight: '800', color: c.text, marginBottom: spacing[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { backgroundColor: c.primarySoft, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, paddingVertical: 7 }, chipText: { color: c.text, fontSize: 13 },
  step: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing[3] }, stepNumber: { width: 25, height: 25, borderRadius: 13, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', marginRight: spacing[3] }, stepNumberText: { color: c.textOnPrimary, fontWeight: '700', fontSize: 12 }, stepText: { flex: 1, color: c.text, fontSize: 14, lineHeight: 22 },
  emptyRecipe: { padding: spacing[4], borderRadius: radius.md, backgroundColor: c.surfaceSoft }, emptyRecipeText: { color: c.textMuted, textAlign: 'center', lineHeight: 20 }, gallery: { width: 112, height: 112, borderRadius: radius.md, marginRight: 10 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: spacing[3], paddingHorizontal: spacing[4], paddingTop: 10, backgroundColor: c.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  outline: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, outlineActive: { backgroundColor: c.primary }, outlineText: { color: c.primary, fontSize: 13, fontWeight: '700' },
  edit: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, editText: { color: c.textOnPrimary, fontSize: 13, fontWeight: '700' },
});
