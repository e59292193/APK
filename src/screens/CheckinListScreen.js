/**
 * CheckinListScreen — 打卡中心首页（淡紫浅色风格）
 *
 * 全宽纵向卡片列表，每张卡片展示双用户并排 + 状态色打卡按钮。
 * 卡片上的「打卡」按钮直接打开 CheckinRecordModal，无需跳转详情。
 *
 * 性能优化：FlatList 虚拟化 + React.memo 卡片 + 批量计数查询 + .limit(50)
 */
import React, { useState, useEffect, useCallback, memo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Alert,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { usePolling } from '../hooks/usePolling';
import { emitSignal } from '../lib/realtimeSignal';
import { getTodayRange } from '../lib/checkinUtils';
import { formatLocalDate } from '../lib/dateUtils';
import CheckinRecordModal from '../components/CheckinRecordModal';
import CheckinCreateModal from '../components/CheckinCreateModal';
import { colors, typography, spacing, radius } from '../theme';
import {
  AppHeader,
  Card,
  EmptyState,
  LoadingState,
  FloatingActionButton,
  Badge,
} from '../components/ui';

const VALID_USERS = { momo: true, '苞米': true };

// ─── Debug instrumentation (will be removed after fix) ───
const __DBG_URL = 'http://192.168.95.167:7777/event';
const __DBG_SID = 'checkin-all-crash';
function dbg(hypothesisId, msg, data) {
  // #region debug-point A:log
  try {
    fetch(__DBG_URL, {
      method: 'POST',
      body: JSON.stringify({
        sessionId: __DBG_SID,
        runId: 'pre',
        hypothesisId,
        location: 'CheckinListScreen.js',
        msg: '[DEBUG] ' + msg,
        data: data || {},
        ts: Date.now(),
      }),
    }).catch(() => {});
  } catch (e) { /* ignore */ }
  // #endregion
}

export default function CheckinListScreen({ userId, onNavigateDetail, onBack }) {
  const insets = useSafeAreaInsets();
  const [themes, setThemes] = useState([]);
  const [todayCounts, setTodayCounts] = useState({});
  const [totalCounts, setTotalCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recordModalVisible, setRecordModalVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState(null);

  const partnerId = Object.keys(VALID_USERS).find((u) => u !== userId) || '';

  // ─── Fetch data ───
  const fetchData = useCallback(async () => {
    // #region debug-point C:fetch
    dbg('C', 'fetchData start', { userId, partnerId });
    try {
      // 1. Fetch active themes
      const { data: themesData, error: themesError } = await fetchWithTimeout(() =>
        supabase
          .from('checkin_themes')
          .select('*')
          .eq('status', 'active')
          .or(`creator_id.eq.${userId},partner_id.eq.${userId}`)
          .order('created_at', { ascending: false })
          .limit(50)
      );
      dbg('C', 'themes fetched', { count: themesData?.length, error: themesError?.message });
      if (themesError) throw themesError;

      const themeIds = (themesData || []).map((t) => t.id);

      // 2. Fetch today's records for all themes (batch)
      const { todayStart, todayEnd } = getTodayRange();
      const todayMap = {};
      const totalMap = {};

      themeIds.forEach((id) => {
        todayMap[id] = { [userId]: 0, [partnerId]: 0 };
        totalMap[id] = { [userId]: 0, [partnerId]: 0 };
      });

      if (themeIds.length > 0) {
        const { data: todayData, error: todayError } = await fetchWithTimeout(() =>
          supabase
            .from('checkin_records')
            .select('theme_id, user_id')
            .in('theme_id', themeIds)
            .gte('created_at', todayStart)
            .lte('created_at', todayEnd)
        );
        dbg('C', 'today records fetched', { count: todayData?.length, error: todayError?.message });
        if (!todayError && todayData) {
          todayData.forEach((r) => {
            if (todayMap[r.theme_id] && todayMap[r.theme_id][r.user_id] !== undefined) {
              todayMap[r.theme_id][r.user_id]++;
            }
          });
        }

        // 3. Fetch total counts (batch — just theme_id + user_id, limited)
        const { data: allData, error: allError } = await fetchWithTimeout(() =>
          supabase
            .from('checkin_records')
            .select('theme_id, user_id')
            .in('theme_id', themeIds)
            .order('created_at', { ascending: false })
            .limit(2000)
        );
        dbg('C', 'all records fetched', { count: allData?.length, error: allError?.message });
        if (!allError && allData) {
          allData.forEach((r) => {
            if (totalMap[r.theme_id] && totalMap[r.theme_id][r.user_id] !== undefined) {
              totalMap[r.theme_id][r.user_id]++;
            }
          });
        }
      }

      setThemes(themesData || []);
      setTodayCounts(todayMap);
      setTotalCounts(totalMap);
      dbg('C', 'fetchData done setState', { themes: themesData?.length });
    } catch (error) {
      dbg('C', 'fetchData ERROR', { message: error?.message, stack: String(error?.stack).slice(0, 1500) });
      console.error('Error fetching checkin data:', error);
      Alert.alert('网络有点开小差', '请尝试下拉刷新');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // #endregion
  }, [userId, partnerId]);

  // ─── Mount + 启动 15 秒轮询 ───
  useEffect(() => {
    // #region debug-point A:mount
    dbg('A', 'CheckinListScreen MOUNT', { userId, partnerId });
    fetchData();
    // #endregion
  }, []);
  usePolling(fetchData, 15000);

  // ─── Android back button ───
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (recordModalVisible) { setRecordModalVisible(false); return true; }
      if (createModalVisible) { setCreateModalVisible(false); return true; }
      onBack();
      return true;
    });
    return () => backHandler.remove();
  }, [recordModalVisible, createModalVisible, onBack]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  // ─── Handlers ───
  const getAvatarLabel = (uid) => {
    if (uid === 'momo') return 'M';
    if (uid === '苞米') return '苞';
    return '?';
  };

  const handleQuickCheckin = (theme) => {
    setSelectedTheme(theme);
    setRecordModalVisible(true);
  };

  const handleCreateTheme = async (themeData) => {
    try {
      // 1. Insert theme
      const { data: themeResult, error: themeError } = await fetchWithTimeout(() =>
        supabase.from('checkin_themes').insert([themeData]).select()
      );
      if (themeError) throw themeError;
      if (!themeResult || themeResult.length === 0) throw new Error('No data');
      const theme = themeResult[0];

      // 2. Send invite message
      const { data: inviteMsg, error: msgError } = await fetchWithTimeout(() =>
        supabase.from('messages').insert([{
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
        }]).select()
      );
      if (msgError) throw msgError;
      if (inviteMsg && inviteMsg[0]) emitSignal('chat:message', inviteMsg[0]);

      // 3. Refresh data
      fetchData();
    } catch (error) {
      console.error('Error creating checkin theme:', error);
      throw new Error('创建失败，请重试');
    }
  };

  const handleSubmitRecord = async ({ content, media_urls }) => {
    if (!selectedTheme) return;
    try {
      // 1. Insert record
      const { error: recordError } = await fetchWithTimeout(() =>
        supabase.from('checkin_records').insert([{
          theme_id: selectedTheme.id,
          user_id: userId,
          content: content,
          media_urls: media_urls,
        }])
      );
      if (recordError) throw recordError;

      // 2. Send checkin_post message to chat
      const { todayStart, todayEnd } = getTodayRange();
      const { count } = await supabase
        .from('checkin_records')
        .select('*', { count: 'exact', head: true })
        .eq('theme_id', selectedTheme.id)
        .eq('user_id', userId)
        .gte('created_at', todayStart)
        .lte('created_at', todayEnd);

      const { data: postMsg, error: msgError } = await fetchWithTimeout(() =>
        supabase.from('messages').insert([{
          user_id: userId,
          content: content || `${selectedTheme.icon} ${selectedTheme.title} 打卡`,
          type: 'checkin_post',
          metadata: {
            theme_id: selectedTheme.id,
            theme_title: selectedTheme.title,
            theme_icon: selectedTheme.icon,
            media_urls: media_urls,
            today_count: count || 0,
          },
        }]).select()
      );
      if (msgError) throw msgError;
      if (postMsg && postMsg[0]) emitSignal('chat:message', postMsg[0]);

      // 3. Refresh data
      fetchData();
    } catch (error) {
      console.error('Error submitting record:', error);
      throw new Error('打卡失败，请重试');
    }
  };

  // ─── Render card ───
  const renderThemeCard = useCallback(({ item: theme }) => {
    // #region debug-point B:rendercard
    const tCounts = todayCounts[theme.id] || {};
    const totCounts = totalCounts[theme.id] || {};
    const myToday = tCounts[userId] || 0;
    const partnerToday = tCounts[partnerId] || 0;
    const myTotal = totCounts[userId] || 0;
    const partnerTotal = totCounts[partnerId] || 0;

    return (
      <ThemeCard
        theme={theme}
        myToday={myToday}
        partnerToday={partnerToday}
        myTotal={myTotal}
        partnerTotal={partnerTotal}
        userId={userId}
        partnerId={partnerId}
        getAvatarLabel={getAvatarLabel}
        onPressCard={() => onNavigateDetail(theme)}
        onQuickCheckin={() => handleQuickCheckin(theme)}
      />
    );
    // #endregion
  }, [todayCounts, totalCounts, userId, partnerId, onNavigateDetail]);

  if (loading) {
    // #region debug-point B:loading
    dbg('B', 'render loading branch', {});
    // #endregion
    return (
      <View style={styles.container}>
        <AppHeader showBack onBack={onBack} title="打卡中心" subtitle="你们一起坚持的每一件事" />
        <LoadingState text="加载打卡中心..." />
      </View>
    );
  }

  // #region debug-point B:render
  dbg('B', 'render main branch', {
    themesCount: themes.length,
    firstThemeId: themes[0]?.id,
    firstThemeTitle: themes[0]?.title,
    todayCountsKeys: Object.keys(todayCounts).length,
    totalCountsKeys: Object.keys(totalCounts).length,
  });
  // #endregion

  return (
    <View style={styles.container}>
      {/* Header */}
      <AppHeader showBack onBack={onBack} title="打卡中心" subtitle="你们一起坚持的每一件事" />

      <FlatList
        data={themes}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderThemeCard}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 150 }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={8}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primaryAction} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="checkmark-done-circle-outline"
            title="还没有已建立的打卡"
            description="在聊天页发起一个打卡邀请吧"
            style={styles.emptyState}
          />
        }
      />

      {/* 新增打卡主题 */}
      <FloatingActionButton icon="add" onPress={() => setCreateModalVisible(true)} />

      {/* Quick check-in modal */}
      {selectedTheme && (
        <CheckinRecordModal
          visible={recordModalVisible}
          onClose={() => setRecordModalVisible(false)}
          onSubmit={handleSubmitRecord}
          theme={selectedTheme}
          userId={userId}
        />
      )}

      {/* Create theme modal */}
      <CheckinCreateModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onCreate={handleCreateTheme}
        userId={userId}
        partnerId={partnerId}
      />
    </View>
  );
}

