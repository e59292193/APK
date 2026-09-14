// ═══════════════════════════════════════════════════════
// MomiAssistantScreen —— momi小助手独立陪伴界面 (功能2)
// 两个用户共用一份对话历史，实时同步
// ═══════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, shadows } from '../theme';
import { AppHeader, Avatar, CenterToast } from '../components/ui';
import {
  fetchAssistantMessages,
  saveAssistantMessage,
  chatWithMomi,
} from '../lib/momiAssistant';
import { supabase } from '../lib/supabase';
import { formatLocalTime } from '../lib/dateUtils';

export default function MomiAssistantScreen({
  userId,
  onBack,
  onNavigateSettings,
  onOpenAISettings,
}) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const flatListRef = useRef(null);
  const handleOpenSettings = onOpenAISettings || onNavigateSettings;

  const showToast = (msg) => {
    setToastMessage(msg);
    setToastVisible(true);
  };

  // 1. 初始化拉取历史消息
  const loadMessages = useCallback(async () => {
    try {
      const data = await fetchAssistantMessages(80);
      setMessages(data);
    } catch (err) {
      console.warn('[MomiAssistant] 加载消息失败:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // 2. 实时订阅消息同步
  useEffect(() => {
    const channel = supabase
      .channel('momi_assistant_realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'momi_assistant_messages',
        },
        (payload) => {
          if (payload.new) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.new.id)) return prev;
              return [...prev, payload.new];
            });
            setTimeout(() => {
              flatListRef.current?.scrollToEnd({ animated: true });
            }, 100);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 3. 发送消息逻辑
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    setInputText('');
    setSending(true);

    try {
      // 3.1 保存用户消息
      const userMsg = await saveAssistantMessage({
        sender: userId || '用户',
        content: text,
      });

      if (userMsg) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === userMsg.id)) return prev;
          return [...prev, userMsg];
        });
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
      }

      // 3.2 调用 AI 获取 momi 回复
      const recent = messages.slice(-8);
      const res = await chatWithMomi({
        userId,
        message: text,
        recentChatHistory: recent,
      });

      // 3.3 保存 momi 回复
      let replyContent = res.reply || 'momi 刚才打了个盹，请再说一遍吧~ 🐾';
      if (!res.success && res.reply) {
        replyContent = `🐾 ${res.reply}（可点击右上角⚙️图标配置 API）`;
      }

      const momiMsg = await saveAssistantMessage({
        sender: 'momi',
        content: replyContent,
      });

      if (momiMsg) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === momiMsg.id)) return prev;
          return [...prev, momiMsg];
        });
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      }
    } catch (err) {
      console.warn('[MomiAssistant] 发送失败:', err.message);
      showToast('发送失败，请稍后重试');
    } finally {
      setSending(false);
    }
  };

  const renderItem = ({ item }) => {
    const isMomi = item.sender === 'momi';
    const isMe = item.sender === userId;

    if (isMomi) {
      return (
        <View style={styles.momiMsgRow}>
          <View style={styles.momiAvatarWrap}>
            <Text style={{ fontSize: 18 }}>🐾</Text>
          </View>
          <View style={styles.momiBubbleWrap}>
            <View style={styles.momiNameRow}>
              <Text style={styles.momiName}>momi</Text>
              <Text style={styles.msgTime}>{formatLocalTime(item.created_at)}</Text>
            </View>
            <View style={styles.momiBubble}>
              <Text style={styles.momiText}>{item.content}</Text>
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.userMsgRow, isMe ? styles.userMsgRowMe : styles.userMsgRowOther]}>
        {!isMe && (
          <Avatar
            fallback={item.sender === 'momo' ? 'M' : '苞'}
            size={34}
            style={{ marginRight: spacing[2] }}
          />
        )}
        <View style={[styles.userBubbleWrap, isMe ? { alignItems: 'flex-end' } : {}]}>
          <View style={[styles.userNameRow, isMe ? { justifyContent: 'flex-end' } : {}]}>
            <Text style={styles.userName}>{isMe ? '我' : item.sender}</Text>
            <Text style={styles.msgTime}>{formatLocalTime(item.created_at)}</Text>
          </View>
          <View style={[styles.userBubble, isMe ? styles.userBubbleMe : styles.userBubbleOther]}>
            <Text style={[styles.userText, isMe ? styles.userTextMe : styles.userTextOther]}>
              {item.content}
            </Text>
          </View>
        </View>
        {isMe && (
          <Avatar
            fallback={userId === 'momo' ? 'M' : '苞'}
            size={34}
            style={{ marginLeft: spacing[2] }}
          />
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title="momi小助手"
        subtitle="情侣厨房专属伴侣 🐾"
        showBack
        onBack={onBack}
        rightAction={
          handleOpenSettings ? (
            <TouchableOpacity
              style={styles.headerSettingsBtn}
              onPress={handleOpenSettings}
              accessibilityLabel="AI 设置"
            >
              <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null
        }
      />

      <CenterToast
        visible={toastVisible}
        message={toastMessage}
        duration={2200}
        onDismiss={() => setToastVisible(false)}
      />

      {loading ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color={colors.primaryAction} />
          <Text style={styles.loadingText}>正在呼唤 momi 🐾...</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item, index) => item.id || `msg-${index}`}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: spacing[4] }]}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={{ fontSize: 44, marginBottom: spacing[2] }}>🐾</Text>
              <Text style={styles.emptyTitle}>我是你们的专属伴侣 momi</Text>
              <Text style={styles.emptyDesc}>
                问问我“今天吃什么？”或者和我分享你们的甜蜜日常吧~
              </Text>
            </View>
          }
        />
      )}

      {/* 底部输入框 */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.bottom : 0}
      >
        <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TextInput
            style={styles.input}
            placeholder="问问 momi 今天吃什么或者聊聊天..."
            placeholderTextColor={colors.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={300}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!inputText.trim() || sending) && styles.sendBtnDisabled,
            ]}
            disabled={!inputText.trim() || sending}
            onPress={handleSend}
            activeOpacity={0.8}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF7F2',
  },
  headerSettingsBtn: {
    padding: spacing[2],
  },
  centerLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing[2],
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: spacing[6],
  },
  emptyTitle: {
    ...typography.cardTitle,
    color: '#FF6B35',
    marginBottom: spacing[1],
  },
  emptyDesc: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  momiMsgRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing[4],
  },
  momiAvatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFF0EB',
    borderWidth: 1.5,
    borderColor: '#FFD6C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[2],
    marginTop: 2,
  },
  momiBubbleWrap: {
    maxWidth: '78%',
  },
  momiNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  momiName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FF6B35',
    marginRight: 6,
  },
  msgTime: {
    fontSize: 10,
    color: colors.textMuted,
  },
  momiBubble: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing[3] + 2,
    paddingVertical: spacing[3],
    borderRadius: radius.lg,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#FFE8DF',
    ...shadows.soft,
  },
  momiText: {
    ...typography.body,
    color: '#2D1B00',
    lineHeight: 22,
  },
  userMsgRow: {
    flexDirection: 'row',
    marginBottom: spacing[4],
  },
  userMsgRowMe: {
    justifyContent: 'flex-end',
  },
  userMsgRowOther: {
    justifyContent: 'flex-start',
  },
  userBubbleWrap: {
    maxWidth: '75%',
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  userName: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  userBubble: {
    paddingHorizontal: spacing[3] + 2,
    paddingVertical: spacing[3] - 2,
    borderRadius: radius.lg,
  },
  userBubbleMe: {
    backgroundColor: colors.primaryAction,
    borderTopRightRadius: 4,
  },
  userBubbleOther: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  userText: {
    ...typography.body,
    lineHeight: 20,
  },
  userTextMe: {
    color: '#FFFFFF',
  },
  userTextOther: {
    color: colors.textPrimary,
  },
  composerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: spacing[4],
    paddingVertical: 8,
    ...typography.body,
    color: colors.textPrimary,
    marginRight: spacing[2],
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: colors.primary[200],
    opacity: 0.6,
  },
});
