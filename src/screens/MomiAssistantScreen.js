// momi 独立陪伴界面 V2：识图 / 情绪养成 / 主动消息 / 长按记忆 / 聊天内发布任务
// V4：隐藏顶栏「小本本」入口（功能与路由完整保留，可从 momi 设置进入）
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography, useTheme } from '../theme';
import { AppHeader, Avatar, CenterToast } from '../components/ui';
import {
  fetchAssistantMessages, saveAssistantMessage, chatWithMomi, uploadMomiChatImages,
  ensureIdentitySeeds,
} from '../lib/momiAssistant';
import { getMomiState, MOOD_EMOJI, GROWTH_THRESHOLDS } from '../lib/momiState';
import { createManualMemory, runMemoryMaintenance, extractAndSaveMemories } from '../lib/momiMemory';
import { formatTaskReceipt } from '../lib/momiTasks';
import { pickImage } from '../lib/imagePicker';
import { fetchAllAvatars } from '../lib/avatarService';
import { supabase } from '../lib/supabase';
import { formatLocalTime } from '../lib/dateUtils';
import {
  KeyboardAwareChatLayout,
  CHAT_LIST_KEYBOARD_PROPS,
  MAX_COMPOSER_INPUT_HEIGHT,
} from '../components/KeyboardAwareChatLayout';
import { useRawKeyboardHeight } from '../hooks/useKeyboardHeight';

function nextExp(state) {
  return GROWTH_THRESHOLDS[(state?.growth_level || 1) - 1] || GROWTH_THRESHOLDS.at(-1);
}

function messageImages(item) {
  return Array.isArray(item?.image_urls) ? item.image_urls.filter(Boolean) : [];
}