// ─── Memoized Theme Card ───
const ThemeCard = memo(function ThemeCard({
  theme, myToday, partnerToday, myTotal, partnerTotal,
  userId, partnerId, getAvatarLabel,
  onPressCard, onQuickCheckin,
}) {
  const iCheckedIn = myToday > 0;

  return (
    <Card variant="interactive" onPress={onPressCard} style={styles.card}>
      {/* Top row: icon + title + chevron */}
      <View style={styles.cardTopRow}>
        <View style={styles.cardIconWrapper}>
          <Text style={styles.cardIcon}>{theme.icon}</Text>
          <Text style={styles.cardTitle}>{theme.title}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </View>

      {/* Middle: two users side by side */}
      <View style={styles.usersRow}>
        {/* Partner */}
        <View style={styles.userSide}>
          <View style={[styles.userAvatar, { backgroundColor: colors.partner }]}>
            <Text style={styles.userAvatarText}>{getAvatarLabel(partnerId)}</Text>
          </View>
          <Text style={styles.userName}>{getAvatarLabel(partnerId)}</Text>
          <Text style={styles.userCount}>
            共打卡 <Text style={styles.userCountBold}>{partnerTotal}</Text> 次
          </Text>
        </View>

        {/* Divider */}
        <View style={styles.userDivider} />

        {/* Me */}
        <View style={styles.userSide}>
          <View style={[styles.userAvatar, { backgroundColor: colors.me }]}>
            <Text style={styles.userAvatarText}>我</Text>
          </View>
          <Text style={styles.userName}>我</Text>
          <Text style={styles.userCount}>
            共打卡 <Text style={styles.userCountBold}>{myTotal}</Text> 次
          </Text>
        </View>
      </View>

      {/* Bottom: quick check-in button */}
      <View style={styles.cardBottom}>
        <View style={styles.todayStatusRow}>
          <Text style={styles.todayStatus}>
            今日 {getAvatarLabel(partnerId)} {partnerToday} / 我 {myToday} 次
          </Text>
          {iCheckedIn && (
            <Badge variant="success" size="sm">已完成</Badge>
          )}
        </View>
        <TouchableOpacity
          style={[styles.checkinBtn, iCheckedIn ? styles.checkinBtnDone : styles.checkinBtnPending]}
          onPress={(e) => {
            e.stopPropagation?.();
            onQuickCheckin();
          }}
          activeOpacity={0.8}
        >
          {iCheckedIn ? (
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          ) : (
            <Ionicons name="add" size={14} color={colors.primaryAction} />
          )}
          <Text style={[styles.checkinBtnText, iCheckedIn ? styles.checkinBtnTextDone : styles.checkinBtnTextPending]}>
            {iCheckedIn ? '已打卡' : '打卡'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.cardDate}>始于 {formatLocalDate(theme.created_at)}</Text>
    </Card>
  );
});

