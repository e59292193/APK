import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  RefreshControl,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  LayoutAnimation,
  UIManager,
  BackHandler,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { usePolling } from '../hooks/usePolling';
import { pickAndUploadImage } from '../lib/photoUtils';
import { formatLocalDate, formatLocalTime, formatLocalDateTime, getCountdown } from '../lib/dateUtils';
import { CachedImage } from '../lib/imageCache';
import { colors, typography, spacing, radius } from '../theme';
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  LoadingState,
  SegmentedControl,
  Badge,
  FloatingActionButton,
  IconButton,
} from '../components/ui';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Only import DateTimePicker on native platforms
let RNDateTimePicker = null;
let DateTimePickerAndroid = null;
if (Platform.OS !== 'web') {
  try {
    RNDateTimePicker = require('@react-native-community/datetimepicker').default;
    DateTimePickerAndroid = require('@react-native-community/datetimepicker').DateTimePickerAndroid;
  } catch (e) {
    console.warn('DateTimePicker not available');
  }
}

// ─── Weather & Mood Options (Emoji is user content — preserved) ───
const WEATHER_OPTIONS = [
  { emoji: '☀️', label: '晴' },
  { emoji: '☁️', label: '阴' },
  { emoji: '🌧️', label: '雨' },
  { emoji: '❄️', label: '雪' },
  { emoji: '🌫️', label: '雾' },
];

const MOOD_OPTIONS = [
  { emoji: '🥰', label: '甜蜜' },
  { emoji: '😆', label: '开心' },
  { emoji: '😑', label: '平淡' },
  { emoji: '🥺', label: '想你' },
  { emoji: '😪', label: '疲惫' },
];

// ─── Tab Definitions (labels only — no functional emoji) ───
const TABS = [
  { key: 'ready', label: '待拆开' },
  { key: 'opened', label: '已拆开' },
  { key: 'locked', label: '封存中' },
];

// ─── Status → Icon / Badge mapping ───
const STATUS_ICON = {
  locked: 'time-outline',
  ready: 'mail-outline',
  opened: 'mail-open-outline',
};

const STATUS_BADGE_VARIANT = {
  locked: 'primary',
  ready: 'amber',
  opened: 'mint',
};

const STATUS_BADGE_LABEL = {
  locked: '封存中',
  ready: '可拆开',
  opened: '已拆开',
};

const STATUS_ICON_BG = {
  locked: colors.primary[100],
  ready: colors.amber[50],
  opened: colors.partnerSoft,
};

const STATUS_ICON_COLOR = {
  locked: colors.primary[700],
  ready: colors.amber[500],
  opened: colors.mint[700],
};

// ─── Countdown Text Component ───
const CountdownText = React.memo(function CountdownText({ unlockTime }) {
  const [countdown, setCountdown] = useState(() => getCountdown(unlockTime));

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(getCountdown(unlockTime));
    }, 1000);
    return () => clearInterval(timer);
  }, [unlockTime]);

  return <Text style={styles.countdownText}>{countdown}</Text>;
});

function getCapsuleStatus(item) {
  const now = new Date();
  const unlockTime = new Date(item.unlock_time);
  const isOpened = !!(item.is_opened || item.is_read);
  if (isOpened) return 'opened';
  if (now >= unlockTime) return 'ready';
  return 'locked';
}

// ─── Lined Paper Background (light lavender, not yellow) ───
function LinedPaperBackground({ lineHeight = 22 }) {
  const lines = [];
  const totalLines = 20;
  for (let i = 1; i <= totalLines; i++) {
    lines.push(
      <View
        key={i}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: i * lineHeight,
          height: 0,
          borderBottomWidth: 1,
          borderBottomColor: colors.primary[200],
          opacity: 0.5,
        }}
      />
    );
  }
  return (
    <View style={styles.linedPaperBg} pointerEvents="none">
      {lines}
    </View>
  );
}

