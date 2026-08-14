// ═══════════════════════════════════════════════════════
// DrawGuessModals —— 画廊 / 大图查看器 / 自定义词库
//
// 从 DrawGuessGameScreen 抽出：
//   • 主屏幕体积降下来，每帧重绘不再带着三个弹窗的 JSX 一起 diff
//   • 弹窗未打开时直接返回 null，不构建子树（原来 Modal 总是挂着）
//   • 图片改用 expo-image + memory-disk 缓存，二次打开画廊几乎瞬开
// ═══════════════════════════════════════════════════════
import React, { memo } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

const SCREEN_WIDTH = Dimensions.get('window').width;
const THUMB = Math.floor((SCREEN_WIDTH - 48) / 2);

const C = {
  primary: '#8C69CA',
  bg: '#FAF9FC',
  surface: '#FFFFFF',
  border: '#EFEAF6',
  text: '#3D3450',
  sub: '#8B8398',
  danger: '#D86560',
  ok: '#69B79B',
};

const RESULT_LABEL = {
  win: '猜中了',
  timeout: '超时',
  gaveup: '已公布答案',
};

function imageUri(item) {
  if (!item) return null;
  return item.image_url || item.url || item.public_url || null;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─────────────── 画廊 ───────────────
export const GalleryModal = memo(function GalleryModal({
  visible,
  loading,
  items,
  onClose,
  onOpenItem,
  onDeleteItem,
}) {
  if (!visible) return null;
  const list = items || [];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>我们的画廊</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={C.sub} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={C.primary} />
            </View>
          ) : list.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyEmoji}>🎨</Text>
              <Text style={styles.emptyText}>还没有保存过画作</Text>
              <Text style={styles.emptyHint}>画完一轮后点「保存画作」就会出现在这里</Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.grid}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews
            >
              {list.map((item) => (
                <View key={String(item.id)} style={styles.card}>
                  <TouchableOpacity activeOpacity={0.85} onPress={() => onOpenItem && onOpenItem(item)}>
                    <Image
                      style={styles.thumb}
                      source={{ uri: imageUri(item) }}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={120}
                    />
                  </TouchableOpacity>
                  <View style={styles.cardMeta}>
                    <Text style={styles.cardWord} numberOfLines={1}>
                      {item.word || '未知题目'}
                    </Text>
                    <Text style={styles.cardSub}>
                      {RESULT_LABEL[item.result] || ''} · {formatDate(item.created_at)}
                    </Text>
                  </View>
                  {onDeleteItem ? (
                    <TouchableOpacity
                      style={styles.cardDelete}
                      hitSlop={8}
                      onPress={() => onDeleteItem(item)}
                    >
                      <Ionicons name="trash-outline" size={15} color={C.danger} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
});

// ─────────────── 大图查看器 ───────────────
export const ViewerModal = memo(function ViewerModal({
  visible,
  item,
  saving,
  onClose,
  onSaveToAlbum,
}) {
  if (!visible || !item) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewerBackdrop} onPress={onClose}>
        <Pressable style={styles.viewerBody} onPress={() => {}}>
          <Image
            style={styles.viewerImage}
            source={{ uri: imageUri(item) }}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={150}
          />
          <Text style={styles.viewerWord}>{item.word || ''}</Text>
          <Text style={styles.viewerSub}>
            第 {item.round || '-'} 轮 · {RESULT_LABEL[item.result] || ''} ·{' '}
            {formatDate(item.created_at)}
          </Text>

          <View style={styles.viewerActions}>
            {onSaveToAlbum ? (
              <TouchableOpacity
                style={[styles.viewerBtn, styles.viewerBtnPrimary]}
                onPress={() => onSaveToAlbum(item)}
                disabled={!!saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="download-outline" size={16} color="#FFF" />
                    <Text style={styles.viewerBtnPrimaryText}>保存到相册</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.viewerBtn} onPress={onClose}>
              <Text style={styles.viewerBtnText}>关闭</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

// ─────────────── 自定义词库 ───────────────
export const CustomWordsModal = memo(function CustomWordsModal({
  visible,
  loading,
  busy,
  words,
  input,
  onChangeInput,
  onAdd,
  onDelete,
  onClose,
}) {
  if (!visible) return null;
  const list = words || [];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* edge-to-edge 下 Android 键盘会盖住底 sheet，需 KAV 显式上推 */}
      <KeyboardAvoidingView style={styles.sheetBackdrop} behavior="padding">
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>我的私房词库</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={C.sub} />
            </TouchableOpacity>
          </View>

          <Text style={styles.sheetHint}>
            只有你自己看得到。轮到你画时，候选词里会提供一个你的自定义词。
          </Text>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={onChangeInput}
              placeholder="输入一个只有你俩懂的词…"
              placeholderTextColor={C.sub}
              maxLength={20}
              returnKeyType="done"
              onSubmitEditing={onAdd}
            />
            <TouchableOpacity
              style={[styles.addBtn, (!input || busy) && styles.addBtnDisabled]}
              onPress={onAdd}
              disabled={!input || !!busy}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="add" size={20} color="#FFF" />
              )}
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={C.primary} />
            </View>
          ) : list.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyEmoji}>✨</Text>
              <Text style={styles.emptyText}>还没有自定义词</Text>
            </View>
          ) : (
            <ScrollView style={styles.wordList} showsVerticalScrollIndicator={false}>
              {list.map((w) => (
                <View key={String(w.id)} style={styles.wordRow}>
                  <Text style={styles.wordText}>{w.word}</Text>
                  <TouchableOpacity hitSlop={10} onPress={() => onDelete && onDelete(w)}>
                    <Ionicons name="close-circle" size={20} color={C.sub} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(45,38,60,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    maxHeight: '82%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  sheetHint: { fontSize: 12, color: C.sub, lineHeight: 18, marginBottom: 12 },

  center: { paddingVertical: 44, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 34, marginBottom: 8 },
  emptyText: { fontSize: 14, color: C.text, fontWeight: '600' },
  emptyHint: { fontSize: 12, color: C.sub, marginTop: 6 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  card: {
    width: THUMB,
    backgroundColor: C.surface,
    borderRadius: 16,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
  },
  thumb: { width: '100%', height: THUMB, backgroundColor: '#F2EEF9' },
  cardMeta: { paddingHorizontal: 10, paddingVertical: 8 },
  cardWord: { fontSize: 13, fontWeight: '700', color: C.text },
  cardSub: { fontSize: 11, color: C.sub, marginTop: 2 },
  cardDelete: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },

  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,16,28,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  viewerBody: { width: '100%', alignItems: 'center' },
  viewerImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 18,
    backgroundColor: '#FFF',
  },
  viewerWord: { color: '#FFF', fontSize: 18, fontWeight: '700', marginTop: 16 },
  viewerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 6 },
  viewerActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  viewerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  viewerBtnPrimary: { backgroundColor: C.primary },
  viewerBtnText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  viewerBtnPrimaryText: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    fontSize: 14,
    color: C.text,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primary,
  },
  addBtnDisabled: { opacity: 0.45 },
  wordList: { maxHeight: 320 },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  wordText: { fontSize: 14, color: C.text, fontWeight: '600' },
});

export default { GalleryModal, ViewerModal, CustomWordsModal };
