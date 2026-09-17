// momi 独立陪伴界面 V5：可信记忆 / 幂等历史 / 离线恢复 / 聊天内任务
// V4：隐藏顶栏「小本本」入口（功能与路由完整保留，可从 momi 设置进入）
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography, useTheme } from '../theme';
import { AppHeader, Avatar, CenterToast } from '../components/ui';
import {
  chatWithMomi,
  uploadMomiChatImages,
  ensureIdentitySeeds,
  stripPromptArtifacts,
} from '../lib/momiAssistant';
import {
  assistantMessageStableKey,
  flushAssistantMessageOutbox,
  loadDurableAssistantMessages,
  mergeAssistantMessages,
  saveDurableAssistantMessage,
  subscribeDurableAssistantMessages,
} from '../lib/momiAssistantMessageStore';
import { resolveCurrentActor } from '../lib/auth';
import { getMomiState, MOOD_EMOJI, GROWTH_THRESHOLDS } from '../lib/momiState';
import { createManualMemory, runMemoryMaintenance } from '../lib/momiMemory';
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

const COUPLE_ID = 'momo_and_baomi';

function safeErrorCode(error) {
  return String(error?.code || error?.name || 'UNKNOWN').slice(0, 80);
}

function nextExp(state) {
  return GROWTH_THRESHOLDS[(state?.growth_level || 1) - 1] || GROWTH_THRESHOLDS.at(-1);
}

function messageImages(item) {
  return Array.isArray(item?.image_urls) ? item.image_urls.filter(Boolean) : [];
}

const AssistantMessageItem = React.memo(function AssistantMessageItem({
  item,
  userId,
  avatars,
  colors,
  styles,
  rememberText,
}) {
  const isMomi = item.sender === 'momi';
  const isMe = item.sender === userId;
  const images = messageImages(item);
  const syncLabel = item.status === 'pending' ? '待同步' : (item.status === 'failed' ? '同步失败' : '');
  const displayContent = stripPromptArtifacts(item.content);

  return (
    <TouchableOpacity activeOpacity={0.9} onLongPress={() => rememberText(item)} delayLongPress={450}>
      <View style={[styles.messageRow, isMe && styles.messageRowMe]}>
        {!isMe ? (
          <Avatar
            uri={isMomi ? avatars.momi : avatars[item.sender]}
            fallback={isMomi ? '🐾' : item.sender === 'momo' ? 'M' : '苞'}
            size={36}
          />
        ) : null}
        <View style={[styles.messageBody, isMe && styles.messageBodyMe]}>
          <View style={[styles.metaRow, isMe && styles.metaRowMe]}>
            <Text style={[styles.sender, isMomi && { color: colors.primary }]}>{isMe ? '我' : item.sender}</Text>
            {item.is_proactive ? (
              <Text style={styles.proactiveBadge}>
                {item.trigger_source === 'scheduled_reminder' ? '提醒' : '主动来找你'}
              </Text>
            ) : null}
            {syncLabel ? <Text style={styles.syncBadge}>{syncLabel}</Text> : null}
            <Text style={styles.time}>{formatLocalTime(item.created_at)}</Text>
          </View>
          <View style={[styles.bubble, isMe ? styles.myBubble : isMomi ? styles.momiBubble : styles.otherBubble]}>
            {images.length ? (
              <View style={styles.bubbleImages}>
                {images.map((url, index) => (
                  <Image key={`${url}-${index}`} source={{ uri: url }} style={styles.bubbleImage} resizeMode="cover" />
                ))}
              </View>
            ) : null}
            {displayContent ? (
              <Text style={[styles.bubbleText, isMe && styles.myBubbleText]}>{displayContent}</Text>
            ) : null}
          </View>
        </View>
        {isMe ? <Avatar uri={avatars[userId]} fallback={userId === 'momo' ? 'M' : '苞'} size={36} /> : null}
      </View>
    </TouchableOpacity>
  );
});

