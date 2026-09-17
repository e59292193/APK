// momi 的小本本：结构化记忆查看 / 新增 / 编辑 / 归档
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader, EmptyState, CenterToast } from '../components/ui';
import { spacing, radius, typography, useTheme } from '../theme';
import { listMemories, createManualMemory, updateMemory, archiveMemory } from '../lib/momiMemory';
import { supabase } from '../lib/supabase';

const SUBJECT_LABELS = { momi: '🐾 momi', momo: 'M momo', '苞米': '🌽 苞米', both: '💞 两个人' };
const TYPE_LABELS = { identity: '身份', personality: '性格', speech_style: '语气', habit: '习惯', preference: '喜欢', dislike: '不喜欢', milestone: '里程碑', fact: '事实', promise: '约定', ongoing: '进行中' };

const EMPTY_DRAFT = { id: null, subject: 'both', memory_type: 'fact', content: '', importance: 5 };

export default function MomiNotebookScreen({ onBack }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    try { setRows(await listMemories({ includeArchived: showArchived })); }
    catch (err) { setToast(`读取失败：${err.message}`); }
    finally { setLoading(false); }
  }, [showArchived]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    const channel = supabase.channel('momi_memory_notebook')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'momi_memory' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  const openCreate = () => { setDraft({ ...EMPTY_DRAFT }); setEditorOpen(true); };
  const openEdit = (row) => { setDraft({ id: row.id, subject: row.subject, memory_type: row.memory_type, content: row.content, importance: row.importance || 3 }); setEditorOpen(true); };

  const save = async () => {
    if (!draft.content.trim()) { setToast('记忆内容不能为空'); return; }
    setSaving(true);
    try {
      if (draft.id) await updateMemory(draft.id, draft);
      else await createManualMemory(draft);
      setEditorOpen(false);
      setToast(draft.id ? '记忆更新好啦' : '写进小本本啦 🐾');
      await load();
    } catch (err) { Alert.alert('保存失败', err.message); }
    finally { setSaving(false); }
  };

  const archive = (row) => Alert.alert('归档这条记忆？', '归档后不会再注入 momi 的对话，可在“显示归档”中查看。', [
    { text: '取消', style: 'cancel' },
    { text: '归档', style: 'destructive', onPress: async () => { await archiveMemory(row.id); setToast('已归档'); load(); } },
  ]);

  const grouped = rows.reduce((out, row) => {
    const key = row.subject || row.user_id || 'both';
    if (!out[key]) out[key] = [];
    out[key].push(row);
    return out;
  }, {});
  const data = Object.entries(grouped).flatMap(([subject, items]) => [
    { _header: true, id: `header-${subject}`, subject, count: items.length }, ...items,
  ]);

  return (
    <View style={styles.container}>
      <AppHeader title="momi 的小本本" subtitle={`${rows.length} 条结构化记忆 · 模型更换也不会丢`} showBack onBack={onBack}
        rightAction={<TouchableOpacity style={styles.addHeader} onPress={openCreate}><Ionicons name="add" size={25} color={colors.primary} /></TouchableOpacity>} />
      <CenterToast visible={Boolean(toast)} message={toast} onDismiss={() => setToast('')} />
      <View style={styles.filterRow}>
        <Text style={styles.hint}>长按记忆可归档；seed 人格建议保留</Text>
        <TouchableOpacity style={[styles.filterChip, showArchived && styles.filterChipActive]} onPress={() => setShowArchived((v) => !v)}>
          <Text style={[styles.filterText, showArchived && styles.filterTextActive]}>{showArchived ? '隐藏归档' : '显示归档'}</Text>
        </TouchableOpacity>
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View> : (
        <FlatList
          data={data} keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing[8] }]}
          ListEmptyComponent={<EmptyState icon="book-outline" title="小本本还是空的" description="点右上角 + 添加，或在聊天里长按一条消息。" />}
          renderItem={({ item }) => item._header ? (
            <View style={styles.groupHeader}><Text style={styles.groupTitle}>{SUBJECT_LABELS[item.subject] || item.subject}</Text><Text style={styles.count}>{item.count}</Text></View>
          ) : (
            <TouchableOpacity style={[styles.card, item.is_archived && styles.archived]} activeOpacity={0.78} onPress={() => openEdit(item)} onLongPress={() => archive(item)}>
              <View style={styles.cardTop}>
                <Text style={styles.typeBadge}>{TYPE_LABELS[item.memory_type] || item.memory_type}</Text>
                <Text style={styles.stars}>{'★'.repeat(Math.max(1, Math.min(5, item.importance || 1)))}</Text>
                {item.source === 'seed' ? <Text style={styles.seedBadge}>人格种子</Text> : null}
                {item.is_archived ? <Text style={styles.archiveBadge}>已归档</Text> : null}
              </View>
              <Text style={styles.content}>{item.content}</Text>
              <Text style={styles.meta}>来源 {item.source || 'unknown'} · 命中 {item.hit_count || 0} 次</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={editorOpen} transparent animationType="fade" onRequestClose={() => setEditorOpen(false)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <View style={styles.modalTitleRow}><Text style={styles.modalTitle}>{draft.id ? '编辑记忆' : '添加记忆'}</Text><TouchableOpacity onPress={() => setEditorOpen(false)}><Ionicons name="close" size={24} color={colors.textSecondary} /></TouchableOpacity></View>
          <Text style={styles.label}>关于谁</Text>
          <View style={styles.optionRow}>{Object.keys(SUBJECT_LABELS).map((key) => <TouchableOpacity key={key} style={[styles.option, draft.subject === key && styles.optionActive]} onPress={() => setDraft((d) => ({ ...d, subject: key }))}><Text style={[styles.optionText, draft.subject === key && styles.optionTextActive]}>{SUBJECT_LABELS[key]}</Text></TouchableOpacity>)}</View>
          <Text style={styles.label}>类型</Text>
          <View style={styles.optionRow}>{['fact', 'preference', 'dislike', 'habit', 'promise', 'milestone'].map((key) => <TouchableOpacity key={key} style={[styles.option, draft.memory_type === key && styles.optionActive]} onPress={() => setDraft((d) => ({ ...d, memory_type: key }))}><Text style={[styles.optionText, draft.memory_type === key && styles.optionTextActive]}>{TYPE_LABELS[key]}</Text></TouchableOpacity>)}</View>
          <Text style={styles.label}>内容</Text>
          <TextInput style={styles.editor} value={draft.content} onChangeText={(content) => setDraft((d) => ({ ...d, content }))} placeholder="例如：momo 不吃香菜" placeholderTextColor={colors.textMuted} multiline maxLength={300} />
          <Text style={styles.label}>重要度：{draft.importance}</Text>
          <View style={styles.starRow}>{[1,2,3,4,5].map((n) => <TouchableOpacity key={n} onPress={() => setDraft((d) => ({ ...d, importance: n }))}><Ionicons name={n <= draft.importance ? 'star' : 'star-outline'} size={28} color={colors.warning} /></TouchableOpacity>)}</View>
          <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.5 }]} disabled={saving} onPress={save}>{saving ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.saveText}>保存</Text>}</TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  addHeader: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  filterRow: { flexDirection: 'row', alignItems: 'center', padding: spacing[3], backgroundColor: c.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  hint: { flex: 1, ...typography.caption, color: c.textMuted },
  filterChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: c.surfaceSoft },
  filterChipActive: { backgroundColor: c.primarySoft },
  filterText: { fontSize: 11, color: c.textSecondary },
  filterTextActive: { color: c.primary, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: spacing[4] },
  groupHeader: { flexDirection: 'row', alignItems: 'center', marginTop: spacing[3], marginBottom: spacing[2] },
  groupTitle: { ...typography.cardTitle, color: c.text, flex: 1 },
  count: { ...typography.caption, color: c.textMuted, backgroundColor: c.surfaceSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  card: { backgroundColor: c.card, borderRadius: radius.lg, padding: spacing[3], marginBottom: spacing[2], borderWidth: 1, borderColor: c.border },
  archived: { opacity: 0.5 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: spacing[2] },
  typeBadge: { fontSize: 10, color: c.primary, backgroundColor: c.primarySoft, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  stars: { fontSize: 11, color: c.warning },
  seedBadge: { fontSize: 9, color: c.success },
  archiveBadge: { fontSize: 9, color: c.textMuted },
  content: { ...typography.body, color: c.text, lineHeight: 21 },
  meta: { fontSize: 10, color: c.textMuted, marginTop: spacing[2] },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing[4] },
  modalCard: { backgroundColor: c.card, borderRadius: radius.xl, padding: spacing[4] },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[3] },
  modalTitle: { ...typography.sectionTitle, color: c.text },
  label: { ...typography.caption, color: c.textSecondary, fontWeight: '700', marginTop: spacing[3], marginBottom: spacing[1] },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  option: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  optionActive: { borderColor: c.primary, backgroundColor: c.primarySoft },
  optionText: { fontSize: 11, color: c.textSecondary },
  optionTextActive: { color: c.primary, fontWeight: '700' },
  editor: { minHeight: 90, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing[3], color: c.text, backgroundColor: c.surfaceSoft, textAlignVertical: 'top' },
  starRow: { flexDirection: 'row', gap: spacing[2] },
  saveButton: { height: 48, borderRadius: radius.md, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center', marginTop: spacing[4] },
  saveText: { ...typography.bodyMedium, color: c.textOnPrimary, fontWeight: '700' },
});
