import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  Platform,
  ActivityIndicator,
  Alert,
  Dimensions,
  ScrollView,
  AppState,
} from 'react-native';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { onSignal, emitSignal } from '../lib/realtimeSignal';
import { maybeCreateMomiInterjection } from '../lib/momiMention';
import { collectMomiContextImageRefs, resolveImageRefsForAI } from '../lib/momiChatImages';
import { fetchTodayCount } from '../lib/checkinUtils';
import { formatLocalDateTime } from '../lib/dateUtils';
import CheckinCreateModal from '../components/CheckinCreateModal';
import CheckinRecordModal from '../components/CheckinRecordModal';
import * as ImagePicker from 'expo-image-picker';
import { uploadImages } from '../lib/photoUtils';
import { CachedImage } from '../lib/imageCache';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, useTheme } from '../theme';
import { AppHeader, Button, Card, IconButton, Avatar } from '../components/ui';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Valid Users ───
const VALID_USERS = { momo: true, '苞米': true };

export default function ChatScreen({
  userId,
  onNavigateCheckinList,
  onNavigateGomokuGame,
  onNavigateDrawGuessGame,
  onNavigateEphemeralNote,
  onNavigateVoiceMailbox,
  onNavigateMomiKitchen,
  onNavigateMomiAssistant,
  onNavigateThemeSelector,
  onUnreadChange,
  isActive = true,
  refreshTrigger = 0,
}) {
  const { theme } = useTheme();
  const primary = colors.primary || '#FF6B35';
  const bg = colors.background || '#FAF9FC';
  const cardBg = colors.card || '#FFFFFF';
  const textMain = colors.text || '#27222F';
  const textMuted = colors.textSecondary || '#706879';
  const border = colors.border || '#EAE5EF';
  const accent = colors.accent || '#FF8FA3';
  const isLightPrimary = theme?.id === 'sakura';
  const meTextColor = isLightPrimary ? textMain : '#FFFFFF';
  const meTimeColor = isLightPrimary ? textMuted : 'rgba(255, 255, 255, 0.75)';

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [showMomiMention, setShowMomiMention] = useState(false);

  const handleInputChange = (text) => {
    setInputText(text);
    // 检测输入内容末尾是否包含待补全的 @ 标记
    const match = text.match(/(?:^|\s)@([a-zA-Z0-9\u4e00-\u9fa5]*)$/);
    if (match) {
      const q = match[1].toLowerCase();
      if (!q || 'momi'.startsWith(q)) {
        setShowMomiMention(true);
        return;
      }
    }
    setShowMomiMention(false);
  };

  const handleSelectMomiMention = () => {
    const replaced = inputText.replace(/(?:^|\s)@([a-zA-Z0-9\u4e00-\u9fa5]*)$/, (fullMatch) => {
      const prefix = fullMatch.startsWith(' ') ? ' ' : '';
      return `${prefix}@momi `;
    });
    setInputText(replaced);
    setShowMomiMention(false);
  };
  const flatListRef = useRef(null);
  const isInitialLoadRef = useRef(true);
  const prevMessagesLengthRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const isActiveRef = useRef(false);
  const unreadCountRef = useRef(0);
  const onUnreadChangeRef = useRef(onUnreadChange);
  useEffect(() => { onUnreadChangeRef.current = onUnreadChange; }, [onUnreadChange]);
  // 已计入未读的消息 id（信号与轮询共享，避免重复计数）
  const countedIdsRef = useRef(new Set());

  const setUnread = useCallback((n) => {
    unreadCountRef.current = n;
    if (onUnreadChangeRef.current) onUnreadChangeRef.current(n);
  }, []);

  // ─── Plus Panel & Modals ───
  const [plusPanelVisible, setPlusPanelVisible] = useState(false);
  const [checkinCreateVisible, setCheckinCreateVisible] = useState(false);
  const [checkinRecordVisible, setCheckinRecordVisible] = useState(false);
  const [activeThemes, setActiveThemes] = useState([]);
  const [selectedTheme, setSelectedTheme] = useState(null);

  // ─── momi 主动消息未读计数 (功能6) ───
  const [momiUnread, setMomiUnread] = useState(0);
  const refreshMomiUnread = useCallback(async () => {
    try {
      const { getProactiveUnreadCount } = require('../lib/momiUnread');
      const count = await getProactiveUnreadCount();
      setMomiUnread(count);
    } catch {}
  }, []);
  useEffect(() => {
    refreshMomiUnread();
  }, [refreshMomiUnread, isActive, refreshTrigger]);

  // Partner
  const partnerId = Object.keys(VALID_USERS).find((u) => u !== userId) || '';
  const keyboardHeight = useKeyboardHeight();
  const composerBottomOffset = keyboardHeight > 0 ? keyboardHeight : 0;

  useEffect(() => {
    if (keyboardHeight > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 50);
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 200);
    }
  }, [keyboardHeight]);

  // ─── Avatars state (功能4) ───
  const [avatars, setAvatars] = useState({ momo: '', '苞米': '', momi: '' });
  const loadAvatars = useCallback(async () => {
    try {
      const { fetchAllAvatars } = require('../lib/avatarService');
      const data = await fetchAllAvatars();
      if (data) setAvatars(data);
    } catch (e) {}
  }, []);

  useEffect(() => {
    loadAvatars();
  }, [loadAvatars, refreshTrigger]);

  // ─── Message quoting (引用) ───
  const [quotedMessage, setQuotedMessage] = useState(null);

  // 获取消息的引用预览文本（图片/打卡等类型用占位文案）
  const getQuotePreviewText = useCallback((msg) => {
    if (!msg) return '';
    const type = msg.type || 'text';
    if (type === 'text') return msg.content || '';
    if (type === 'image') return '[图片]';
    if (type === 'checkin_post') return msg.content || '[打卡]';
    if (type === 'checkin_invite') return `[打卡邀请] ${msg.metadata?.theme_title || ''}`;
    if (type === 'gomoku_invite') return '[五子棋邀请]';
    if (type === 'drawguess_invite') return '[你画我猜邀请]';
    if (type === 'system') return msg.content || '[系统消息]';
    return msg.content || '';
  }, []);

  // 长按消息弹出操作菜单（引用）
  const handleMessageLongPress = useCallback((item) => {
    const msgType = item.type || 'text';
    const isMomi = msgType === 'momi' || item.user_id === 'momi';
    // 允许引用文本/图片/打卡/momi消息（会话类消息）
    if (!isMomi && msgType !== 'text' && msgType !== 'image' && msgType !== 'checkin_post') return;
    Alert.alert(
      '消息操作',
      undefined,
      [
        {
          text: '引用',
          onPress: () => {
            const isImg = msgType === 'image' || item.content_type === 'image' || Boolean(item.metadata?.image_url || item.image_url);
            setQuotedMessage({
              id: item.id,
              user_id: isMomi ? 'momi' : item.user_id,
              content: getQuotePreviewText(item),
              type: msgType,
              content_type: isImg ? 'image' : (item.content_type || msgType),
              metadata: item.metadata || null,
              image_url: item.metadata?.image_url || item.image_url || null,
              isMomi,
            });
          },
        },
        { text: '取消', style: 'cancel' },
      ],
      { cancelable: true }
    );
  }, [getQuotePreviewText]);

  // ─── Init ───
  useEffect(() => {
    fetchMessages();
    fetchActiveThemes();
  }, []);

  // ─── Subscribe to new messages via realtime signal (腾讯 IM) ───
  // 信号与轮询共享同一个「计入未读」逻辑，countedIdsRef 防止重复计数
  const noteUnreadIfPartner = useCallback((msg) => {
    if (!msg || msg.user_id === userId) return;
    if (isActiveRef.current) return;
    if (countedIdsRef.current.has(msg.id)) return;
    countedIdsRef.current.add(msg.id);
    setUnread(unreadCountRef.current + 1);
  }, [setUnread]);

  useEffect(() => {
    const unsub = onSignal('chat:message', (msg) => {
      if (!msg) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [msg, ...prev];
      });
      noteUnreadIfPartner(msg);
    });
    return unsub;
  }, [userId, noteUnreadIfPartner]);

  // ─── momi 名字唤醒插话添加器 ───
  const appendInterjection = useCallback((row) => {
    if (!row) return;
    const momiMsg = {
      id: row.id,
      user_id: 'momi',
      content: row.content,
      type: 'momi',
      created_at: row.created_at,
      trigger_message_id: row.trigger_message_id,
      isMomi: true,
    };
    setMessages((prev) => {
      if (
        prev.some(
          (m) =>
            (row.trigger_message_id && m.trigger_message_id === row.trigger_message_id) ||
            m.id === row.id
        )
      ) {
        return prev;
      }
      return [momiMsg, ...prev];
    });
  }, []);

  // ─── 订阅 momi 名字唤醒插话 (momi_chat_interjections) ───
  useEffect(() => {
    const channel = supabase
      .channel('chat_screen_momi_interjections')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'momi_chat_interjections',
          filter: 'couple_id=eq.momo_and_baomi',
        },
        (payload) => {
          appendInterjection(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [appendInterjection]);

  // ─── 轮询兜底：定时拉取保证消息/邀请及插话近实时显示 ───
  const pollMessages = useCallback(async () => {
    try {
      const [msgRes, interjectionRes] = await Promise.all([
        fetchWithTimeout(() =>
          supabase
            .from('messages')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50)
        ),
        fetchWithTimeout(() =>
          supabase
            .from('momi_chat_interjections')
            .select('*')
            .eq('couple_id', 'momo_and_baomi')
            .order('created_at', { ascending: false })
            .limit(20)
        ).catch(() => ({ data: [], error: null })),
      ]);

      if (msgRes.error) throw msgRes.error;
      const rawData = msgRes.data || [];
      const interjectionMsgs = (interjectionRes?.data || []).map((row) => ({
        id: row.id,
        user_id: 'momi',
        content: row.content,
        type: 'momi',
        created_at: row.created_at,
        trigger_message_id: row.trigger_message_id,
        isMomi: true,
      }));

      const incoming = [...rawData, ...interjectionMsgs];
      if (incoming.length === 0) return;

      const newOnes = [];
      setMessages((prev) => {
        const prevIds = new Set(prev.map((m) => m.id));
        const prevTriggerIds = new Set(
          prev.filter((m) => m.trigger_message_id).map((m) => m.trigger_message_id)
        );
        for (const m of incoming) {
          if (!prevIds.has(m.id) && (!m.trigger_message_id || !prevTriggerIds.has(m.trigger_message_id))) {
            newOnes.push(m);
          }
        }
        if (newOnes.length === 0) return prev;
        const merged = [...newOnes, ...prev]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 100);
        return merged;
      });
      // 信号漏掉的消息也补计未读
      newOnes.forEach(noteUnreadIfPartner);
    } catch (e) {
      // 静默失败，不打扰用户
    }
  }, [noteUnreadIfPartner]);

  useEffect(() => {
    const interval = setInterval(pollMessages, 8000);
    return () => clearInterval(interval);
  }, [pollMessages]);

  // ─── Reconnect on app foreground ───
  // IM SDK 自带断线重连，这里仅做一次 DB 拉取兜底，防止漏消息。
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active') {
        fetchMessages();
      }
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  // ─── Refresh when Chat tab becomes active ───
  // The screen stays mounted when hidden; refresh data when user returns to Chat
  useEffect(() => {
    if (isActive && !isActiveRef.current) {
      // Tab just became active — refresh messages & clear unread
      fetchMessages();
      setUnread(0);
    }
    isActiveRef.current = isActive;
  }, [isActive, setUnread]);

  // ─── Refresh when returning from fullscreen (e.g. game invite sent) ───
  const prevRefreshRef = useRef(refreshTrigger);
  useEffect(() => {
    if (refreshTrigger !== prevRefreshRef.current) {
      prevRefreshRef.current = refreshTrigger;
      fetchMessages();
    }
  }, [refreshTrigger]);

  // ─── Scroll behavior management ───
  const handleScroll = useCallback((event) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isNearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 150;
    isNearBottomRef.current = isNearBottom;
  }, []);

  const messagesLenRef = useRef(0);
  useEffect(() => { messagesLenRef.current = messages.length; }, [messages]);

  const handleContentSizeChange = useCallback(() => {
    if (!flatListRef.current) return;
    prevMessagesLengthRef.current = messagesLenRef.current;
  }, []);

  // ─── Fetch Messages ───
  useEffect(() => {
    // Keyboard adjustments are handled automatically by inverted list
  }, [keyboardHeight]);

  const fetchMessages = async () => {
    try {
      const [msgRes, interjectionRes] = await Promise.all([
        fetchWithTimeout(() =>
          supabase
            .from('messages')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50)
        ),
        fetchWithTimeout(() =>
          supabase
            .from('momi_chat_interjections')
            .select('*')
            .eq('couple_id', 'momo_and_baomi')
            .order('created_at', { ascending: false })
            .limit(20)
        ).catch(() => ({ data: [], error: null })),
      ]);

      if (msgRes.error) throw msgRes.error;
      const baseMsgs = msgRes.data || [];
      const interjectionMsgs = (interjectionRes?.data || []).map((row) => ({
        id: row.id,
        user_id: 'momi',
        content: row.content,
        type: 'momi',
        created_at: row.created_at,
        trigger_message_id: row.trigger_message_id,
        isMomi: true,
      }));

      const merged = [...baseMsgs, ...interjectionMsgs].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      );
      setMessages(merged);
    } catch (error) {
      console.error('Error fetching messages:', error);
      Alert.alert('网络有点开小差', '请尝试下拉刷新或稍后再试');
    } finally {
      setLoading(false);
    }
  };

  // ─── Fetch Active Themes ───
  const fetchActiveThemes = async () => {
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase
          .from('checkin_themes')
          .select('*')
          .eq('status', 'active')
          .or(`creator_id.eq.${userId},partner_id.eq.${userId}`)
          .order('created_at', { ascending: false })
      );

      if (error) throw error;
      setActiveThemes(data || []);
    } catch (error) {
      console.error('Error fetching active themes:', error);
    }
  };

  // ─── Send Text Message ───
  const sendMessage = async () => {
    const rawText = inputText.trim();
    if (!rawText || sending) return;

    const isQuoteMomi = Boolean(quotedMessage && (quotedMessage.user_id === 'momi' || quotedMessage.isMomi));
    const quotedContent = quotedMessage?.content;

    setShowMomiMention(false);
    setSending(true);
    try {
      const insertData = {
        user_id: userId,
        content: rawText,
        type: 'text',
      };

      // 带引用消息时写入 metadata.quote
      const quoteForMomi = quotedMessage;
      if (quotedMessage) {
        insertData.metadata = {
          quote: {
            message_id: quotedMessage.id,
            user_id: quotedMessage.user_id === 'momi' ? 'momi' : quotedMessage.user_id,
            content: quotedMessage.content,
            type: quotedMessage.type,
            image_url: quotedMessage.image_url || quotedMessage.metadata?.image_url || null,
          },
        };
      }

      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('messages').insert([insertData]).select()
      );

      if (error) throw error;
      setInputText('');
      setQuotedMessage(null);
      // 立即添加到本地消息列表，同时通知对方
      if (data && data[0]) {
        const sentMessage = data[0];
        setMessages((prev) => {
          if (prev.some((m) => m.id === sentMessage.id)) return prev;
          return [sentMessage, ...prev];
        });
        emitSignal('chat:message', sentMessage).catch((e) => console.warn('[Chat] emitMessage failed:', e.message));
        setTimeout(() => {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        }, 100);

        // ─── 触发 momi 名字唤醒 / 引用插话（仅在发送端调用并写入 momi_chat_interjections）───
        (async () => {
          try {
            const imageRefs = collectMomiContextImageRefs({
              messages,
              quotedMessage: quoteForMomi,
              now: new Date(),
              windowMinutes: 10,
              maxImages: 4,
            });
            const resolvedImages = await resolveImageRefsForAI(imageRefs).catch((imgErr) => {
              console.warn('[Chat] 图片签名 URL 解析异常:', imgErr.message);
              return { urls: [], failed: [] };
            });

            const recentHistory = messages.slice(0, 16).reverse().map((m) => {
              const mSender = m.user_id === userId ? 'me' : (m.user_id === 'momi' ? 'momi' : 'partner');
              const senderName = m.user_id === 'baomi' ? '苞米' : (m.user_id === 'momo' ? 'momo' : (m.user_id || '用户'));
              const isImg = m.type === 'image' || m.content_type === 'image' || Boolean(m.metadata?.image_url || m.image_url);
              const rawContent = (m.content || '').trim();
              const displayContent = rawContent || (isImg ? `[${senderName} 发了一张图片]` : '');

              return {
                sender: mSender,
                content: displayContent,
                content_type: isImg ? 'image' : (m.content_type || m.type || 'text'),
                image_urls: isImg ? (m.metadata?.image_url ? [m.metadata.image_url] : (m.image_url ? [m.image_url] : [])) : [],
              };
            });

            const interjectionRow = await maybeCreateMomiInterjection({
              isSender: true,
              userId,
              triggerMessageId: sentMessage.id,
              text: sentMessage.content,
              message: sentMessage.content,
              recentChatHistory: recentHistory,
              isQuote: isQuoteMomi,
              quotedContent: quotedContent || '',
              images: resolvedImages.urls || [],
            });
            if (interjectionRow) {
              appendInterjection(interjectionRow);
            }
          } catch (err) {
            console.warn('[Chat] 名字唤醒插话触发异常:', err.message);
          }
        })();
      }

      // 每 30 条消息自动触发一次记忆提取
      if (messages.length > 0 && messages.length % 30 === 0) {
        try {
          const { extractAndSaveMemories } = require('../lib/momiAssistant');
          extractAndSaveMemories(messages.slice(0, 20));
        } catch (memErr) {
          console.warn('[Chat] 记忆提炼失败:', memErr.message);
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('错误', '发送失败，请重试');
    } finally {
      setSending(false);
    }
  };

  // ─── Create Checkin Theme ───
  const handleCreateCheckinTheme = async (themeData) => {
    try {
      // 1. Insert theme
      const { data: themeResult, error: themeError } = await fetchWithTimeout(() =>
        supabase.from('checkin_themes').insert([themeData]).select()
      );

      if (themeError) throw themeError;
      if (!themeResult || themeResult.length === 0) throw new Error('No data');
      const theme = themeResult[0];

      // 2. Send invite message (store real names for system message)
      const { data: inviteMsg, error: msgError } = await fetchWithTimeout(() =>
        supabase.from('messages').insert([
          {
            user_id: userId,
            content: `${themeData.icon} ${themeData.title}`,
            type: 'checkin_invite',
            metadata: {
              theme_id: theme.id,
              theme_title: theme.title,
              theme_icon: theme.icon,
              creator_id: userId,
              creator_name: userId,
              partner_id: partnerId,
              partner_name: partnerId,
              status: 'pending',
            },
          },
        ]).select()
      );

      if (msgError) throw msgError;
      if (inviteMsg && inviteMsg[0]) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === inviteMsg[0].id)) return prev;
          return [inviteMsg[0], ...prev];
        });
        emitSignal('chat:message', inviteMsg[0]).catch((e) => console.warn('[Chat] emitInvite failed:', e.message));
      }

      setCheckinCreateVisible(false);
    } catch (error) {
      console.error('Error creating checkin theme:', error);
      throw error;
    }
  };

  // ─── Accept Checkin ───
  const handleAcceptCheckin = async (item) => {
    const metadata = item.metadata || {};
    const themeId = metadata.theme_id;
    const themeTitle = metadata.theme_title || '打卡';
    const creatorId = metadata.creator_id;

    if (!themeId) {
      Alert.alert('错误', '打卡主题数据异常');
      return;
    }

    try {
      // 1. Update theme
      const { error: updateError } = await fetchWithTimeout(() =>
        supabase
          .from('checkin_themes')
          .update({ status: 'active' })
          .eq('id', themeId)
      );

      if (updateError) throw updateError;

      // 2. Update the invite message metadata
      const { error: metaError } = await fetchWithTimeout(() =>
        supabase
          .from('messages')
          .update({ metadata: { ...metadata, status: 'active' } })
          .eq('id', item.id)
      );

      if (metaError) throw metaError;

      // 3. Send system message - use real names to avoid duplicate "我"
      const creatorName = metadata.creator_name || creatorId;
      const acceptorName = userId;
      const systemContent = `${creatorName} 和 ${acceptorName} 开启了「${themeTitle}」打卡，一起自由记录吧～`;

      const { data: sysMsg, error: sysError } = await fetchWithTimeout(() =>
        supabase.from('messages').insert([
          {
            user_id: userId,
            content: systemContent,
            type: 'system',
            metadata: { theme_id: themeId },
          },
        ]).select()
      );

      if (sysError) throw sysError;
      if (sysMsg && sysMsg[0]) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === sysMsg[0].id)) return prev;
          return [sysMsg[0], ...prev];
        });
        emitSignal('chat:message', sysMsg[0]).catch((e) => console.warn('[Chat] emitSysMsg failed:', e.message));
      }

      // 4. Update local state
      setMessages((prev) =>
        prev.map((m) =>
          m.id === item.id
            ? { ...m, metadata: { ...metadata, status: 'active' } }
            : m
        )
      );

      // 5. Refresh active themes
      fetchActiveThemes();
    } catch (error) {
      console.error('Error accepting checkin:', error);
      Alert.alert('错误', '接受失败，请重试');
    }
  };

  // ─── Send Photo ───
  const [sendingPhoto, setSendingPhoto] = useState(false);

  const handleSendPhoto = async () => {
    try {
      setPlusPanelVisible(false);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsMultipleSelection: true,
        selectionLimit: 9, // Max 9 at a time
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      setSendingPhoto(true);
      
      const uris = result.assets.map(a => a.uri);

      // Upload all to Supabase Storage concurrently using the robust utility
      const publicUrls = await uploadImages(uris);

      // Send messages
      const senderName = userId === 'baomi' ? '苞米' : (userId === 'momo' ? 'momo' : (userId || '用户'));
      const inserts = publicUrls.map((url) => ({
        user_id: userId,
        content: `[${senderName} 发了一张图片]`,
        type: 'image',
        metadata: { image_url: url },
      }));

      const { data: photoMsgs, error: msgError } = await supabase.from('messages').insert(inserts).select();

      if (msgError) throw msgError;
      if (photoMsgs) {
        setMessages((prev) => {
          const ids = new Set(photoMsgs.map((m) => m.id));
          const filtered = prev.filter((m) => !ids.has(m.id));
          return [...photoMsgs, ...filtered];
        });
        photoMsgs.forEach((m) => emitSignal('chat:message', m).catch((e) => console.warn('[Chat] emitPhoto failed:', e.message)));
      }
    } catch (error) {
      console.error('Error sending photo:', error);
      Alert.alert('错误', '发送图片失败，请重试');
    } finally {
      setSendingPhoto(false);
    }
  };

  // ─── Open Gomoku Lobby ───
  // 点击「+」面板的五子棋入口：进入游戏大厅（不发邀请），在大厅内点邀请按钮才发邀请
  const handleOpenGomokuLobby = () => {
    setPlusPanelVisible(false);
    onNavigateGomokuGame(null);
  };

  // ─── Open Draw Guess Lobby ───
  // 点击「+」面板的你画我猜入口：进入游戏大厅
  const handleOpenDrawGuessLobby = () => {
    setPlusPanelVisible(false);
    onNavigateDrawGuessGame(null);
  };

  // ─── Open Ephemeral Note ───
  // 点击「+」面板的小纸条入口：进入小纸条全屏页（内容不进入聊天记录）
  const handleOpenEphemeralNote = () => {
    setPlusPanelVisible(false);
    onNavigateEphemeralNote && onNavigateEphemeralNote();
  };

  // ─── Open Voice Mailbox ───
  // 点击「+」面板的语音信箱入口：进入语音信箱全屏页（内容不进入聊天记录）
  const handleOpenVoiceMailbox = () => {
    setPlusPanelVisible(false);
    onNavigateVoiceMailbox && onNavigateVoiceMailbox();
  };

  // ─── Open Gomoku (Join / Continue / View) ───
  // 点击邀请卡片：根据当前对局状态决定加入/继续/查看
  const handleOpenGomoku = async (item) => {
    const metadata = item.metadata || {};
    const gameId = metadata.game_id;
    if (!gameId) {
      Alert.alert('错误', '对局数据异常');
      return;
    }

    try {
      // 拉取最新对局状态
      const { data: game, error } = await fetchWithTimeout(() =>
        supabase.from('gomoku_games').select('*').eq('id', gameId).single()
      );

      if (error) throw error;
      if (!game) {
        Alert.alert('提示', '对局不存在');
        return;
      }

      // 受邀方首次加入：waiting → playing
      const isInvitee = game.invitee_id === userId;
      if (game.status === 'waiting' && isInvitee) {
        const { data: updatedGame, error: joinError } = await fetchWithTimeout(() =>
          supabase
            .from('gomoku_games')
            .update({ status: 'playing' })
            .eq('id', gameId)
            .select()
        );
        if (joinError) throw joinError;
        // 通知邀请方对局已开始（IM 信号），GomokuGameScreen 内还有 3 秒轮询兜底
        if (updatedGame && updatedGame[0]) {
          emitSignal(`gomoku:${gameId}:update`, updatedGame[0]).catch((e) =>
            console.warn('[Chat] emitGomokuJoin failed:', e.message)
          );
        }
      }

      onNavigateGomokuGame(gameId);
    } catch (error) {
      console.error('Error opening gomoku:', error);
      Alert.alert('错误', '进入对局失败');
    }
  };

  // ─── Open Draw Guess (Join / Continue / View) ───
  // 点击你画我猜邀请卡片：进入对局（游戏界面内自动处理加入逻辑）
  const handleOpenDrawGuess = (item) => {
    const metadata = item.metadata || {};
    const gameId = metadata.game_id;
    if (!gameId) {
      Alert.alert('错误', '对局数据异常');
      return;
    }
    onNavigateDrawGuessGame(gameId);
  };

  // ─── Submit Checkin Record ───
  const handleSubmitRecord = async ({ content, media_urls }) => {
    if (!selectedTheme) return;

    try {
      // 1. Insert record FIRST
      const { error: recordError } = await fetchWithTimeout(() =>
        supabase.from('checkin_records').insert([
          {
            theme_id: selectedTheme.id,
            user_id: userId,
            content: content,
            media_urls: media_urls,
          },
        ])
      );

      if (recordError) throw recordError;

      // 2. Query the REAL today count from DB for THIS USER ONLY (includes the just-inserted record)
      const myTodayCount = await fetchTodayCount(selectedTheme.id, userId);

      // 3. Send checkin_post message with the DB-verified personal count
      const { data: postMsg, error: msgError } = await fetchWithTimeout(() =>
        supabase.from('messages').insert([
          {
            user_id: userId,
            content: content || `${selectedTheme.icon} 打卡成功`,
            type: 'checkin_post',
            metadata: {
              theme_id: selectedTheme.id,
              theme_title: selectedTheme.title,
              theme_icon: selectedTheme.icon,
              media_urls: media_urls,
              today_count: myTodayCount,
            },
          },
        ]).select()
      );

      if (msgError) throw msgError;
      if (postMsg && postMsg[0]) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === postMsg[0].id)) return prev;
          return [postMsg[0], ...prev];
        });
        emitSignal('chat:message', postMsg[0]).catch((e) => console.warn('[Chat] emitPost failed:', e.message));
      }

      setCheckinRecordVisible(false);
      setSelectedTheme(null);
    } catch (error) {
      console.error('Error submitting record:', error);
      throw error;
    }
  };

  // ─── Render Message ───
  const renderMessage = useCallback(({ item }) => {
    const isMe = item.user_id === userId;
    const msgType = item.type || 'text';

    // ── System message ──
    if (msgType === 'system') {
      return (
        <View style={styles.systemContainer}>
          <View style={styles.systemBubble}>
            <Text style={styles.systemText}>🔔 {item.content}</Text>
            <Text style={styles.systemTime}>{formatLocalDateTime(item.created_at)}</Text>
          </View>
        </View>
      );
    }

    // ── momi AI 专属宠物消息 (功能3) ──
    if (msgType === 'momi' || item.user_id === 'momi') {
      return (
        <View style={[styles.bubbleRow, styles.bubbleRowOther]}>
          <Avatar
            uri={avatars.momi}
            fallback="🐾"
            size={32}
            style={[styles.bubbleAvatar, { backgroundColor: colors.primarySoft || bg }]}
          />
          <TouchableOpacity
            style={[styles.momiChatBubble, { backgroundColor: cardBg, borderColor: accent }]}
            onLongPress={() => handleMessageLongPress(item)}
            activeOpacity={0.85}
          >
            <View style={styles.momiBadgeRow}>
              <Text style={[styles.momiBadge, { color: accent }]}>momi 🐾</Text>
              <Text style={[styles.momiTime, { color: textMuted }]}>{formatLocalDateTime(item.created_at)}</Text>
            </View>
            <Text style={[styles.momiMessageText, { color: textMain }]}>{item.content}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const renderAvatar = (isCurrentUser) => {
      if (isCurrentUser) {
        return (
          <Avatar
            uri={avatars[userId]}
            fallback="我"
            size={32}
            style={styles.bubbleAvatar}
          />
        );
      }
      return (
        <Avatar
          uri={avatars[item.user_id]}
          fallback={item.user_id === 'momo' ? 'M' : '苞'}
          size={32}
          style={styles.bubbleAvatar}
        />
      );
    };

    // ── Checkin Invite ──
    if (msgType === 'checkin_invite') {
      const metadata = item.metadata || {};
      const inviteStatus = metadata.status || 'pending';
      const themeIcon = metadata.theme_icon || '✨';
      const themeTitle = metadata.theme_title || '打卡';
      const isPending = inviteStatus === 'pending';
      const isCreator = isMe;

      return (
        <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowOther]}>
          {!isMe && renderAvatar(false)}
          <Card style={[styles.inviteCard, isMe ? styles.inviteCardMe : styles.inviteCardOther, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={styles.inviteHeader}>
              <View style={[styles.cardIconBg, { backgroundColor: colors.primarySoft || bg }]}>
                <Ionicons name="checkmark-circle" size={20} color={primary} />
              </View>
              <View style={styles.inviteHeaderInfo}>
                <Text style={[styles.inviteTitle, { color: textMain }]} numberOfLines={1}>{themeIcon} {themeTitle}</Text>
                <Text style={[styles.inviteSubtext, { color: textMuted }]} numberOfLines={1}>
                  {isCreator ? '我' : item.user_id} 发起了打卡邀请
                </Text>
              </View>
            </View>
            <View style={[styles.inviteDivider, { backgroundColor: border }]} />

            {isPending && !isCreator ? (
              <Button
                size="small"
                fullWidth
                onPress={() => handleAcceptCheckin(item)}
                style={styles.inviteAction}
              >
                接受邀请
              </Button>
            ) : isPending && isCreator ? (
              <View style={styles.inviteStatusRow}>
                <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                <Text style={styles.inviteStatusText}>等待对方接受...</Text>
              </View>
            ) : (
              <View style={styles.inviteStatusRow}>
                <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                <Text style={[styles.inviteStatusText, { color: colors.success }]}>已开始打卡</Text>
              </View>
            )}

            <Text style={styles.inviteTime}>{formatLocalDateTime(item.created_at)}</Text>
          </Card>
          {isMe && renderAvatar(true)}
        </View>
      );
    }

    // ── Gomoku Invite ──
    if (msgType === 'gomoku_invite') {
      const metadata = item.metadata || {};
      const creatorName = metadata.creator_name || item.user_id;
      const senderLabel = isMe ? '我' : creatorName;

      return (
        <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowOther]}>
          {!isMe && renderAvatar(false)}
          <Card style={[styles.gameCard, isMe ? styles.gameCardMe : styles.gameCardOther]}>
            <View style={styles.inviteHeader}>
              <View style={[styles.cardIconBg, { backgroundColor: colors.neutral[200] }]}>
                <Ionicons name="game-controller-outline" size={20} color={colors.primary[700]} />
              </View>
              <View style={styles.inviteHeaderInfo}>
                <Text style={styles.inviteTitle} numberOfLines={1}>五子棋对局</Text>
                <Text style={styles.inviteSubtext} numberOfLines={1}>{senderLabel} 发起了五子棋邀请</Text>
              </View>
            </View>
            <View style={styles.inviteDivider} />
            <Button
              size="small"
              fullWidth
              onPress={() => handleOpenGomoku(item)}
              style={styles.inviteAction}
            >
              进入对局
            </Button>
            <Text style={styles.inviteTime}>{formatLocalDateTime(item.created_at)}</Text>
          </Card>
          {isMe && renderAvatar(true)}
        </View>
      );
    }

    // ── Draw Guess Invite ──
    if (msgType === 'drawguess_invite') {
      const metadata = item.metadata || {};
      const creatorName = metadata.creator_name || item.user_id;
      const senderLabel = isMe ? '我' : creatorName;

      return (
        <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowOther]}>
          {!isMe && renderAvatar(false)}
          <Card style={[styles.gameCard, isMe ? styles.gameCardMe : styles.gameCardOther]}>
            <View style={styles.inviteHeader}>
              <View style={[styles.cardIconBg, { backgroundColor: colors.coral[100] }]}>
                <Ionicons name="color-palette-outline" size={20} color={colors.coral[600]} />
              </View>
              <View style={styles.inviteHeaderInfo}>
                <Text style={styles.inviteTitle} numberOfLines={1}>你画我猜</Text>
                <Text style={styles.inviteSubtext} numberOfLines={1}>{senderLabel} 发起了你画我猜邀请</Text>
              </View>
            </View>
            <View style={styles.inviteDivider} />
            <Button
              size="small"
              fullWidth
              onPress={() => handleOpenDrawGuess(item)}
              style={styles.inviteAction}
            >
              进入对局
            </Button>
            <Text style={styles.inviteTime}>{formatLocalDateTime(item.created_at)}</Text>
          </Card>
          {isMe && renderAvatar(true)}
        </View>
      );
    }

    // ── Checkin Post ──
    if (msgType === 'checkin_post') {
      const metadata = item.metadata || {};
      const themeIcon = metadata.theme_icon || '✨';
      const themeTitle = metadata.theme_title || '打卡';
      const mediaUrls = metadata.media_urls || [];
      const todayCount = metadata.today_count || metadata.record_count || 0;
      const senderLabel = isMe ? '我' : item.user_id;

      return (
        <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowOther]}>
          {!isMe && renderAvatar(false)}
          <Card style={[styles.postCard, isMe ? styles.postCardMe : styles.postCardOther, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={styles.postHeader}>
              <View style={[styles.cardIconBg, { backgroundColor: colors.primarySoft || bg }]}>
                <Ionicons name="ribbon-outline" size={18} color={primary} />
              </View>
              <Text style={[styles.postHeaderTitle, { color: primary }]} numberOfLines={1}>{themeIcon} {themeTitle}</Text>
            </View>

            <View style={[styles.postDivider, { backgroundColor: border }]} />

            {item.content ? (
              <Text style={[styles.postContent, { color: textMain }]}>{item.content}</Text>
            ) : null}

            {mediaUrls.length > 0 && (
              <View style={styles.postImageGrid}>
                {mediaUrls.slice(0, 9).map((url, index) => (
                  <CachedImage
                    key={index}
                    source={{ uri: url }}
                    style={[
                      styles.postImageThumb,
                      mediaUrls.length === 1 && styles.postImageSingle,
                    ]}
                    contentFit="cover"
                  />
                ))}
              </View>
            )}

            <View style={styles.postFooter}>
              <Text style={[styles.postCount, { color: primary }]}>{senderLabel}今日第 {todayCount} 次打卡</Text>
              <Text style={[styles.postTime, { color: textMuted }]}>{formatLocalDateTime(item.created_at)}</Text>
            </View>
          </Card>
          {isMe && renderAvatar(true)}
        </View>
      );
    }

    // ── Image message ──
    if (msgType === 'image') {
      const metadata = item.metadata || {};
      const imageUrl = metadata.image_url;
      if (imageUrl) {
        return (
          <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowOther]}>
            {!isMe && renderAvatar(false)}
            <TouchableOpacity
              style={[styles.imageBubble, isMe ? styles.imageBubbleMe : styles.imageBubbleOther]}
              onLongPress={() => handleMessageLongPress(item)}
              activeOpacity={0.8}
            >
              <CachedImage
                source={{ uri: imageUrl }}
                style={styles.chatImage}
                contentFit="cover"
              />
              <Text style={[styles.imageTime, { color: textMuted }]}>{formatLocalDateTime(item.created_at)}</Text>
            </TouchableOpacity>
            {isMe && renderAvatar(true)}
          </View>
        );
      }
    }

    // ── Normal text message ──
    const quoteData = item.metadata?.quote;
    return (
      <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowOther]}>
        {!isMe && renderAvatar(false)}
        <TouchableOpacity
          style={[
            styles.textBubble,
            isMe
              ? [styles.textBubbleMe, { backgroundColor: primary }]
              : [styles.textBubbleOther, { backgroundColor: cardBg, borderColor: border, borderWidth: 1 }],
          ]}
          onLongPress={() => handleMessageLongPress(item)}
          activeOpacity={0.8}
        >
          {quoteData && (
            <View
              style={[
                styles.quoteBlock,
                isMe
                  ? [styles.quoteBlockMe, { backgroundColor: 'rgba(255,255,255,0.15)', borderLeftColor: meTextColor }]
                  : [styles.quoteBlockOther, { backgroundColor: bg, borderLeftColor: primary }],
              ]}
            >
              <Text style={[styles.quoteSender, { color: isMe ? meTextColor : primary }]}>
                {quoteData.user_id === 'momi' ? 'momi 🐾' : quoteData.user_id === userId ? '我' : quoteData.user_id}
              </Text>
              <Text style={[styles.quoteContent, { color: isMe ? meTimeColor : textMuted }]} numberOfLines={2}>
                {quoteData.content}
              </Text>
            </View>
          )}
          <Text style={[styles.messageText, { color: isMe ? meTextColor : textMain }]}>{item.content}</Text>
          <Text style={[styles.messageTime, { color: isMe ? meTimeColor : textMuted }]}>{formatLocalDateTime(item.created_at)}</Text>
        </TouchableOpacity>
        {isMe && renderAvatar(true)}
      </View>
    );
  }, [userId, handleMessageLongPress, avatars, primary, bg, cardBg, textMain, textMuted, border, accent, meTextColor, meTimeColor, theme]);

  // ─── Loading ───
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primaryAction} />
        <Text style={styles.loadingText}>正在加载聊天...</Text>
      </View>
    );
  }

  const chatContent = (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Header */}
      <AppHeader
        compact
        leftAction={
          <Avatar
            fallback={partnerId === 'momo' ? 'M' : '苞'}
            size={36}
          />
        }
        title={partnerId}
        subtitle="我们的小世界"
        rightAction={
          activeThemes.length > 0 && onNavigateCheckinList ? (
            <IconButton
              icon="checkmark-circle-outline"
              size={24}
              color={primary}
              onPress={onNavigateCheckinList}
              accessibilityLabel="全部打卡"
            />
          ) : null
        }
      />

      {/* Active Themes Bar */}
      {activeThemes.length > 0 && (
        <View style={[styles.themeBar, { backgroundColor: cardBg, borderBottomColor: border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.themeBarContent}>
            {activeThemes.map((theme) => (
              <TouchableOpacity
                key={theme.id}
                style={[styles.themeChip, { backgroundColor: cardBg, borderColor: border, borderWidth: 1 }]}
                onPress={() => {
                  setSelectedTheme(theme);
                  setCheckinRecordVisible(true);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.themeChipIcon}>{theme.icon}</Text>
                <Text style={[styles.themeChipText, { color: primary }]}>{theme.title}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        inverted={true}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderMessage}
        extraData={`${theme?.id || 'default'}_${messages.length}`}
        contentContainerStyle={styles.messagesList}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={10}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onContentSizeChange={handleContentSizeChange}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.primarySoft || bg }]}>
              <Ionicons name="chatbubble-ellipses-outline" size={36} color={primary} />
            </View>
            <Text style={[styles.emptyText, { color: textMain }]}>从一句话开始</Text>
            <Text style={[styles.emptySubText, { color: textMuted }]}>记录我们的日常</Text>
          </View>
        }
      />

      <View style={[styles.composer, { marginBottom: composerBottomOffset, backgroundColor: cardBg }]}>

      {/* Plus Panel (4 列换行网格) */}
      {plusPanelVisible && (
        <View style={[styles.plusPanel, { backgroundColor: cardBg, borderTopColor: border }]}>
          {[
            { icon: 'checkmark-circle-outline', bg: colors.primarySoft || bg, color: primary, label: '二人打卡', onPress: () => { setPlusPanelVisible(false); setCheckinCreateVisible(true); } },
            { icon: 'images-outline', bg: colors.primarySoft || bg, color: primary, label: '发送照片', onPress: handleSendPhoto },
            { icon: 'restaurant-outline', bg: colors.primarySoft || bg, color: primary, label: 'momi厨房', onPress: () => { setPlusPanelVisible(false); onNavigateMomiKitchen && onNavigateMomiKitchen(); } },
            { icon: 'color-palette-outline', bg: colors.primarySoft || bg, color: primary, label: '主题换装', onPress: () => { setPlusPanelVisible(false); onNavigateThemeSelector && onNavigateThemeSelector(); } },
            { icon: 'game-controller-outline', bg: colors.primarySoft || bg, color: primary, label: '五子棋', onPress: handleOpenGomokuLobby },
            { icon: 'brush-outline', bg: colors.primarySoft || bg, color: primary, label: '你画我猜', onPress: handleOpenDrawGuessLobby },
            { icon: 'paper-plane-outline', bg: colors.primarySoft || bg, color: primary, label: '小纸条', onPress: handleOpenEphemeralNote },
            { icon: 'mic-outline', bg: colors.primarySoft || bg, color: primary, label: '语音信箱', onPress: handleOpenVoiceMailbox },
            {
              icon: 'paw-outline',
              bg: colors.primarySoft || bg,
              color: primary,
              label: 'momi 助手',
              badge: momiUnread,
              onPress: async () => {
                setPlusPanelVisible(false);
                try {
                  const { markProactiveSeen } = require('../lib/momiUnread');
                  await markProactiveSeen();
                  setMomiUnread(0);
                } catch {}
                onNavigateMomiAssistant && onNavigateMomiAssistant();
              },
            },
          ].map((item, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.plusPanelItem}
              onPress={item.onPress}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <View style={[styles.plusPanelIconBg, { backgroundColor: item.bg }]}>
                <Ionicons name={item.icon} size={24} color={item.color} />
                {Boolean(item.badge && item.badge > 0) && (
                  <View style={styles.plusPanelBadge}>
                    <Text style={styles.plusPanelBadgeText}>
                      {item.badge > 99 ? '99+' : item.badge}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[styles.plusPanelLabel, { color: textMain }]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* @momi 快速提及候选气泡 */}
      {showMomiMention && (
        <View style={styles.mentionPopupWrap}>
          <TouchableOpacity
            style={[styles.mentionPopupCard, { backgroundColor: cardBg, borderColor: border, shadowColor: primary }]}
            onPress={handleSelectMomiMention}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="提及 momi 小助手"
          >
            <View style={[styles.mentionAvatarWrap, { backgroundColor: colors.primarySoft || bg }]}>
              <Text style={{ fontSize: 16 }}>🐾</Text>
            </View>
            <View style={styles.mentionInfoWrap}>
              <View style={styles.mentionTitleRow}>
                <Text style={[styles.mentionName, { color: primary }]}>momi</Text>
                <View style={[styles.mentionBadge, { backgroundColor: colors.primarySoft || bg }]}>
                  <Text style={[styles.mentionBadgeText, { color: primary }]}>专属小助手</Text>
                </View>
              </View>
              <Text style={[styles.mentionDesc, { color: textMuted }]}>随时 @ 问我菜谱、甜蜜日常或聊天~</Text>
            </View>
            <View style={[styles.mentionActionChip, { backgroundColor: bg }]}>
              <Text style={[styles.mentionActionText, { color: primary }]}>@momi</Text>
              <Ionicons name="add" size={14} color={primary} />
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* 引用消息条预览 */}
      {quotedMessage && (
        <View style={[styles.quotePreviewBar, { backgroundColor: cardBg, borderTopColor: border }]}>
          <View style={[styles.quotePreviewLeft, { backgroundColor: primary }]} />
          <View style={styles.quotePreviewContent}>
            <Text style={[styles.quotePreviewSender, { color: primary }]}>
              引用 {quotedMessage.user_id === 'momi' ? 'momi 🐾' : quotedMessage.user_id === userId ? '我' : quotedMessage.user_id}
            </Text>
            <Text style={[styles.quotePreviewText, { color: textMuted }]} numberOfLines={1}>
              {quotedMessage.content}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.quotePreviewClose, { backgroundColor: colors.primarySoft || bg }]}
            onPress={() => setQuotedMessage(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="取消引用"
          >
            <Ionicons name="close" size={14} color={primary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Input Bar */}
      <View style={[styles.inputBar, {
        backgroundColor: cardBg,
        borderTopColor: border,
        paddingBottom: spacing[2] + 2,
      }]}>
        <TouchableOpacity
          style={[styles.plusButton, { backgroundColor: bg }]}
          onPress={() => setPlusPanelVisible(!plusPanelVisible)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={plusPanelVisible ? 'close' : 'add'}
            size={24}
            color={primary}
          />
        </TouchableOpacity>
        <TextInput
          style={[styles.textInput, { backgroundColor: bg, color: textMain }]}
          value={inputText}
          onChangeText={handleInputChange}
          placeholder="说点什么..."
          placeholderTextColor={textMuted}
          multiline
          maxLength={500}
          onFocus={() => {
            setTimeout(() => {
              flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
            }, 100);
          }}
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: primary }, (!inputText.trim() || sending) && [styles.sendBtnDisabled, { backgroundColor: border }]]}
          onPress={sendMessage}
          disabled={!inputText.trim() || sending}
          activeOpacity={0.7}
        >
          {sending ? (
            <ActivityIndicator color={meTextColor} size="small" />
          ) : (
            <Ionicons name="send" size={18} color={meTextColor} />
          )}
        </TouchableOpacity>
      </View>
      </View>

      {/* Checkin Create Modal */}
      <CheckinCreateModal
        visible={checkinCreateVisible}
        onClose={() => setCheckinCreateVisible(false)}
        onCreate={handleCreateCheckinTheme}
        userId={userId}
        partnerId={partnerId}
      />

      {/* Checkin Record Modal */}
      <CheckinRecordModal
        visible={checkinRecordVisible}
        onClose={() => {
          setCheckinRecordVisible(false);
          setSelectedTheme(null);
        }}
        onSubmit={handleSubmitRecord}
        theme={selectedTheme}
        userId={userId}
      />
    </View>
  );

  return chatContent;
}

const styles = StyleSheet.create({
  // ── Container ──
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: spacing[2],
    color: colors.textSecondary,
    ...typography.body,
  },

  // ── Active Themes Bar ──
  themeBar: {
    backgroundColor: colors.surface,
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  themeBarContent: {
    paddingHorizontal: spacing[3],
    gap: spacing[2],
  },
  themeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.meSoft,
    borderRadius: radius.pill,
    paddingVertical: spacing[1] + 2,
    paddingHorizontal: spacing[3],
  },
  themeChipIcon: {
    fontSize: 14,
    marginRight: spacing[1],
  },
  themeChipText: {
    ...typography.label,
    color: colors.primary[700],
    fontWeight: '600',
  },

  // ── Messages List ──
  messagesList: {
    padding: spacing[3],
    paddingBottom: 100,
  },

  // ── Empty ──
  emptyContainer: {
    alignItems: 'center',
    marginTop: 60,
    paddingHorizontal: spacing[6],
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  emptyText: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
  },
  emptySubText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing[1],
  },

  // ── Message Bubbles ──
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: spacing[2] + 2,
    paddingHorizontal: spacing[1],
  },
  bubbleRowMe: {
    justifyContent: 'flex-end',
  },
  bubbleRowOther: {
    justifyContent: 'flex-start',
  },
  bubbleAvatar: {
    marginTop: 2,
  },

  // ── momi AI Chat Bubble (功能3) ──
  momiChatBubble: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing[3] + 2,
    paddingVertical: spacing[2] + 2,
    borderRadius: radius.lg,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#FFD6C7',
    maxWidth: '75%',
    marginLeft: spacing[1] + 2,
  },
  momiBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  momiBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FF6B35',
  },
  momiTime: {
    fontSize: 10,
    color: colors.textMuted,
  },
  momiMessageText: {
    ...typography.body,
    color: '#2D1B00',
    lineHeight: 20,
  },

  // ── Text Bubble ──
  textBubble: {
    maxWidth: '75%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing[3] + 2,
    paddingVertical: spacing[2] + 2,
  },
  textBubbleMe: {
    backgroundColor: colors.meSoft,
    borderBottomRightRadius: 5,
    marginLeft: spacing[1] + 2,
  },
  textBubbleOther: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 5,
    marginRight: spacing[1] + 2,
  },
  messageText: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  messageTime: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'right',
  },

  // ── Quote Block (inside bubble) ──
  quoteBlock: {
    borderRadius: radius.xs,
    padding: spacing[2],
    marginBottom: spacing[1] + 2,
    borderLeftWidth: 3,
    borderLeftColor: colors.primaryAction,
  },
  quoteBlockMe: {
    backgroundColor: 'rgba(140,105,202,0.10)',
  },
  quoteBlockOther: {
    backgroundColor: colors.neutral[100],
  },
  quoteSender: {
    ...typography.label,
    color: colors.primaryAction,
    fontWeight: '600',
    marginBottom: 2,
  },
  quoteContent: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // ── Quote Preview Bar (above input) ──
  quotePreviewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary[50],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  quotePreviewLeft: {
    width: 3,
    height: 32,
    backgroundColor: colors.primaryAction,
    borderRadius: 2,
    marginRight: spacing[2],
  },
  quotePreviewContent: {
    flex: 1,
  },
  quotePreviewSender: {
    ...typography.label,
    color: colors.primaryAction,
    fontWeight: '600',
    marginBottom: 2,
  },
  quotePreviewText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  quotePreviewClose: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary[100],
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing[2],
  },

  // ── System Message ──
  systemContainer: {
    alignItems: 'center',
    marginVertical: spacing[2] + 2,
    paddingHorizontal: spacing[5],
  },
  systemBubble: {
    backgroundColor: colors.neutral[100],
    borderRadius: radius.md,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3] + 2,
    maxWidth: '85%',
  },
  systemText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  systemTime: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },

  // ── Invite Card (shared) ──
  inviteCard: {
    maxWidth: '82%',
  },
  inviteCardMe: {
    marginLeft: spacing[1] + 2,
    backgroundColor: colors.meSoft,
    borderBottomRightRadius: 5,
  },
  inviteCardOther: {
    marginRight: spacing[1] + 2,
    borderBottomLeftRadius: 5,
  },
  gameCard: {
    maxWidth: '80%',
    minWidth: 220,
    backgroundColor: colors.primary[50],
  },
  gameCardMe: {
    marginLeft: spacing[1] + 2,
    borderBottomRightRadius: 5,
  },
  gameCardOther: {
    marginRight: spacing[1] + 2,
    borderBottomLeftRadius: 5,
  },
  cardIconBg: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing[2] + 2,
  },
  inviteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inviteHeaderInfo: {
    flex: 1,
  },
  inviteTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  inviteSubtext: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  inviteDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing[2] + 2,
  },
  inviteAction: {
    marginTop: spacing[1],
  },
  inviteStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2] + 2,
    marginTop: spacing[1],
  },
  inviteStatusText: {
    ...typography.bodyMedium,
    color: colors.textMuted,
    marginLeft: spacing[1] + 2,
  },
  inviteTime: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: spacing[1] + 2,
    textAlign: 'right',
  },

  // ── Post Card (Checkin Post) ──
  postCard: {
    maxWidth: '82%',
  },
  postCardMe: {
    marginLeft: spacing[1] + 2,
    backgroundColor: colors.meSoft,
    borderBottomRightRadius: 5,
  },
  postCardOther: {
    marginRight: spacing[1] + 2,
    borderBottomLeftRadius: 5,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postHeaderTitle: {
    ...typography.cardTitle,
    color: colors.primary[700],
  },
  postDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing[2],
  },
  postContent: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  postImageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1],
    marginTop: spacing[2] + 2,
  },
  postImageThumb: {
    width: (SCREEN_WIDTH * 0.82 - 32 - 8) / 3,
    height: (SCREEN_WIDTH * 0.82 - 32 - 8) / 3,
    borderRadius: radius.sm,
  },
  postImageSingle: {
    width: SCREEN_WIDTH * 0.82 - 32,
    height: 180,
    borderRadius: radius.md,
  },
  postFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[2] + 2,
  },
  postCount: {
    ...typography.bodyMedium,
    color: colors.primaryAction,
    fontWeight: '700',
  },
  postTime: {
    fontSize: 11,
    color: colors.textMuted,
  },

  // ── Image Bubble ──
  imageBubble: {
    maxWidth: '75%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  imageBubbleMe: {
    borderBottomRightRadius: 5,
    marginLeft: spacing[1] + 2,
  },
  imageBubbleOther: {
    borderBottomLeftRadius: 5,
    marginRight: spacing[1] + 2,
  },
  chatImage: {
    width: SCREEN_WIDTH * 0.6,
    height: SCREEN_WIDTH * 0.6 * 1.2,
  },
  imageTime: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'right',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },

  // ── Input Bar ──
  composer: {
    backgroundColor: colors.surface,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing[2] + 2,
    paddingVertical: spacing[2] + 2,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  plusButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing[2],
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.primary[50],
    borderRadius: 22,
    paddingHorizontal: spacing[3] + 2,
    paddingVertical: spacing[2] + 2,
    fontSize: 15,
    maxHeight: 120,
    color: colors.textPrimary,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryAction,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing[2],
  },
  sendBtnDisabled: {
    backgroundColor: colors.primaryActionDisabled,
  },

  // ── Plus Panel (4 列换行网格) ──
  plusPanel: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3] + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  plusPanelItem: {
    alignItems: 'center',
    width: '25%',
    paddingVertical: spacing[2],
  },
  plusPanelIconBg: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing[1] + 2,
  },
  plusPanelLabel: {
    ...typography.label,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  plusPanelBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.primaryAction || '#FF6B35',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  plusPanelBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },

  // ── @momi 提及候选弹窗 ──
  mentionPopupWrap: {
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
  },
  mentionPopupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    paddingVertical: spacing[2] + 2,
    paddingHorizontal: spacing[3],
    borderWidth: 1.5,
    borderColor: '#FFD6C7',
    shadowColor: '#FF6B35',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  mentionAvatarWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFF0EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[2],
  },
  mentionInfoWrap: {
    flex: 1,
  },
  mentionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mentionName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FF6B35',
  },
  mentionBadge: {
    backgroundColor: '#FFF0EB',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  mentionBadgeText: {
    fontSize: 10,
    color: '#FF6B35',
    fontWeight: '600',
  },
  mentionDesc: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  mentionActionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.primary[50],
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  mentionActionText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primaryAction,
  },
});