export default function MomiAssistantScreen({ userId, onBack, onNavigateSettings, onOpenAISettings }) {
  const insets = useSafeAreaInsets();
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

  const appendMerged = useCallback((row) => {
    if (!row) return;
    setMessages((previous) => mergeAssistantMessages(previous, [row]));
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const refreshHistory = useCallback(async () => {
    const history = await loadDurableAssistantMessages(80);
    setMessages(history);
    return history;
  }, []);

  const load = useCallback(async () => {
    const [history, currentState, currentAvatars] = await Promise.all([
      loadDurableAssistantMessages(80),
      getMomiState(),
      fetchAllAvatars(),
    ]);
    setMessages(history);
    setState(currentState);
    setAvatars(currentAvatars);
    setLoading(false);

    ensureIdentitySeeds().catch((error) => {
      console.warn('[MomiAssistantScreen] 人格种子后台同步失败:', safeErrorCode(error));
    });
    runMemoryMaintenance().catch((error) => {
      console.warn('[MomiAssistantScreen] 记忆维护后台执行失败:', safeErrorCode(error));
    });
    flushAssistantMessageOutbox({ limit: 20 })
      .then((result) => (result.synced > 0 ? refreshHistory() : null))
      .catch((error) => {
        console.warn('[MomiAssistantScreen] outbox 后台补传失败:', safeErrorCode(error));
      });
  }, [refreshHistory]);

  useEffect(() => {
    load().catch((error) => {
      setLoading(false);
      setToast(`加载失败（${safeErrorCode(error)}）`);
    });
  }, [load]);

  useEffect(() => {
    const unsubscribeMessages = subscribeDurableAssistantMessages({
      onMessage: appendMerged,
      onError: (code) => console.warn('[MomiAssistantScreen] 消息订阅异常:', code),
    });
    const stateChannel = supabase
      .channel('momi_assistant_v5_state')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'momi_state',
        filter: `couple_id=eq.${COUPLE_ID}`,
      }, (payload) => setState((previous) => payload.new || previous))
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[MomiAssistantScreen] 状态订阅异常:', status);
        }
      });
    return () => {
      unsubscribeMessages();
      const removal = supabase.removeChannel(stateChannel);
      if (removal?.catch) {
        removal.catch((error) => {
          console.warn('[MomiAssistantScreen] 状态退订失败:', safeErrorCode(error));
        });
      }
    };
  }, [appendMerged]);

  const pickImages = async () => {
    const assets = await pickImage({
      allowsEditing: false,
      quality: 0.9,
      allowsMultipleSelection: true,
      selectionLimit: 4,
    });
    if (!assets) return;
    setSelectedImages((previous) => [...previous, ...assets.map((asset) => asset.uri)].slice(0, 4));
  };

  const rememberText = (item) => {
    if (!item.content) return;
    Alert.alert('写进 momi 的小本本？', `“${item.content.slice(0, 80)}”`, [
      { text: '取消', style: 'cancel' },
      {
        text: '记住',
        onPress: async () => {
          const row = await createManualMemory({
            subject: item.sender === 'momi' ? 'both' : item.sender,
            memory_type: 'fact',
            content: item.content,
            importance: 5,
            source_ref: item.id || null,
          });
          setToast(row ? '已经写进小本本啦 🐾' : '写入失败，请确认数据库迁移已执行');
        },
      },
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
      const actorId = await resolveCurrentActor(userId);
      if (!actorId) throw new Error('无法确认当前账号，请重新登录后再试');

      let uploaded = { urls: [], paths: [] };
      if (localImages.length) {
        uploaded = await uploadMomiChatImages(localImages, setUploadProgress);
      }

      const userMessage = await saveDurableAssistantMessage({
        sender: actorId,
        content: text,
        imageUrls: uploaded.urls,
        imagePaths: uploaded.paths,
        triggerSource: 'assistant',
      });
      appendMerged(userMessage);

      const recent = mergeAssistantMessages(messages, [userMessage]).slice(-16);
      const sourceMessageId = userMessage.cloud_persisted === true ? userMessage.id : null;
      const response = await chatWithMomi({
        userId: actorId,
        message: text,
        images: uploaded.urls,
        recentChatHistory: recent,
        triggerSource: 'assistant',
        sourceMessageId,
      });

      let reply = response.content || response.reply;
      if (response.taskCreated) {
        reply = `${formatTaskReceipt(response.taskCreated)}\n${reply || ''}`.trim();
      } else if (response.taskCancelled && response.taskCancelled.count > 0) {
        const titles = (response.taskCancelled.titles || []).map((title) => `「${title}」`).join('、');
        reply = `🗑️ 已取消 ${response.taskCancelled.count} 条提醒：${titles}\n${reply || ''}`.trim();
      }
      if (!response.success) {
        const action = response.errorCode === 'VISION_UNSUPPORTED' ? '请换支持识图的模型' : '可到右上角设置检查 API';
        reply = `🐾 ${response.reply || 'momi 刚才没连上'}（${action}，错误码 ${response.errorCode || 'UNKNOWN'}）`;
      }

      const generationKey = response.success && userMessage.client_message_id
        ? `momi-chat:${userMessage.client_message_id}`
        : null;
      const momiMessage = await saveDurableAssistantMessage({
        sender: 'momi',
        content: reply,
        triggerSource: 'assistant',
        replyToMessageId: sourceMessageId || userMessage.client_message_id,
        generationKey,
      });
      appendMerged(momiMessage);
      if (response.state) setState(response.state);

      flushAssistantMessageOutbox({ limit: 10 })
        .then((result) => (result.synced > 0 ? refreshHistory() : null))
        .catch((error) => {
          console.warn('[MomiAssistantScreen] 发送后补传失败:', safeErrorCode(error));
        });
      if (!userMessage.cloud_persisted) {
        setToast('消息已保存在本地，联网后会自动同步');
      }
    } catch (error) {
      setInputText(text);
      setSelectedImages(localImages);
      Alert.alert('发送失败', `${error.message}\n\n文字和图片已保留，可重试。`);
    } finally {
      setSending(false);
      setUploadProgress(0);
    }
  };

  const renderItem = useCallback(({ item }) => (
    <AssistantMessageItem
      item={item}
      userId={userId}
      avatars={avatars}
      colors={colors}
      styles={styles}
      rememberText={rememberText}
    />
  ), [userId, avatars, colors, styles]);

  const maxExp = nextExp(state || {});
  const expRatio = Math.min(1, (state?.growth_exp || 0) / Math.max(1, maxExp));
  const firstAt = messages[0]?.created_at;
  const companionDays = firstAt
    ? Math.max(1, Math.ceil((Date.now() - new Date(firstAt).getTime()) / 86400000))
    : 1;

  return (
    <View style={styles.container}>
      <AppHeader
        title="momi"
        subtitle={`陪伴第 ${companionDays} 天 · ${MOOD_EMOJI[state?.mood] || '😌'} ${state?.mood || 'calm'}`}
        showBack
        onBack={onBack}
        rightAction={(
          <View style={styles.headerActions}>
            {handleOpenSettings ? (
              <TouchableOpacity style={styles.headerButton} onPress={handleOpenSettings}>
                <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      />
      <CenterToast
        visible={Boolean(toast)}
        message={toast}
        duration={2200}
        onDismiss={() => setToast('')}
      />

      <View style={styles.growthBar}>
        <Avatar uri={avatars.momi} fallback="🐾" size={42} />
        <View style={styles.growthInfo}>
          <View style={styles.growthTitleRow}>
            <Text style={styles.growthTitle}>Lv.{state?.growth_level || 1} · momi 正在长大</Text>
            <Text style={styles.growthExp}>{state?.growth_exp || 0}/{maxExp} EXP</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${expRatio * 100}%` }]} />
          </View>
        </View>
      </View>

      <KeyboardAwareChatLayout listRef={flatListRef} headerHeight={120}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>正在呼唤 momi...</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => assistantMessageStableKey(item)}
            renderItem={renderItem}
            contentContainerStyle={[styles.listContent, { paddingBottom: 16 }]}
            {...CHAT_LIST_KEYBOARD_PROPS}
            initialNumToRender={15}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews={Platform.OS === 'android'}
            onLayout={() => {
              setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
            }}
            ListEmptyComponent={(
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>🐾</Text>
                <Text style={styles.emptyTitle}>我是你们的宠物 momi</Text>
                <Text style={styles.muted}>发张照片给我看，或者问问我你们的共同记录吧～</Text>
              </View>
            )}
            ListFooterComponent={sending ? (
              <View style={styles.typing}>
                <Text style={styles.typingText}>
                  {uploadProgress > 0 && uploadProgress < 1
                    ? `图片上传中 ${Math.round(uploadProgress * 100)}%`
                    : 'momi 正在想…'}
                </Text>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null}
          />
        )}

        {selectedImages.length ? (
          <View style={styles.previewRow}>
            {selectedImages.map((uri, index) => (
              <View key={uri} style={styles.previewWrap}>
                <Image source={{ uri }} style={styles.preview} />
                <TouchableOpacity
                  style={styles.removeImage}
                  onPress={() => setSelectedImages((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Ionicons name="close" size={14} color={colors.textOnPrimary} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
        <View
          style={[
            styles.composer,
            { paddingBottom: isKeyboardVisible ? 10 : Math.max(insets.bottom, 10) },
          ]}
        >
          <TouchableOpacity style={styles.imageButton} onPress={pickImages} disabled={sending}>
            <Ionicons name="image-outline" size={23} color={colors.primary} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="和 momi 聊聊天…"
            placeholderTextColor={colors.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            onFocus={() => {
              setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 150);
            }}
          />
          <TouchableOpacity
            style={[
              styles.send,
              ((!inputText.trim() && !selectedImages.length) || sending) && styles.disabled,
            ]}
            disabled={(!inputText.trim() && !selectedImages.length) || sending}
            onPress={handleSend}
          >
            <Ionicons name="arrow-up" size={20} color={colors.textOnPrimary} />
          </TouchableOpacity>
        </View>
      </KeyboardAwareChatLayout>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerActions: { flexDirection: 'row' },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  growthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  growthInfo: { flex: 1, marginLeft: spacing[3] },
  growthTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  growthTitle: { ...typography.caption, color: colors.text, fontWeight: '700' },
  growthExp: { fontSize: 10, color: colors.textMuted },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primarySoft,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
  muted: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  listContent: { padding: spacing[4], paddingBottom: spacing[6] },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: spacing[6] },
  emptyEmoji: { fontSize: 48, marginBottom: spacing[2] },
  emptyTitle: { ...typography.cardTitle, color: colors.primary, marginBottom: spacing[1] },
  messageRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], marginBottom: spacing[4],
  },
  messageRowMe: { justifyContent: 'flex-end' },
  messageBody: { maxWidth: '78%' },
  messageBodyMe: { alignItems: 'flex-end' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  metaRowMe: { justifyContent: 'flex-end' },
  sender: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  time: { fontSize: 10, color: colors.textMuted },
  proactiveBadge: {
    fontSize: 9,
    color: colors.primary,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  syncBadge: {
    fontSize: 9,
    color: colors.warning || colors.textSecondary,
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  bubble: { borderRadius: radius.lg, padding: spacing[3], overflow: 'hidden' },
  momiBubble: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.primarySoft,
  },
  otherBubble: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  myBubble: { backgroundColor: colors.primary, borderTopRightRadius: 4 },
  bubbleText: { ...typography.body, color: colors.text, lineHeight: 21 },
  myBubbleText: { color: colors.textOnPrimary },
  bubbleImages: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: spacing[2],
  },
  bubbleImage: {
    width: 132, height: 132, borderRadius: radius.md, backgroundColor: colors.surfaceSoft,
  },
  typing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  typingText: { ...typography.caption, color: colors.textSecondary },
  previewRow: {
    flexDirection: 'row',
    gap: spacing[2],
    padding: spacing[2],
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  previewWrap: { position: 'relative' },
  preview: { width: 58, height: 58, borderRadius: radius.sm },
  removeImage: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  imageButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: MAX_COMPOSER_INPUT_HEIGHT,
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    color: colors.text,
    ...typography.body,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
});
