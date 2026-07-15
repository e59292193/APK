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
  StatusBar,
} from 'react-native';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { onSignal, emitSignal } from '../lib/realtimeSignal';
import { fetchTodayCount } from '../lib/checkinUtils';
import { formatLocalDateTime } from '../lib/dateUtils';
import CheckinCreateModal from '../components/CheckinCreateModal';
import CheckinRecordModal from '../components/CheckinRecordModal';
import * as ImagePicker from 'expo-image-picker';
import { uploadImages } from '../lib/photoUtils';
import { CachedImage } from '../lib/imageCache';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import { AppHeader, Button, Card, IconButton, Avatar } from '../components/ui';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Valid Users ───
const VALID_USERS = { momo: true, '苞米': true };

export default function ChatScreen({ userId, onNavigateCheckinList, onNavigateGomokuGame, onNavigateDrawGuessGame, onUnreadChange, isActive = true, refreshTrigger = 0 }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
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

  // Partner
  const partnerId = Object.keys(VALID_USERS).find((u) => u !== userId) || '';
  const keyboardHeight = useKeyboardHeight();
  const composerBottomOffset = keyboardHeight > 0 ? keyboardHeight : 0;

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
    // 仅允许引用文本/图片/打卡消息（会话类消息）
    if (msgType !== 'text' && msgType !== 'image' && msgType !== 'checkin_post') return;
    Alert.alert(
      '消息操作',
      undefined,
      [
        {
          text: '引用',
          onPress: () => {
            setQuotedMessage({
              id: item.id,
              user_id: item.user_id,
              content: getQuotePreviewText(item),
              type: msgType,
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

  // ─── 轮询兜底：腾讯 IM 信号偶发丢失时，定时拉取保证消息/邀请近实时显示 ───
  // 参照 DrawGuess 的 4 秒 fetchGame 轮询机制：信号是主通道，轮询是补漏网
  const pollMessages = useCallback(async () => {
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase
          .from('messages')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50)
      );
      if (error) throw error;
      if (!data || data.length === 0) return;
      const newOnes = [];
      setMessages((prev) => {
        const prevIds = new Set(prev.map((m) => m.id));
        for (const m of data) {
          if (!prevIds.has(m.id)) newOnes.push(m);
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
      const { data, error } = await fetchWithTimeout(() =>
        supabase
          .from('messages')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50)
      );

      if (error) throw error;
      const sortedData = data ? [...data] : [];
      setMessages(sortedData);
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
    if (!inputText.trim() || sending) return;

    setSending(true);
    try {
      const insertData = {
        user_id: userId,
        content: inputText.trim(),
        type: 'text',
      };

      // 带引用消息时写入 metadata.quote
      if (quotedMessage) {
        insertData.metadata = {
          quote: {
            message_id: quotedMessage.id,
            user_id: quotedMessage.user_id,
            content: quotedMessage.content,
            type: quotedMessage.type,
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
        setMessages((prev) => {
          if (prev.some((m) => m.id === data[0].id)) return prev;
          return [data[0], ...prev];
        });
        emitSignal('chat:message', data[0]).catch((e) => console.warn('[Chat] emitMessage failed:', e.message));
        // 确保 FlatList 滚动到最新消息（inverted 列表的 offset 0 = 底部）
        setTimeout(() => {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        }, 100);
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
      const inserts = publicUrls.map(url => ({
        user_id: userId,
        content: '',
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
          {!isMe && (
            <Avatar
              fallback={item.user_id === 'momo' ? 'M' : '苞'}
              size={30}
              style={styles.bubbleAvatar}
            />
          )}
          <Card style={[styles.inviteCard, isMe ? styles.inviteCardMe : styles.inviteCardOther]}>
            <View style={styles.inviteHeader}>
              <View style={[styles.cardIconBg, { backgroundColor: colors.primary[100] }]}>
                <Ionicons name="checkmark-circle" size={20} color={colors.primaryAction} />
              </View>
              <View style={styles.inviteHeaderInfo}>
                <Text style={styles.inviteTitle} numberOfLines={1}>{themeIcon} {themeTitle}</Text>
                <Text style={styles.inviteSubtext} numberOfLines={1}>
                  {isCreator ? '我' : item.user_id} 发起了打卡邀请
                </Text>
              </View>
            </View>
            <View style={styles.inviteDivider} />

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
          {isMe && (
            <Avatar fallback="我" size={30} style={styles.bubbleAvatar} />
          )}
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
          {!isMe && (
            <Avatar
              fallback={item.user_id === 'momo' ? 'M' : '苞'}
              size={30}
              style={styles.bubbleAvatar}
            />
          )}
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
          {isMe && (
            <Avatar fallback="我" size={30} style={styles.bubbleAvatar} />
          )}
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
          {!isMe && (
            <Avatar
              fallback={item.user_id === 'momo' ? 'M' : '苞'}
              size={30}
              style={styles.bubbleAvatar}
            />
          )}
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
          {isMe && (
            <Avatar fallback="我" size={30} style={styles.bubbleAvatar} />
          )}
        </View>
      );
    }

    // ── Checkin Post (Phase 2) ──
    if (msgType === 'checkin_post') {
      const metadata = item.metadata || {};
      const themeIcon = metadata.theme_icon || '✨';
      const themeTitle = metadata.theme_title || '打卡';
      const mediaUrls = metadata.media_urls || [];
      // Support both new (today_count) and legacy (record_count) metadata
      const todayCount = metadata.today_count || metadata.record_count || 0;
      const senderLabel = isMe ? '我' : item.user_id;

      return (
        <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowOther]}>
          {!isMe && (
            <Avatar
              fallback={item.user_id === 'momo' ? 'M' : '苞'}
              size={30}
              style={styles.bubbleAvatar}
            />
          )}
          <Card style={[styles.postCard, isMe ? styles.postCardMe : styles.postCardOther]}>
            {/* Post header */}
            <View style={styles.postHeader}>
              <View style={[styles.cardIconBg, { backgroundColor: colors.primary[100] }]}>
                <Ionicons name="ribbon-outline" size={18} color={colors.primaryAction} />
              </View>
              <Text style={styles.postHeaderTitle} numberOfLines={1}>{themeIcon} {themeTitle}</Text>
            </View>

            {/* Post divider */}
            <View style={styles.postDivider} />

            {/* Content */}
            {item.content ? (
              <Text style={styles.postContent}>{item.content}</Text>
            ) : null}

            {/* Image grid */}
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

            {/* Footer: personal count + time */}
            <View style={styles.postFooter}>
              <Text style={styles.postCount}>{senderLabel}今日第 {todayCount} 次打卡</Text>
              <Text style={styles.postTime}>{formatLocalDateTime(item.created_at)}</Text>
            </View>
          </Card>
          {isMe && (
            <Avatar fallback="我" size={30} style={styles.bubbleAvatar} />
          )}
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
            {!isMe && (
              <Avatar
                fallback={item.user_id === 'momo' ? 'M' : '苞'}
                size={30}
                style={styles.bubbleAvatar}
              />
            )}
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
              <Text style={styles.imageTime}>{formatLocalDateTime(item.created_at)}</Text>
            </TouchableOpacity>
            {isMe && (
              <Avatar fallback="我" size={30} style={styles.bubbleAvatar} />
            )}
          </View>
        );
      }
    }

    // ── Normal text message ──
    const quoteData = item.metadata?.quote;
    return (
      <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowOther]}>
        {!isMe && (
          <Avatar
            fallback={item.user_id === 'momo' ? 'M' : '苞'}
            size={30}
            style={styles.bubbleAvatar}
          />
        )}
        <TouchableOpacity
          style={[styles.textBubble, isMe ? styles.textBubbleMe : styles.textBubbleOther]}
          onLongPress={() => handleMessageLongPress(item)}
          activeOpacity={0.8}
        >
          {quoteData && (
            <View style={[styles.quoteBlock, isMe ? styles.quoteBlockMe : styles.quoteBlockOther]}>
              <Text style={styles.quoteSender}>
                {quoteData.user_id === userId ? '我' : quoteData.user_id}
              </Text>
              <Text style={styles.quoteContent} numberOfLines={2}>
                {quoteData.content}
              </Text>
            </View>
          )}
          <Text style={styles.messageText}>{item.content}</Text>
          <Text style={styles.messageTime}>{formatLocalDateTime(item.created_at)}</Text>
        </TouchableOpacity>
        {isMe && (
          <Avatar fallback="我" size={30} style={styles.bubbleAvatar} />
        )}
      </View>
    );
  }, [userId, handleMessageLongPress]);

  // ─── Loading ───
  if (loading) {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={colors.primaryAction} />
        <Text style={styles.loadingText}>正在加载聊天...</Text>
      </View>
    );
  }

  const chatContent = (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

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
              color={colors.primaryAction}
              onPress={onNavigateCheckinList}
              accessibilityLabel="全部打卡"
            />
          ) : null
        }
      />

      {/* Active Themes Bar */}
      {activeThemes.length > 0 && (
        <View style={styles.themeBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.themeBarContent}>
            {activeThemes.map((theme) => (
              <TouchableOpacity
                key={theme.id}
                style={styles.themeChip}
                onPress={() => {
                  setSelectedTheme(theme);
                  setCheckinRecordVisible(true);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.themeChipIcon}>{theme.icon}</Text>
                <Text style={styles.themeChipText}>{theme.title}</Text>
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
        extraData={messages.length}
        contentContainerStyle={styles.messagesList}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={10}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onContentSizeChange={handleContentSizeChange}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="chatbubble-ellipses-outline" size={36} color={colors.primary[300]} />
            </View>
            <Text style={styles.emptyText}>从一句话开始</Text>
            <Text style={styles.emptySubText}>记录我们的日常</Text>
          </View>
        }
      />

      <View style={[styles.composer, { marginBottom: composerBottomOffset }]}>
      {/* Quote Preview Bar */}
      {quotedMessage && (
        <View style={styles.quotePreviewBar}>
          <View style={styles.quotePreviewLeft} />
          <View style={styles.quotePreviewContent}>
            <Text style={styles.quotePreviewSender}>
              {quotedMessage.user_id === userId ? '我' : quotedMessage.user_id}
            </Text>
            <Text style={styles.quotePreviewText} numberOfLines={1}>
              {quotedMessage.content}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.quotePreviewClose}
            onPress={() => setQuotedMessage(null)}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={14} color={colors.primaryAction} />
          </TouchableOpacity>
        </View>
      )}

      {/* Plus Panel */}
      {plusPanelVisible && (
        <View style={styles.plusPanel}>
          <TouchableOpacity
            style={styles.plusPanelItem}
            onPress={() => {
              setPlusPanelVisible(false);
              setCheckinCreateVisible(true);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.plusPanelIconBg, { backgroundColor: colors.primary[100] }]}>
              <Ionicons name="checkmark-circle-outline" size={24} color={colors.primaryAction} />
            </View>
            <Text style={styles.plusPanelLabel}>二人打卡</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.plusPanelItem}
            onPress={handleSendPhoto}
            activeOpacity={0.7}
          >
            <View style={[styles.plusPanelIconBg, { backgroundColor: colors.mint[100] }]}>
              <Ionicons name="images-outline" size={24} color={colors.mint[600]} />
            </View>
            <Text style={styles.plusPanelLabel}>发送照片</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.plusPanelItem}
            onPress={handleOpenGomokuLobby}
            activeOpacity={0.7}
          >
            <View style={[styles.plusPanelIconBg, { backgroundColor: colors.neutral[200] }]}>
              <Ionicons name="game-controller-outline" size={24} color={colors.neutral[600]} />
            </View>
            <Text style={styles.plusPanelLabel}>五子棋</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.plusPanelItem}
            onPress={handleOpenDrawGuessLobby}
            activeOpacity={0.7}
          >
            <View style={[styles.plusPanelIconBg, { backgroundColor: colors.coral[100] }]}>
              <Ionicons name="color-palette-outline" size={24} color={colors.coral[600]} />
            </View>
            <Text style={styles.plusPanelLabel}>你画我猜</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TouchableOpacity
          style={styles.plusButton}
          onPress={() => setPlusPanelVisible(!plusPanelVisible)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={plusPanelVisible ? 'close' : 'add'}
            size={24}
            color={colors.primaryAction}
          />
        </TouchableOpacity>
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="说点什么..."
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!inputText.trim() || sending}
          activeOpacity={0.7}
        >
          {sending ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Ionicons name="send" size={18} color="#FFFFFF" />
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
    maxHeight: 80,
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

  // ── Plus Panel ──
  plusPanel: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3] + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  plusPanelItem: {
    alignItems: 'center',
    flex: 1,
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
});
