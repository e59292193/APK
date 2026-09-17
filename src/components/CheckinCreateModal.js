import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Keyboard, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius, useTheme } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PRESETS = [
  { icon: '🍲', label: '好好吃饭' }, { icon: '🐟', label: '摸鱼打卡' }, { icon: '🏃', label: '运动打卡' },
  { icon: '📖', label: '学习打卡' }, { icon: '🧢', label: '今日穿搭' }, { icon: '🥤', label: '喝水打卡' },
  { icon: '☀️', label: '早起打卡' }, { icon: '💤', label: '晚安打卡' }, { icon: '🥰', label: '幸福瞬间' },
];
const GAP = 10;
const ITEM_SIZE = (SCREEN_WIDTH - 16 * 2 - GAP * 2) / 3;

export default function CheckinCreateModal({ visible, onClose, onCreate, userId, partnerId }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [preset, setPreset] = useState(null);
  const [customTitle, setCustomTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const resetAndClose = () => { Keyboard.dismiss(); setPreset(null); setCustomTitle(''); onClose?.(); };
  const create = async () => {
    const title = customTitle.trim() || preset?.label || '';
    if (!title) return Alert.alert('提示', '请选择一个预设主题，或输入自定义主题名称');
    if (title.length > 10) return Alert.alert('提示', '主题名称最多10个字');
    setSaving(true);
    try {
      const { supabase } = require('../lib/supabase');
      const { data: existing } = await supabase.from('checkin_themes').select('id').eq('title', title).or(`creator_id.eq.${userId},partner_id.eq.${userId}`).limit(1);
      if (existing?.length) return Alert.alert('提示', '该打卡主题已存在，请勿重复发起！');
      await onCreate?.({ creator_id: userId, partner_id: partnerId, title, icon: preset?.icon || '✨', status: 'pending' });
      resetAndClose();
    } catch (error) { console.error('Error creating checkin theme:', error); Alert.alert('错误', '创建失败，请重试'); }
    finally { setSaving(false); }
  };
  const title = customTitle.trim() || preset?.label || '';

  return <Modal visible={visible} animationType="slide" transparent={false} statusBarTranslucent onRequestClose={resetAndClose}>
    <KeyboardAvoidingView behavior="padding" style={styles.fullScreen}>
      <Pressable style={styles.overlayTouchable} onPress={resetAndClose} />
      <View style={styles.container}>
        <View style={styles.header}><View style={styles.headerTitleRow}><Ionicons name="bookmark-outline" size={22} color={colors.primary} /><Text style={styles.headerTitle}>二人打卡</Text></View><Pressable onPress={resetAndClose} hitSlop={8}><Ionicons name="close" size={22} color={colors.textMuted} /></Pressable></View>
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionLabel}>选择主题</Text>
          <View style={styles.grid}>{PRESETS.map((item) => { const selected = preset?.label === item.label; return <TouchableOpacity key={item.label} style={[styles.preset, selected && styles.presetSelected]} onPress={() => { setPreset(item); setCustomTitle(''); }}><Text style={styles.presetIcon}>{item.icon}</Text><Text style={[styles.presetLabel, selected && styles.presetLabelSelected]}>{item.label}</Text></TouchableOpacity>; })}</View>
          <View style={styles.divider}><View style={styles.line} /><Text style={styles.dividerText}>或自定义</Text><View style={styles.line} /></View>
          <Text style={styles.sectionLabel}>自定义主题</Text>
          <View style={styles.inputWrap}><Ionicons name="create-outline" size={18} color={colors.textMuted} /><TextInput style={styles.input} value={customTitle} onChangeText={(text) => { setCustomTitle(text); if (text) setPreset(null); }} placeholder="输入主题名称（最多10字）" placeholderTextColor={colors.textMuted} maxLength={10} /><Text style={styles.count}>{customTitle.length}/10</Text></View>
          {title ? <View style={styles.preview}><Text style={styles.previewLabel}>预览</Text><View style={styles.previewRow}><Text style={styles.previewIcon}>{preset?.icon || '✨'}</Text><Text style={styles.previewTitle}>{title}</Text></View></View> : null}
        </ScrollView>
        <View style={styles.bottom}><TouchableOpacity style={[styles.create, !title && styles.createDisabled]} onPress={create} disabled={saving || !title}>{saving ? <ActivityIndicator color={colors.textOnPrimary} /> : <View style={styles.createContent}><Ionicons name="sparkles" size={18} color={colors.textOnPrimary} /><Text style={styles.createText}>发起打卡</Text></View>}</TouchableOpacity></View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const createStyles = (c) => StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' }, overlayTouchable: { ...StyleSheet.absoluteFillObject },
  container: { backgroundColor: c.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '92%', paddingBottom: spacing[6], flexShrink: 1, shadowColor: c.shadow, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 18, elevation: 7 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing[4], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }, headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] }, headerTitle: { ...typography.pageTitle, color: c.text },
  body: { paddingHorizontal: spacing[4], paddingTop: spacing[3], flexShrink: 1 }, sectionLabel: { ...typography.label, fontWeight: '600', color: c.textSecondary, marginBottom: spacing[2] + 2 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, marginBottom: spacing[4] },
  preset: { width: ITEM_SIZE, backgroundColor: c.surfaceSoft, borderRadius: radius.md, paddingVertical: spacing[3] + 2, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' }, presetSelected: { backgroundColor: c.meSoft, borderColor: c.primary }, presetIcon: { fontSize: 26, marginBottom: spacing[1] + 2 }, presetLabel: { ...typography.caption, fontWeight: '600', color: c.textSecondary }, presetLabelSelected: { color: c.meText, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing[2], marginBottom: spacing[4] }, line: { flex: 1, height: 1, backgroundColor: c.border }, dividerText: { ...typography.tabLabel, color: c.textMuted, marginHorizontal: spacing[3] },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceSoft, borderRadius: radius.md, paddingHorizontal: spacing[3] + 2, paddingVertical: spacing[1], marginBottom: spacing[4] }, input: { flex: 1, ...typography.body, color: c.text, paddingVertical: spacing[2] + 2, marginLeft: spacing[2] }, count: { ...typography.caption, color: c.textMuted, marginLeft: spacing[2] },
  preview: { backgroundColor: c.primarySoft, borderRadius: radius.md, padding: spacing[3] + 2, marginBottom: spacing[2], borderWidth: 1, borderColor: c.border }, previewLabel: { fontSize: 10, color: c.textMuted, marginBottom: spacing[2] }, previewRow: { flexDirection: 'row', alignItems: 'center' }, previewIcon: { fontSize: 24, marginRight: spacing[2] + 2 }, previewTitle: { ...typography.body, fontWeight: '700', color: c.primary },
  bottom: { paddingHorizontal: spacing[4], paddingTop: spacing[3] }, create: { backgroundColor: c.primary, borderRadius: radius.lg, paddingVertical: spacing[4] + 3, alignItems: 'center' }, createDisabled: { backgroundColor: c.primaryDisabled }, createContent: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] }, createText: { color: c.textOnPrimary, ...typography.body, fontWeight: '700' },
});