export default function MomiAssistantScreen({ userId, onBack, onNavigateSettings, onOpenAISettings }) {
  const insets = useSafeAreaInsets();
  // 用原始键盘高度判断「键盘是否弹起」（决定输入框底部内边距）；
  // 自适应补偿值在 resize 模式下约为 0，不能用于该判断。
  const keyboardHeight = useRawKeyboardHeight();
  const isKeyboardVisible = keyboardHeight > 0;
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const flatListRef = useRef(null);
  const handleOpenSettings = onOpenAISettings || onNavigateSettings;

  const [messages, setMessages] = useState([]);
  const [state, setState] = useState(null);
  const [avatars, setAvatars] = useState({});
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [selectedImages, setSelectedImages] = useState([]);
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [toast, setToast] = useState('');

  const appendUnique = useCallback((row) => {
    if (!row) return;
    setMessages((prev) => prev.some((m) => m.id === row.id) ? prev : [...prev, row]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const load = useCallback(async () => {
    const [history, currentState, currentAvatars] = await Promise.all([
      fetchAssistantMessages(80), getMomiState(), fetchAllAvatars(),
    ]);
    setMessages(history);
    setState(currentState);
    setAvatars(currentAvatars);
    setLoading(false);
    // 冷启动后台任务，不阻塞首屏
    ensureIdentitySeeds().catch(() => {});
    runMemoryMaintenance().catch(() => {});
    extractAndSaveMemories(history).catch(() => {});
  }, []);

  useEffect(() => { load().catch((e) => { setLoading(false); setToast(e.message); }); }, [load]);

  useEffect(() => {
    const channel = supabase.channel('momi_assistant_v2_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'momi_assistant_messages' }, (p) => appendUnique(p.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'momi_state' }, (p) => setState(p.new || state))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [appendUnique]);

  const pickImages = async () => {
    const assets = await pickImage({ allowsEditing: false, quality: 0.9, allowsMultipleSelection: true, selectionLimit: 4 });
    if (!assets) return;
    setSelectedImages((prev) => [...prev, ...assets.map((a) => a.uri)].slice(0, 4));
  };

  const rememberText = (item) => {
    if (!item.content) return;
    Alert.alert('写进 momi 的小本本？', `“${item.content.slice(0, 80)}”`, [
      { text: '取消', style: 'cancel' },
      { text: '记住', onPress: async () => {
        const row = await createManualMemory({
          subject: item.sender === 'momi' ? 'both' : item.sender,
          memory_type: 'fact', content: item.content, importance: 5,
          source_ref: item.id || null,
        });
        setToast(row ? '已经写进小本本啦 🐾' : '写入失败，请确认数据库迁移已执行');
      } },
    ]);
  };

  const handleSend = async () => {
    const text = inputText.trim();
    const localImages = [...selectedImages];
    if ((!text && !localImages.length) || sending) return;
    setSending(true);
    setInputText('');
    setSelectedImages([]);
    setUploadProgress(localImages.length ? 0.02 : 0);
    try {
      let uploaded = { urls: [], paths: [] };
      if (localImages.length) {
        uploaded = await uploadMomiChatImages(localImages, setUploadProgress);
      }
      const userMsg = await saveAssistantMessage({
        sender: userId, content: text, imageUrls: uploaded.urls, imagePaths: uploaded.paths,
      });
      appendUnique(userMsg);

      const recent = [...messages, userMsg].slice(-16);
      // 任务/提醒的创建与取消统一由 chatWithMomi 内部完成（唯一入口，避免重复创建）
      const res = await chatWithMomi({
        userId, message: text, images: uploaded.urls, recentChatHistory: recent, triggerSource: 'assistant',
        sourceMessageId: userMsg?.id || null,
      });
      let reply = res.content || res.reply;
      if (res.taskCreated) {
        reply = `${formatTaskReceipt(res.taskCreated)}\n${reply || ''}`.trim();
      } else if (res.taskCancelled && res.taskCancelled.count > 0) {
        const titles = (res.taskCancelled.titles || []).map((t) => `「${t}」`).join('、');
        reply = `🗑️ 已取消 ${res.taskCancelled.count} 条提醒：${titles}\n${reply || ''}`.trim();
      }
      if (!res.success) {
        const action = res.errorCode === 'VISION_UNSUPPORTED' ? '请换支持识图的模型' : '可到右上角设置检查 API';
        reply = `🐾 ${res.reply || 'momi 刚才没连上'}（${action}，错误码 ${res.errorCode || 'UNKNOWN'}）`;
      }
      const momiMsg = await saveAssistantMessage({ sender: 'momi', content: reply, triggerSource: 'assistant' });
      appendUnique(momiMsg);
      if (res.state) setState(res.state);
    } catch (err) {
      setInputText(text);
      setSelectedImages(localImages);
      Alert.alert('发送失败', `${err.message}\n\n文字和图片已保留，可重试。`);
    } finally {
      setSending(false);
      setUploadProgress(0);
    }
  };

  const renderImages = (urls) => urls.length ? (
    <View style={styles.bubbleImages}>
      {urls.map((url, i) => <Image key={`${url}-${i}`} source={{ uri: url }} style={styles.bubbleImage} resizeMode="cover" />)}
    </View>
  ) : null;

  const renderItem = ({ item }) => {
    const isMomi = item.sender === 'momi';
    const isMe = item.sender === userId;
    const images = messageImages(item);
    return (
      <TouchableOpacity activeOpacity={0.9} onLongPress={() => rememberText(item)} delayLongPress={450}>
        <View style={[styles.messageRow, isMe && styles.messageRowMe]}>
          {!isMe ? <Avatar uri={isMomi ? avatars.momi : avatars[item.sender]} fallback={isMomi ? '🐾' : item.sender === 'momo' ? 'M' : '苞'} size={36} /> : null}
          <View style={[styles.messageBody, isMe && styles.messageBodyMe]}>
            <View style={[styles.metaRow, isMe && styles.metaRowMe]}>
              <Text style={[styles.sender, isMomi && { color: colors.primary }]}>{isMe ? '我' : item.sender}</Text>
              {item.is_proactive ? <Text style={styles.proactiveBadge}>{item.trigger_source === 'scheduled_reminder' ? '提醒' : '主动来找你'}</Text> : null}
              <Text style={styles.time}>{formatLocalTime(item.created_at)}</Text>
            </View>
            <View style={[styles.bubble, isMe ? styles.myBubble : isMomi ? styles.momiBubble : styles.otherBubble]}>
              {renderImages(images)}
              {item.content ? <Text style={[styles.bubbleText, isMe && styles.myBubbleText]}>{item.content}</Text> : null}
            </View>
          </View>
          {isMe ? <Avatar uri={avatars[userId]} fallback={userId === 'momo' ? 'M' : '苞'} size={36} /> : null}
        </View>
      </TouchableOpacity>
    );
  };

  const maxExp = nextExp(state || {});
  const expRatio = Math.min(1, (state?.growth_exp || 0) / Math.max(1, maxExp));
  const firstAt = messages[0]?.created_at;
  const companionDays = firstAt ? Math.max(1, Math.ceil((Date.now() - new Date(firstAt).getTime()) / 86400000)) : 1;

  return (
    <View style={styles.container}>
      <AppHeader
        title="momi"
        subtitle={`陪伴第 ${companionDays} 天 · ${MOOD_EMOJI[state?.mood] || '😌'} ${state?.mood || 'calm'}`}
        showBack onBack={onBack}
        rightAction={<View style={styles.headerActions}>
          {handleOpenSettings ? <TouchableOpacity style={styles.headerButton} onPress={handleOpenSettings}><Ionicons name="settings-outline" size={20} color={colors.textSecondary} /></TouchableOpacity> : null}
        </View>}
      />
      <CenterToast visible={Boolean(toast)} message={toast} duration={2200} onDismiss={() => setToast('')} />

      <View style={styles.growthBar}>
        <Avatar uri={avatars.momi} fallback="🐾" size={42} />
        <View style={styles.growthInfo}>
          <View style={styles.growthTitleRow}>
            <Text style={styles.growthTitle}>Lv.{state?.growth_level || 1} · momi 正在长大</Text>
            <Text style={styles.growthExp}>{state?.growth_exp || 0}/{maxExp} EXP</Text>
          </View>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${expRatio * 100}%` }]} /></View>
        </View>
      </View>

      <KeyboardAwareChatLayout listRef={flatListRef} headerHeight={120}>
        {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在呼唤 momi...</Text></View> : (
          <FlatList
            ref={flatListRef} data={messages} keyExtractor={(item, i) => item.id || `msg-${i}`}
            renderItem={renderItem} contentContainerStyle={[styles.listContent, { paddingBottom: 16 }]}
            {...CHAT_LIST_KEYBOARD_PROPS}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            onLayout={() => { setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100); }}
            ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyEmoji}>🐾</Text><Text style={styles.emptyTitle}>我是你们的宠物 momi</Text><Text style={styles.muted}>发张照片给我看，或者问问我你们的共同记录吧～</Text></View>}
            ListFooterComponent={sending ? <View style={styles.typing}><Text style={styles.typingText}>{uploadProgress > 0 && uploadProgress < 1 ? `图片上传中 ${Math.round(uploadProgress * 100)}%` : 'momi 正在想…'}</Text><ActivityIndicator size="small" color={colors.primary} /></View> : null}
          />
        )}

        {selectedImages.length ? <View style={styles.previewRow}>{selectedImages.map((uri, i) => (
          <View key={uri} style={styles.previewWrap}><Image source={{ uri }} style={styles.preview} /><TouchableOpacity style={styles.removeImage} onPress={() => setSelectedImages((p) => p.filter((_, n) => n !== i))}><Ionicons name="close" size={14} color={colors.textOnPrimary} /></TouchableOpacity></View>
        ))}</View> : null}
        <View style={[styles.composer, { paddingBottom: isKeyboardVisible ? 10 : Math.max(insets.bottom, 10) }]}>
          <TouchableOpacity style={styles.imageButton} onPress={pickImages} disabled={sending}><Ionicons name="image-outline" size={23} color={colors.primary} /></TouchableOpacity>
          <TextInput
            style={styles.input} placeholder="和 momi 聊聊天…" placeholderTextColor={colors.textMuted}
            value={inputText} onChangeText={setInputText} multiline maxLength={500}
            onFocus={() => { setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 150); }}
          />
          <TouchableOpacity style={[styles.send, ((!inputText.trim() && !selectedImages.length) || sending) && styles.disabled]} disabled={(!inputText.trim() && !selectedImages.length) || sending} onPress={handleSend}>
            <Ionicons name="arrow-up" size={20} color={colors.textOnPrimary} />
          </TouchableOpacity>
        </View>
      </KeyboardAwareChatLayout>
    </View>
  );
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  headerActions: { flexDirection: 'row' },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  growthBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: c.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  growthInfo: { flex: 1, marginLeft: spacing[3] },
  growthTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  growthTitle: { ...typography.caption, color: c.text, fontWeight: '700' },
  growthExp: { fontSize: 10, color: c.textMuted },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: c.primarySoft, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: c.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
  muted: { ...typography.caption, color: c.textMuted, textAlign: 'center' },
  listContent: { padding: spacing[4], paddingBottom: spacing[6] },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: spacing[6] },
  emptyEmoji: { fontSize: 48, marginBottom: spacing[2] },
  emptyTitle: { ...typography.cardTitle, color: c.primary, marginBottom: spacing[1] },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], marginBottom: spacing[4] },
  messageRowMe: { justifyContent: 'flex-end' },
  messageBody: { maxWidth: '78%' },
  messageBodyMe: { alignItems: 'flex-end' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  metaRowMe: { justifyContent: 'flex-end' },
  sender: { fontSize: 11, color: c.textSecondary, fontWeight: '600' },
  time: { fontSize: 10, color: c.textMuted },
  proactiveBadge: { fontSize: 9, color: c.primary, backgroundColor: c.primarySoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  bubble: { borderRadius: radius.lg, padding: spacing[3], overflow: 'hidden' },
  momiBubble: { backgroundColor: c.card, borderTopLeftRadius: 4, borderWidth: 1, borderColor: c.primarySoft },
  otherBubble: { backgroundColor: c.card, borderTopLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  myBubble: { backgroundColor: c.primary, borderTopRightRadius: 4 },
  bubbleText: { ...typography.body, color: c.text, lineHeight: 21 },
  myBubbleText: { color: c.textOnPrimary },
  bubbleImages: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: spacing[2] },
  bubbleImage: { width: 132, height: 132, borderRadius: radius.md, backgroundColor: c.surfaceSoft },
  typing: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], alignSelf: 'flex-start', backgroundColor: c.card, borderRadius: radius.pill, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  typingText: { ...typography.caption, color: c.textSecondary },
  previewRow: { flexDirection: 'row', gap: spacing[2], padding: spacing[2], backgroundColor: c.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  previewWrap: { position: 'relative' },
  preview: { width: 58, height: 58, borderRadius: radius.sm },
  removeImage: { position: 'absolute', top: -5, right: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: c.error, alignItems: 'center', justifyContent: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2], paddingHorizontal: spacing[3], paddingTop: spacing[2], backgroundColor: c.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  imageButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 42, maxHeight: MAX_COMPOSER_INPUT_HEIGHT, backgroundColor: c.surfaceSoft, borderRadius: radius.lg, paddingHorizontal: spacing[3], paddingVertical: 10, color: c.text, ...typography.body },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.35 },
});