// ─── Main Component ───
export default function TimeCapsuleScreen({ userId: propUserId, onLogout }) {
  const insets = useSafeAreaInsets();
  const [capsules, setCapsules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const userId = propUserId || '';
  const [connectionError, setConnectionError] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState('ready');

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [letterContent, setLetterContent] = useState('');
  const [unlockDate, setUnlockDate] = useState(new Date(Date.now() + 86400000));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [capsulePhotoUrl, setCapsulePhotoUrl] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Weather & Mood state
  const [selectedWeather, setSelectedWeather] = useState(null);
  const [selectedMood, setSelectedMood] = useState(null);

  // Detail view state
  const [detailCapsule, setDetailCapsule] = useState(null);
  const [openedFromReady, setOpenedFromReady] = useState(false);

  // Countdown ticker is handled inside CountdownText to prevent full-screen re-renders

  // ─── Android hardware back button handler ───
  useEffect(() => {
    const onBackPress = () => {
      if (modalVisible) {
        if (!saving) closeModal();
        return true;
      }
      if (detailCapsule) {
        handleCloseDetail();
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, [modalVisible, detailCapsule, saving]);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      await fetchCapsules();
    } catch (error) {
      console.error('Error initializing app:', error);
      setConnectionError(true);
      setLoading(false);
      Alert.alert('网络有点开小差', '请尝试下拉刷新或稍后再试');
    }
  };

  const fetchCapsules = async () => {
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase
          .from('time_capsules')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50)
      );

      if (error) throw error;
      setCapsules(data);
      setConnectionError(false);
    } catch (error) {
      console.error('Error fetching capsules:', error);
      setConnectionError(true);
      Alert.alert('网络有点开小差', '请尝试下拉刷新或稍后再试');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  // 启动 15 秒轮询（需放在 fetchCapsules 声明之后）
  usePolling(fetchCapsules, 15000);

  // ─── Upload Photo for Capsule ───
  const handlePickCapsulePhoto = async () => {
    try {
      setUploadingPhoto(true);
      const url = await pickAndUploadImage({ quality: 0.7 });
      if (url) {
        setCapsulePhotoUrl(url);
      }
    } catch (error) {
      Alert.alert('上传失败', error.message || '请重试');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const closeModal = () => {
    Keyboard.dismiss();
    if (Platform.OS !== 'web') {
      setTimeout(() => {
        setModalVisible(false);
      }, 150);
    } else {
      setModalVisible(false);
    }
  };

  // Wrap close so loading disables close (UI-layer guard only)
  const handleModalClose = () => {
    if (saving) return;
    closeModal();
  };

  const sealCapsule = async () => {
    if (!letterContent.trim()) {
      Alert.alert('提示', '信件内容不能为空');
      return;
    }

    if (unlockDate <= new Date()) {
      Alert.alert('提示', '解锁时间必须在未来');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('time_capsules').insert([
          {
            creator_id: userId,
            content: letterContent.trim(),
            unlock_time: unlockDate.toISOString(),
            is_opened: false,
            is_read: false,
            photo_url: capsulePhotoUrl || null,
            weather: selectedWeather || null,
            mood: selectedMood || null,
          },
        ]).select()
      );

      if (error) throw error;

      if (data && data.length > 0) {
        setCapsules((prev) => [data[0], ...prev]);
      }
      Keyboard.dismiss();
      setLetterContent('');
      setUnlockDate(new Date(Date.now() + 86400000));
      setCapsulePhotoUrl('');
      setSelectedWeather(null);
      setSelectedMood(null);
      if (Platform.OS !== 'web') {
        setTimeout(() => {
          setModalVisible(false);
        }, 150);
      } else {
        setModalVisible(false);
      }
    } catch (error) {
      console.error('Error sealing capsule:', error);
      Alert.alert('错误', '封存失败，请检查网络连接');
    } finally {
      setSaving(false);
    }
  };

  // ─── Unlock Action: open detail first, update DB in background ───
  const handleOpenCapsule = async (item) => {
    // 1. Show reading detail immediately
    setOpenedFromReady(true);
    setDetailCapsule(item);

    // 2. Update Supabase in background (non-blocking)
    try {
      const { error } = await fetchWithTimeout(() =>
        supabase
          .from('time_capsules')
          .update({ is_opened: true, is_read: true })
          .eq('id', item.id)
      );

      if (error) {
        console.error('Background update failed:', error);
      }
    } catch (error) {
      console.error('Error marking capsule as read:', error);
    }
  };

  // ─── Open detail view (for already-opened capsules) ───
  const handleViewDetail = (item) => {
    setOpenedFromReady(false);
    setDetailCapsule(item);
  };

  // ─── Close detail view: trigger card disappear animation only when opened from ready ───
  const handleCloseDetail = () => {
    if (openedFromReady) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      fetchCapsules(); // Refresh to move card from "ready" → "opened"
    }
    setDetailCapsule(null);
    setOpenedFromReady(false);
  };

  // ─── Android: imperative picker (date + time) ───
  const showAndroidDateTimePicker = () => {
    const currentDate = new Date(unlockDate);

    if (DateTimePickerAndroid && DateTimePickerAndroid.open) {
      DateTimePickerAndroid.open({
        mode: 'date',
        value: currentDate,
        display: 'default',
        minimumDate: new Date(Date.now() + 60000),
        onValueChange: (_event, selectedDate) => {
          if (selectedDate) {
            const pickedDate = new Date(selectedDate);
            if (DateTimePickerAndroid && DateTimePickerAndroid.open) {
              DateTimePickerAndroid.open({
                mode: 'time',
                value: pickedDate,
                display: 'default',
                onValueChange: (_evt, selectedTime) => {
                  if (selectedTime) {
                    const finalDate = new Date(pickedDate);
                    finalDate.setHours(selectedTime.getHours());
                    finalDate.setMinutes(selectedTime.getMinutes());
                    setUnlockDate(finalDate);
                  }
                },
                onDismiss: () => {
                  setUnlockDate(pickedDate);
                },
              });
            }
          }
        },
        onDismiss: () => {},
      });
    } else {
      setShowDatePicker(true);
    }
  };

  const onIOSDateChange = (_event, selectedDate) => {
    setShowDatePicker(false);
    if (_event.type === 'dismissed') return;
    if (selectedDate) setUnlockDate(selectedDate);
  };

  const onWebDateChange = (e) => {
    const value = e.target.value;
    if (value) {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) setUnlockDate(parsed);
    }
  };

  const toDatetimeLocalString = (date) => {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  };

  const getMinDatetimeLocal = () => {
    return toDatetimeLocalString(new Date(Date.now() + 60000));
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchCapsules();
  }, []);

  // ─── Filtered Capsules by Tab (memoized) ───
  const filteredCapsules = useMemo(() => {
    return capsules.filter((item) => {
      const status = getCapsuleStatus(item);
      return status === activeTab;
    });
  }, [capsules, activeTab]);

  // ─── Segmented control segments with badge counts ───
  const segments = useMemo(() => {
    return TABS.map((tab) => ({
      key: tab.key,
      label: tab.label,
      badge: capsules.filter((c) => getCapsuleStatus(c) === tab.key).length,
    }));
  }, [capsules]);

  const selectedIndex = useMemo(() => {
    const idx = TABS.findIndex((t) => t.key === activeTab);
    return idx >= 0 ? idx : 0;
  }, [activeTab]);

  // ─── Emoji selector strip component (Emoji is user content — preserved) ───
  const renderEmojiStrip = (options, selected, onSelect) => (
    <View style={styles.emojiStrip}>
      {options.map((opt) => {
        const isSelected = selected === opt.label;
        return (
          <TouchableOpacity
            key={opt.label}
            style={[
              styles.emojiOption,
              isSelected && styles.emojiOptionSelected,
            ]}
            onPress={() => onSelect(selected === opt.label ? null : opt.label)}
            activeOpacity={0.7}
          >
            <Text style={styles.emojiOptionText}>{opt.emoji}</Text>
            <Text style={[
              styles.emojiOptionLabel,
              isSelected && styles.emojiOptionLabelSelected,
            ]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // ─── Card Renderer ───
  const renderItem = ({ item }) => {
    const status = getCapsuleStatus(item);
    const isMe = item.creator_id === userId;

    // Weather & Mood display
    const weatherDisplay = item.weather ? WEATHER_OPTIONS.find(w => w.label === item.weather) : null;
    const moodDisplay = item.mood ? MOOD_OPTIONS.find(m => m.label === item.mood) : null;

    const statusIcon = STATUS_ICON[status];
    const statusBadgeVariant = STATUS_BADGE_VARIANT[status];
    const statusBadgeLabel = STATUS_BADGE_LABEL[status];
    const iconBg = STATUS_ICON_BG[status];
    const iconColor = STATUS_ICON_COLOR[status];

    // ── Status: Locked (封存中) — compact card, NO content shown ──
    if (status === 'locked') {
      return (
        <Card variant="standard" style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.statusIconWrap, { backgroundColor: iconBg }]}>
              <Ionicons name={statusIcon} size={22} color={iconColor} />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitleText}>时光胶囊封存中</Text>
              <View style={styles.countdownRow}>
                <Text style={styles.countdownLabel}>距离解锁</Text>
                <CountdownText unlockTime={item.unlock_time} />
              </View>
            </View>
            <Badge variant={statusBadgeVariant} size="sm">{statusBadgeLabel}</Badge>
          </View>

          <View style={styles.cardFooter}>
            <View style={styles.metaTags}>
              {weatherDisplay && (
                <Badge variant="neutral" size="sm">{weatherDisplay.emoji} {weatherDisplay.label}</Badge>
              )}
              {moodDisplay && (
                <Badge variant="neutral" size="sm">{moodDisplay.emoji} {moodDisplay.label}</Badge>
              )}
            </View>
            <Text style={styles.footerText}>
              {isMe ? '我' : item.creator_id} · {formatLocalDate(item.created_at)}
            </Text>
          </View>
        </Card>
      );
    }

    // ── Status: Ready (待拆开) — NO content shown, tappable to open ──
    if (status === 'ready') {
      return (
        <Card
          variant="interactive"
          onPress={() => handleOpenCapsule(item)}
          style={styles.card}
        >
          <View style={styles.cardHeader}>
            <View style={[styles.statusIconWrap, { backgroundColor: iconBg }]}>
              <Ionicons name={statusIcon} size={22} color={iconColor} />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitleText}>时光已送达</Text>
              <Text style={styles.cardSubtitle}>点击拆开信件</Text>
            </View>
            <Badge variant={statusBadgeVariant} size="sm">{statusBadgeLabel}</Badge>
          </View>

          <View style={styles.cardFooter}>
            <View style={styles.metaTags}>
              {weatherDisplay && (
                <Badge variant="neutral" size="sm">{weatherDisplay.emoji} {weatherDisplay.label}</Badge>
              )}
              {moodDisplay && (
                <Badge variant="neutral" size="sm">{moodDisplay.emoji} {moodDisplay.label}</Badge>
              )}
            </View>
            <Text style={styles.footerText}>
              {isMe ? '我' : item.creator_id} · {formatLocalDate(item.created_at)}
            </Text>
          </View>
        </Card>
      );
    }

    // ── Status: Opened (已拆开) — preview, tappable to view detail ──
    return (
      <Card
        variant="interactive"
        onPress={() => handleViewDetail(item)}
        style={styles.card}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.statusIconWrap, { backgroundColor: iconBg }]}>
            <Ionicons name={statusIcon} size={22} color={iconColor} />
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitleText} numberOfLines={1}>
              来自 {isMe ? '我' : item.creator_id} 的信
            </Text>
            <Text style={styles.cardSubtitle} numberOfLines={1}>
              {formatLocalDateTime(item.created_at)} → {formatLocalDateTime(item.unlock_time)}
            </Text>
          </View>
          <Badge variant={statusBadgeVariant} size="sm">{statusBadgeLabel}</Badge>
        </View>

        {/* Photo thumbnail (only for opened capsules) */}
        {item.photo_url ? (
          <CachedImage
            source={{ uri: item.photo_url }}
            style={styles.cardThumb}
            contentFit="cover"
          />
        ) : null}

        <View style={styles.cardFooter}>
          <View style={styles.metaTags}>
            {weatherDisplay && (
              <Badge variant="neutral" size="sm">{weatherDisplay.emoji} {weatherDisplay.label}</Badge>
            )}
            {moodDisplay && (
              <Badge variant="neutral" size="sm">{moodDisplay.emoji} {moodDisplay.label}</Badge>
            )}
          </View>
          <View style={styles.viewHintRow}>
            <Text style={styles.viewHintText}>点击查看信件内容</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary[300]} />
          </View>
        </View>
      </Card>
    );
  };

  // ─── Empty state config per tab ───
  const emptyConfig = {
    ready: {
      icon: 'mail-outline',
      title: '还没有可以开启的信',
      description: '时光到达后，可拆开的信会出现在这里',
    },
    opened: {
      icon: 'mail-open-outline',
      title: '拆开的信会收藏在这里',
      description: '已读的信件会被妥善保存',
    },
    locked: {
      icon: 'time-outline',
      title: '写一封信，把今天交给未来',
      description: '点击右下角按钮，开始写一封时光信',
    },
  };

  if (loading) {
    return (
      <View style={styles.screenContainer}>
        <AppHeader title="时光胶囊" subtitle="把此刻，寄给未来的我们" />
        <LoadingState text="正在加载时光胶囊..." style={styles.flexCenter} />
      </View>
    );
  }

  // ─── Detail View ───
  if (detailCapsule) {
    const item = detailCapsule;
    const isMe = item.creator_id === userId;
    const weatherDisplay = item.weather ? WEATHER_OPTIONS.find(w => w.label === item.weather) : null;
    const moodDisplay = item.mood ? MOOD_OPTIONS.find(m => m.label === item.mood) : null;

    return (
      <View style={styles.screenContainer}>
        <AppHeader
          title="信件详情"
          subtitle={`来自 ${isMe ? '我' : item.creator_id} 的信`}
          showBack
          onBack={handleCloseDetail}
        />

        <ScrollView
          style={styles.detailScrollView}
          contentContainerStyle={styles.detailContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Weather & Mood badges */}
          {(weatherDisplay || moodDisplay) && (
            <View style={styles.detailMetaRow}>
              {weatherDisplay && (
                <Badge variant="primary">{weatherDisplay.emoji} {weatherDisplay.label}</Badge>
              )}
              {moodDisplay && (
                <Badge variant="mint">{moodDisplay.emoji} {moodDisplay.label}</Badge>
              )}
            </View>
          )}

          {/* Lined paper content area (surfaceSoft, not yellow) */}
          <View style={styles.detailPaperContainer}>
            <View style={styles.detailPaper}>
              <LinedPaperBackground lineHeight={22} />
              <Text style={styles.detailPaperText}>{item.content}</Text>
            </View>
          </View>

          {/* Photo */}
          {item.photo_url && (
            <CachedImage
              source={{ uri: item.photo_url }}
              style={styles.detailPhoto}
              contentFit="cover"
            />
          )}

          {/* Timestamps card */}
          <Card variant="soft" style={styles.detailTimestamps} contentStyle={styles.detailTimestampsContent}>
            <View style={styles.timestampRow}>
              <View style={styles.timestampIconWrap}>
                <Ionicons name="archive-outline" size={16} color={colors.primaryAction} />
              </View>
              <View style={styles.timestampInfo}>
                <Text style={styles.detailTimestampLabel}>封存时间</Text>
                <Text style={styles.detailTimestampValue}>{formatLocalDateTime(item.created_at)}</Text>
              </View>
            </View>
            <View style={styles.timestampRow}>
              <View style={styles.timestampIconWrap}>
                <Ionicons name="time-outline" size={16} color={colors.primaryAction} />
              </View>
              <View style={styles.timestampInfo}>
                <Text style={styles.detailTimestampLabel}>解锁时间</Text>
                <Text style={styles.detailTimestampValue}>{formatLocalDateTime(item.unlock_time)}</Text>
              </View>
            </View>
          </Card>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      {/* Header */}
      <AppHeader
        title="时光胶囊"
        subtitle="把此刻，寄给未来的我们"
        rightAction={
          <IconButton
            icon="log-out-outline"
            size={22}
            color={colors.textSecondary}
            onPress={onLogout}
            accessibilityLabel="退出登录"
          />
        }
      />

      {/* Segmented Control */}
      <View style={styles.tabBarContainer}>
        <SegmentedControl
          segments={segments}
          selectedIndex={selectedIndex}
          onChange={(i) => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setActiveTab(TABS[i].key);
          }}
        />
      </View>

      {/* Error Banner */}
      {connectionError && (
        <View style={styles.errorBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.error} />
          <Text style={styles.errorText}>连接中断，下拉刷新重试</Text>
        </View>
      )}

      {/* Filtered Capsules List */}
      <FlatList
        data={filteredCapsules}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={8}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primaryAction} />
        }
        ListEmptyComponent={
          <EmptyState
            icon={emptyConfig[activeTab].icon}
            title={emptyConfig[activeTab].title}
            description={emptyConfig[activeTab].description}
          />
        }
      />

      {/* Extended FAB */}
      <FloatingActionButton
        icon="mail-outline"
        label="写封未来信"
        onPress={() => setModalVisible(true)}
      />

      {/* ─── Write Letter Modal (fullscreen light page) ─── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={false}
        statusBarTranslucent={true}
        onRequestClose={handleModalClose}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.writeScreen}
        >
          {/* Write Header */}
          <View style={[styles.writeHeader, { paddingTop: Math.max(insets.top, 12) + spacing[1] }]}>
            <IconButton
              icon="close"
              size={22}
              color={colors.textSecondary}
              onPress={handleModalClose}
              disabled={saving}
              accessibilityLabel="关闭"
            />
            <View style={styles.writeHeaderTitle}>
              <Text style={styles.writeTitle}>写给未来的信</Text>
            </View>
            <View style={styles.writeHeaderRight} />
          </View>

          <ScrollView
            style={styles.writeBody}
            contentContainerStyle={styles.writeBodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Weather Selector */}
            <Text style={styles.fieldLabel}>今天的天气</Text>
            {renderEmojiStrip(WEATHER_OPTIONS, selectedWeather, setSelectedWeather)}

            {/* Mood Selector */}
            <Text style={styles.fieldLabel}>此刻的心情</Text>
            {renderEmojiStrip(MOOD_OPTIONS, selectedMood, setSelectedMood)}

            {/* Letter Content — Lined Paper (surfaceSoft, not yellow) */}
            <Text style={styles.fieldLabel}>信件内容</Text>
            <View style={styles.paperContainer}>
              <LinedPaperBackground lineHeight={22} />
              <TextInput
                style={styles.letterInput}
                value={letterContent}
                onChangeText={setLetterContent}
                placeholder="亲爱的未来的我们..."
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={2000}
                textAlignVertical="top"
              />
            </View>
            <Text style={styles.charCount}>{letterContent.length}/2000</Text>

            {/* Unlock Date — separate Date Card */}
            <Text style={styles.fieldLabel}>解锁时间</Text>
            <Card variant="soft" style={styles.dateCard}>
              {Platform.OS === 'web' ? (
                <View style={styles.dateSelectorRow}>
                  <Ionicons name="calendar-outline" size={20} color={colors.primaryAction} />
                  <input
                    type="datetime-local"
                    value={toDatetimeLocalString(unlockDate)}
                    onChange={onWebDateChange}
                    min={getMinDatetimeLocal()}
                    style={styles.webDateInput}
                  />
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.dateSelectorRow}
                  onPress={Platform.OS === 'android' ? showAndroidDateTimePicker : () => setShowDatePicker(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="calendar-outline" size={20} color={colors.primaryAction} />
                  <Text style={styles.dateText}>
                    {unlockDate.getFullYear()}/{(unlockDate.getMonth() + 1).toString().padStart(2, '0')}/{unlockDate.getDate().toString().padStart(2, '0')}{' '}
                    {unlockDate.getHours().toString().padStart(2, '0')}:{unlockDate.getMinutes().toString().padStart(2, '0')}
                  </Text>
                  <Text style={styles.changeDateText}>点击修改</Text>
                </TouchableOpacity>
              )}

              {showDatePicker && RNDateTimePicker && Platform.OS === 'ios' && (
                <RNDateTimePicker
                  value={unlockDate}
                  mode="datetime"
                  display="spinner"
                  onValueChange={onIOSDateChange}
                  minimumDate={new Date(Date.now() + 60000)}
                />
              )}
            </Card>

            {/* Photo Preview / Upload Area (dashed light purple border) */}
            {capsulePhotoUrl ? (
              <View style={styles.photoPreviewContainer}>
                <CachedImage
                  source={{ uri: capsulePhotoUrl }}
                  style={styles.photoPreview}
                  contentFit="cover"
                />
                <TouchableOpacity
                  style={styles.photoRemoveBtn}
                  onPress={() => setCapsulePhotoUrl('')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close" size={16} color={colors.surface} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.photoUploadArea}
                onPress={handlePickCapsulePhoto}
                disabled={uploadingPhoto}
                activeOpacity={0.7}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator color={colors.primaryAction} size="small" />
                ) : (
                  <>
                    <Ionicons name="images-outline" size={28} color={colors.primary[400]} />
                    <Text style={styles.photoUploadText}>附带一张老照片</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Bottom Action — "封存这封信" primary Button (disabled while loading) */}
          <View style={[styles.writeFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Button
              fullWidth
              size="large"
              loading={saving}
              disabled={saving}
              onPress={sealCapsule}
              iconLeft="mail-outline"
            >
              封存这封信
            </Button>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const LINE_HEIGHT = 22;

const styles = StyleSheet.create({
  // ── Screen ──
  screenContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flexCenter: {
    flex: 1,
  },

  // ── Tab Bar ──
  tabBarContainer: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[1],
  },

  // ── Error Banner ──
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    backgroundColor: colors.errorSoft,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
  },

  // ── List ──
  listContent: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[2],
    paddingBottom: 140,
  },

  // ── Card ──
  card: {
    marginBottom: spacing[3],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  statusIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
  },
  cardTitleText: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  cardSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary[50],
    borderRadius: radius.sm,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    marginTop: spacing[1],
    alignSelf: 'flex-start',
    gap: spacing[1],
  },
  countdownLabel: {
    ...typography.label,
    color: colors.textMuted,
  },
  countdownText: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.primaryAction,
    letterSpacing: 0.5,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing[2],
  },
  metaTags: {
    flexDirection: 'row',
    gap: spacing[1],
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  footerText: {
    ...typography.label,
    color: colors.textMuted,
  },
  viewHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  viewHintText: {
    ...typography.label,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  cardThumb: {
    width: '100%',
    height: 120,
    borderRadius: radius.md,
    marginTop: spacing[3],
  },

  // ── Detail View ──
  detailScrollView: {
    flex: 1,
  },
  detailContent: {
    padding: spacing[5],
    paddingBottom: spacing[10],
  },
  detailMetaRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[4],
    flexWrap: 'wrap',
  },
  detailPaperContainer: {
    marginBottom: spacing[4],
  },
  detailPaper: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[4],
    position: 'relative',
    overflow: 'hidden',
    minHeight: 120,
  },
  detailPaperText: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: LINE_HEIGHT,
  },
  detailPhoto: {
    width: '100%',
    height: 200,
    borderRadius: radius.lg,
    marginBottom: spacing[4],
  },
  detailTimestamps: {
    marginBottom: spacing[2],
  },
  detailTimestampsContent: {
    gap: spacing[3],
  },
  timestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  timestampIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  timestampInfo: {
    flex: 1,
  },
  detailTimestampLabel: {
    ...typography.label,
    color: colors.textMuted,
  },
  detailTimestampValue: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    marginTop: 2,
  },

  // ── Write Modal (fullscreen light page) ──
  writeScreen: {
    flex: 1,
    backgroundColor: colors.backgroundLavender,
  },
  writeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[2],
    paddingBottom: spacing[2],
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  writeHeaderTitle: {
    flex: 1,
    alignItems: 'center',
  },
  writeTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  writeHeaderRight: {
    width: 44,
  },
  writeBody: {
    flex: 1,
  },
  writeBodyContent: {
    padding: spacing[5],
    paddingBottom: spacing[8],
  },
  fieldLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing[2],
    marginTop: spacing[4],
  },

  // ── Emoji Strip (Emoji is user content — preserved) ──
  emojiStrip: {
    flexDirection: 'row',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  emojiOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  emojiOptionSelected: {
    backgroundColor: colors.primary[100],
    borderColor: colors.primaryAction,
  },
  emojiOptionText: {
    fontSize: 16,
    marginRight: spacing[1],
  },
  emojiOptionLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  emojiOptionLabelSelected: {
    color: colors.primaryAction,
    fontWeight: '700',
  },

  // ── Lined Paper (surfaceSoft, not yellow) ──
  paperContainer: {
    position: 'relative',
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  linedPaperBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing[2],
  },
  letterInput: {
    padding: spacing[4],
    fontSize: 15,
    minHeight: 180,
    color: colors.textPrimary,
    lineHeight: LINE_HEIGHT,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  charCount: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: spacing[1],
  },

  // ── Date Card ──
  dateCard: {
    marginBottom: spacing[2],
    padding: spacing[3],
  },
  dateSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  dateText: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    flex: 1,
  },
  changeDateText: {
    ...typography.label,
    color: colors.primaryAction,
    fontWeight: '700',
  },
  webDateInput: {
    flex: 1,
    fontSize: 15,
    padding: spacing[1],
    border: 'none',
    backgroundColor: 'transparent',
    color: colors.textPrimary,
    fontWeight: '500',
    outline: 'none',
    cursor: 'pointer',
  },

  // ── Photo Upload (dashed light purple border) ──
  photoUploadArea: {
    backgroundColor: colors.primary[50],
    borderRadius: radius.lg,
    paddingVertical: spacing[5],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary[200],
    borderStyle: 'dashed',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  photoUploadText: {
    ...typography.caption,
    color: colors.textSecondary,
  },

  // ── Photo Preview ──
  photoPreviewContainer: {
    position: 'relative',
    marginBottom: spacing[2],
    marginTop: spacing[2],
  },
  photoPreview: {
    width: '100%',
    height: 180,
    borderRadius: radius.lg,
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Write Footer ──
  writeFooter: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