// ─── Styles ───
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  emptyState: { marginTop: spacing[10] },

  // List
  listContent: { paddingHorizontal: spacing[3], paddingTop: spacing[2] },

  // Card
  card: {
    marginBottom: spacing[3],
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[3],
  },
  cardIconWrapper: { flexDirection: 'row', alignItems: 'center' },
  cardIcon: { fontSize: 24, marginRight: spacing[2] },
  cardTitle: { ...typography.cardTitle, color: colors.textPrimary },

  // Users row
  usersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.md,
    paddingVertical: spacing[4],
    marginBottom: spacing[3],
  },
  userSide: { flex: 1, alignItems: 'center' },
  userAvatar: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: spacing[1] + 2,
  },
  userAvatarText: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' },
  userName: { ...typography.caption, color: colors.textSecondary, fontWeight: '500', marginBottom: 2 },
  userCount: { ...typography.caption, color: colors.textMuted },
  userCountBold: { fontSize: 18, fontWeight: '800', color: colors.primaryAction },
  userDivider: { width: 1, height: 50, backgroundColor: colors.border },

  // Bottom row
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  todayStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  todayStatus: { ...typography.caption, color: colors.textSecondary },
  checkinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    gap: 4,
  },
  checkinBtnDone: { backgroundColor: colors.partner },
  checkinBtnPending: { backgroundColor: colors.meSoft },
  checkinBtnText: { ...typography.caption, fontWeight: '600' },
  checkinBtnTextDone: { color: '#FFFFFF' },
  checkinBtnTextPending: { color: colors.primaryAction },

  cardDate: { ...typography.label, color: colors.textMuted, marginTop: spacing[2] },
});
