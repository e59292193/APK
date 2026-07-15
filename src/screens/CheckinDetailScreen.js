/**
 * CheckinDetailScreen — 单主题打卡详情页（淡紫浅色 UI）
 *
 * 新布局：主题头部 + 双用户统计 + Mini日历 + 今日状态 + 时间轴
 * 性能优化：当月日历数据单独查询（带日期范围）+ Realtime订阅 + FlatList
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  Dimensions,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { usePolling } from '../hooks/usePolling';
import { emitSignal } from '../lib/realtimeSignal';
import { fetchTodayCount, getTodayRange } from '../lib/checkinUtils';
import { formatLocalDate, formatLocalTime } from '../lib/dateUtils';
import CheckinRecordModal from '../components/CheckinRecordModal';
import { CachedImage } from '../lib/imageCache';
import {
  colors,
  typography,
  spacing,
  radius,
  shadows,
} from '../theme';
import {
  AppHeader,
  Card,
  Button,
  EmptyState,
  LoadingState,
  Badge,
  SectionHeader,
  BottomActionBar,
  Avatar,
} from '../components/ui';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PAGE_MARGIN = spacing[5]; // 20
const CARD_PAD = spacing[4]; // 16
const CALENDAR_CELL_SIZE = (SCREEN_WIDTH - PAGE_MARGIN * 2 - CARD_PAD * 2) / 7;
const TIMELINE_LEFT_WIDTH = 28;
const TIMELINE_IMAGE_SIZE =
  (SCREEN_WIDTH - PAGE_MARGIN - TIMELINE_LEFT_WIDTH - spacing[2] - CARD_PAD * 2 - spacing[1] * 2) / 3;

const VALID_USERS = { momo: true, '苞米': true };

// ─── Calendar helpers ───
function getMonthRange(year, month) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function buildCalendarGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const firstDayOfWeek = (firstDay.getDay() + 6) % 7; // Monday=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

function getDateKey(d) {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

// ─── Group records by date for timeline ───
function groupByDate(records) {
  const groups = [];
  let currentDate = '';
  records.forEach((record) => {
    const d = new Date(record.created_at);
    const dateKey = getDateKey(d);
    const dateLabel = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    if (dateKey !== currentDate) {
      currentDate = dateKey;
      groups.push({ type: 'date', key: `date-${dateKey}`, label: dateLabel, dateKey });
    }
    groups.push({ type: 'record', key: record.id, data: record, dateKey });
  });
  return groups;
}

export default function CheckinDetailScreen({ theme, userId, onBack, onNavigateCalendar }) {
  const insets = useSafeAreaInsets();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recordModalVisible, setRecordModalVisible] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [myTodayCount, setMyTodayCount] = useState(0);
  const [partnerTodayCount, setPartnerTodayCount] = useState(0);
  const [partnerTotalCount, setPartnerTotalCount] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [calendarRecords, setCalendarRecords] = useState({});

  const partnerId = Object.keys(VALID_USERS).find((u) => u !== userId) || '';

  // Current month for mini calendar
  const now = new Date();
  const calYear = now.getFullYear();
  const calMonth = now.getMonth();
  const calCells = useMemo(() => buildCalendarGrid(calYear, calMonth), [calYear, calMonth]);
  const todayDate = now.getDate();
  const todayKey = getDateKey(now);

  // ─── Fetch records ───
  const fetchRecords = useCallback(async () => {
    try {
      // 1. Fetch all records for timeline (limited)
      const { data, count, error } = await fetchWithTimeout(() =>
        supabase
          .from('checkin_records')
          .select('*', { count: 'exact' })
          .eq('theme_id', theme.id)
          .order('created_at', { ascending: false })
          .limit(100)
      );
      if (error) throw error;

      setRecords(data || []);
      setTotalCount(count || 0);

      // 2. Fetch today's counts
      const myToday = await fetchTodayCount(theme.id, userId);
      const partnerToday = await fetchTodayCount(theme.id, partnerId);
      setMyTodayCount(myToday);
      setPartnerTodayCount(partnerToday);

      // 3. Partner total count
      const { count: pCount } = await supabase
        .from('checkin_records')
        .select('*', { count: 'exact', head: true })
        .eq('theme_id', theme.id)
        .eq('user_id', partnerId);
      setPartnerTotalCount(pCount || 0);

      // 4. Fetch current month records for mini calendar
      const { start: monthStart, end: monthEnd } = getMonthRange(calYear, calMonth);
      const { data: calData } = await fetchWithTimeout(() =>
        supabase
          .from('checkin_records')
          .select('id, user_id, media_urls, created_at')
          .eq('theme_id', theme.id)
          .gte('created_at', monthStart)
          .lte('created_at', monthEnd)
          .order('created_at', { ascending: true })
      );

      // Group by date
      const calMap = {};
      (calData || []).forEach((r) => {
        const d = new Date(r.created_at);
        const key = getDateKey(d);
        if (!calMap[key]) calMap[key] = [];
        calMap[key].push(r);
      });
      setCalendarRecords(calMap);
    } catch (error) {
      console.error('Error fetching records:', error);
      Alert.alert('网络有点开小差', '请尝试下拉刷新');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [theme.id, userId, partnerId, calYear, calMonth]);

  // ─── Mount + 启动 15 秒轮询 ───
  useEffect(() => {
    fetchRecords();
  }, []);
  usePolling(fetchRecords, 15000);

  // ─── Android back button ───
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (recordModalVisible) { setRecordModalVisible(false); return true; }
      onBack();
      return true;
    });
    return () => backHandler.remove();
  }, [recordModalVisible, onBack]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRecords();
  }, [fetchRecords]);

  // ─── Delete theme ───
  const handleDeleteTheme = () => {
    Alert.alert('要结束这个打卡吗？', '删除后，你们共同记录的所有时间轴点滴都将永久消失哦...', [
      { text: '留着', style: 'cancel' },
      {
        text: '确定删除',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            const { error } = await fetchWithTimeout(() =>
              supabase.from('checkin_themes').delete().eq('id', theme.id)
            );
            if (error) throw error;
            await fetchWithTimeout(() =>
              supabase.from('messages').insert([{
                user_id: userId,
                content: `${theme.icon} 「${theme.title}」打卡已结束，感谢每一份坚持 💜`,
                type: 'system',
                metadata: { theme_id: theme.id, event: 'theme_deleted' },
              }])
            );
            Alert.alert('已告别该打卡', '所有记录已清除', [{ text: '好的', onPress: () => onBack() }]);
          } catch (error) {
            Alert.alert('删除失败', '请检查网络后重试');
          } finally { setDeleting(false); }
        },
      },
    ]);
  };

  // ─── Submit record ───
  const handleSubmitRecord = async ({ content, media_urls }) => {
    try {
      const { error: recordError } = await fetchWithTimeout(() =>
        supabase.from('checkin_records').insert([{
          theme_id: theme.id, user_id: userId, content, media_urls,
        }])
      );
      if (recordError) throw recordError;

      const todayCount = await fetchTodayCount(theme.id, userId);
      const { data: postMsg, error: msgError } = await fetchWithTimeout(() =>
        supabase.from('messages').insert([{
          user_id: userId,
          content: content || `${theme.icon} ${theme.title} 打卡`,
          type: 'checkin_post',
          metadata: {
            theme_id: theme.id, theme_title: theme.title, theme_icon: theme.icon,
            media_urls, today_count: todayCount,
          },
        }]).select()
      );
      if (msgError) throw msgError;
      if (postMsg && postMsg[0]) emitSignal('chat:message', postMsg[0]);
      fetchRecords();
    } catch (error) {
      console.error('Error submitting record:', error);
      throw new Error('打卡失败，请重试');
    }
  };

  // ─── Helpers ───
  const getAvatarLabel = (uid) => uid === 'momo' ? 'M' : uid === '苞米' ? '苞' : '?';
  const isMe = (uid) => uid === userId;

  // ─── Render mini calendar cell ───
  const renderCalendarCell = (dayNum) => {
    if (dayNum === null) return <View key={`empty-${Math.random()}`} style={styles.calCell} />;
    const dateObj = new Date(calYear, calMonth, dayNum);
    const key = getDateKey(dateObj);
    const dayRecords = calendarRecords[key] || [];
    const hasRecords = dayRecords.length > 0;
    const firstPhoto = hasRecords && dayRecords[0].media_urls?.[0];
    const isToday = dayNum === todayDate;

    return (
      <View key={key} style={styles.calCell}>
        <Text style={[styles.calDate, isToday && styles.calDateToday]}>{dayNum}</Text>
        {firstPhoto ? (
          <CachedImage
            source={firstPhoto}
            style={styles.calThumb}
            contentFit="cover"
            previewable={false}
          />
        ) : hasRecords ? (
          <View style={styles.calDot} />
        ) : null}
      </View>
    );
  };

  // ─── Render timeline item ───
  const renderTimelineItem = (item) => {
    if (item.type === 'date') {
      return (
        <View key={item.key} style={styles.dateNode}>
          <View style={styles.dateNodeLine} />
          <View style={styles.dateNodeBadge}>
            <Text style={styles.dateNodeText}>{item.label}</Text>
          </View>
          <View style={styles.dateNodeLine} />
        </View>
      );
    }

    const record = item.data;
    const me = isMe(record.user_id);
    const hasImages = record.media_urls && record.media_urls.length > 0;
    const identityColor = me ? colors.me : colors.partner;

    return (
      <View key={item.key} style={styles.timelineItem}>
        <View style={styles.timelineLeft}>
          <View style={[styles.timelineDot, { backgroundColor: identityColor }]} />
          <View style={styles.timelineDash} />
        </View>
        <View style={styles.timelineCard}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardAvatar, { backgroundColor: identityColor }]}>
              <Text style={styles.cardAvatarText}>{me ? '我' : getAvatarLabel(record.user_id)}</Text>
            </View>
            <Text style={styles.cardTime}>{formatLocalTime(record.created_at)}</Text>
          </View>
          {record.content ? (
            <Text style={styles.cardContent}>{record.content}</Text>
          ) : null}
          {hasImages && (
            <View style={styles.cardImageGrid}>
              {record.media_urls.slice(0, 9).map((url, i) => (
                <CachedImage
                  key={i}
                  source={url}
                  style={[
                    styles.cardImage,
                    record.media_urls.length === 1 ? styles.cardImageSingle : null,
                  ]}
                  contentFit="cover"
                />
              ))}
            </View>
          )}
        </View>
      </View>
    );
  };

  // Timeline items
  const timelineItems = useMemo(() => groupByDate(records), [records]);

  if (loading) {
    return (
      <View style={styles.container}>
        <AppHeader title={theme?.title} showBack onBack={onBack} compact />
        <LoadingState text="加载记录..." style={styles.flexCenter} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ─── Header ─── */}
      <AppHeader
        title={theme.title}
        showBack
        onBack={onBack}
        compact
        rightAction={
          <TouchableOpacity
            onPress={handleDeleteTheme}
            style={styles.headerDeleteBtn}
            disabled={deleting}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="删除打卡主题"
            accessibilityRole="button"
          >
            <Ionicons
              name="trash-outline"
              size={22}
              color={deleting ? colors.textMuted : colors.error}
            />
          </TouchableOpacity>
        }
      />

      {/* ─── Scrollable content ─── */}
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primaryAction}
            colors={[colors.primaryAction]}
          />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 100, paddingTop: spacing[3] }}
      >
        {/* ── Theme hero banner ── */}
        <Card style={styles.heroCard} contentStyle={styles.heroContent}>
          <View style={styles.heroTop}>
            <Text style={styles.heroIcon}>{theme.icon}</Text>
            <View style={styles.heroMeta}>
              <Text style={styles.heroTitle} numberOfLines={1}>{theme.title}</Text>
              <View style={styles.heroDateRow}>
                <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                <Text style={styles.heroDate}>建立于 {formatLocalDate(theme.created_at)}</Text>
              </View>
            </View>
          </View>
          <View style={styles.heroBadgeRow}>
            <Badge variant="primary">
              <Ionicons name="sparkles" size={11} color={colors.primary[700]} /> 我今日第 {myTodayCount} 次打卡
            </Badge>
          </View>
        </Card>

        {/* ── Dual user stats ── */}
        <Card style={styles.statsCard} contentStyle={styles.statsContent}>
          <View style={styles.statsSide}>
            <Avatar
              size={44}
              fallback={getAvatarLabel(partnerId)}
              style={{ backgroundColor: colors.partnerSoft }}
            />
            <Text style={styles.statsName}>{getAvatarLabel(partnerId)}</Text>
            <Text style={styles.statsCount}>
              <Text style={styles.statsCountBold}>{partnerTotalCount}</Text> 次打卡
            </Text>
          </View>
          <View style={styles.statsDivider} />
          <View style={styles.statsSide}>
            <Avatar
              size={44}
              fallback="我"
              style={{ backgroundColor: colors.meSoft }}
            />
            <Text style={styles.statsName}>我</Text>
            <Text style={styles.statsCount}>
              <Text style={styles.statsCountBold}>{totalCount}</Text> 次打卡
            </Text>
          </View>
        </Card>

        {/* ── Mini Calendar ── */}
        <Card style={styles.calendarCard} contentStyle={styles.calendarContent}>
          <SectionHeader
            title={`${calMonth + 1}月`}
            icon="calendar-outline"
            rightAction={
              <TouchableOpacity
                onPress={() => onNavigateCalendar?.(theme)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.calendarMore}>全部 ›</Text>
              </TouchableOpacity>
            }
            style={styles.calendarSectionHeader}
          />
          <View style={styles.calendarWeekHeader}>
            {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
              <Text key={d} style={styles.calendarWeekText}>{d}</Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {calCells.map((day) => renderCalendarCell(day))}
          </View>
        </Card>

        {/* ── Today check-in status ── */}
        <View style={styles.todaySection}>
          <SectionHeader title="今日打卡" icon="today-outline" />
          <View style={styles.todayCardsRow}>
            <Card variant="statistic" style={styles.todayCard} contentStyle={styles.todayCardContent}>
              <Avatar
                size={36}
                fallback={getAvatarLabel(partnerId)}
                style={{ backgroundColor: colors.partnerSoft }}
              />
              <Text style={styles.todayName}>{getAvatarLabel(partnerId)}</Text>
              <Text style={[styles.todayStatus, partnerTodayCount > 0 ? styles.todayDone : styles.todayNotDone]}>
                {partnerTodayCount > 0 ? `已打卡 ${partnerTodayCount} 次` : '未打卡'}
              </Text>
            </Card>
            <Card variant="statistic" style={styles.todayCard} contentStyle={styles.todayCardContent}>
              <Avatar
                size={36}
                fallback="我"
                style={{ backgroundColor: colors.meSoft }}
              />
              <Text style={styles.todayName}>我</Text>
              <Text style={[styles.todayStatus, myTodayCount > 0 ? styles.todayDone : styles.todayNotDone]}>
                {myTodayCount > 0 ? `已打卡 ${myTodayCount} 次` : '未打卡'}
              </Text>
            </Card>
          </View>
        </View>

        {/* ── Timeline ── */}
        {timelineItems.length === 0 ? (
          <EmptyState
            icon="create-outline"
            title="还没有打卡记录"
            description="点击下方按钮，记录今天吧"
            style={styles.emptyState}
          />
        ) : (
          <View style={styles.timelineContent}>
            {timelineItems.map((item) => renderTimelineItem(item))}
          </View>
        )}
      </ScrollView>

      {/* ─── Floating action bar ─── */}
      <BottomActionBar style={styles.bottomBar}>
        <Button
          variant="primary"
          size="large"
          fullWidth
          iconLeft="sparkles"
          onPress={() => setRecordModalVisible(true)}
        >
          立即打卡
        </Button>
      </BottomActionBar>

      {/* ─── Record modal ─── */}
      <CheckinRecordModal
        visible={recordModalVisible}
        onClose={() => setRecordModalVisible(false)}
        onSubmit={handleSubmitRecord}
        theme={theme}
        userId={userId}
      />
    </View>
  );
}

// ─── Styles ───
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1, backgroundColor: colors.background },
  flexCenter: { flex: 1 },

  // Header delete
  headerDeleteBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Hero card
  heroCard: {
    marginHorizontal: PAGE_MARGIN,
    marginBottom: spacing[3],
  },
  heroContent: {},
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  heroIcon: { fontSize: 32, marginRight: spacing[3] },
  heroMeta: { flex: 1 },
  heroTitle: { ...typography.sectionTitle, color: colors.textPrimary },
  heroDateRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing[1] },
  heroDate: { ...typography.caption, color: colors.textMuted, marginLeft: spacing[1] },
  heroBadgeRow: { marginTop: spacing[3] },

  // Stats card
  statsCard: {
    marginHorizontal: PAGE_MARGIN,
    marginBottom: spacing[3],
  },
  statsContent: {},
  statsSide: { flex: 1, alignItems: 'center' },
  statsName: { ...typography.label, color: colors.textSecondary, fontWeight: '500', marginTop: spacing[2] },
  statsCount: { ...typography.caption, color: colors.textMuted, marginTop: spacing[1] },
  statsCountBold: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  statsDivider: { width: 1, height: 56, backgroundColor: colors.border, marginHorizontal: spacing[2] },

  // Mini calendar
  calendarCard: {
    marginHorizontal: PAGE_MARGIN,
    marginBottom: spacing[3],
  },
  calendarContent: {},
  calendarSectionHeader: { marginBottom: spacing[2] },
  calendarMore: { ...typography.caption, color: colors.primaryAction, fontWeight: '500' },
  calendarWeekHeader: { flexDirection: 'row', marginBottom: spacing[1] },
  calendarWeekText: {
    flex: 1,
    textAlign: 'center',
    ...typography.tabLabel,
    color: colors.textMuted,
    fontWeight: '500',
  },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: {
    width: CALENDAR_CELL_SIZE,
    height: CALENDAR_CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  calDate: { ...typography.tabLabel, color: colors.textMuted, marginBottom: 2 },
  calDateToday: { color: colors.primaryAction, fontWeight: 'bold', fontSize: 12 },
  calThumb: { width: CALENDAR_CELL_SIZE - 6, height: CALENDAR_CELL_SIZE - 6, borderRadius: radius.xs },
  calDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.primary[300] },

  // Today section
  todaySection: { marginHorizontal: PAGE_MARGIN, marginBottom: spacing[3] },
  todayCardsRow: { flexDirection: 'row', gap: spacing[3] },
  todayCard: { flex: 1 },
  todayCardContent: { alignItems: 'center' },
  todayName: { ...typography.label, color: colors.textSecondary, fontWeight: '500', marginTop: spacing[2], marginBottom: spacing[1] },
  todayStatus: { ...typography.label, fontWeight: '500' },
  todayDone: { color: colors.partner },
  todayNotDone: { color: colors.textMuted },

  // Timeline
  timelineContent: { paddingHorizontal: PAGE_MARGIN, paddingTop: spacing[4] },
  dateNode: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: spacing[2] },
  dateNodeLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dateNodeBadge: {
    backgroundColor: colors.primary[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    marginHorizontal: spacing[2],
  },
  dateNodeText: { ...typography.caption, color: colors.primary[700], fontWeight: '500' },
  timelineItem: { flexDirection: 'row', marginBottom: spacing[3] },
  timelineLeft: { width: TIMELINE_LEFT_WIDTH, alignItems: 'center' },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: spacing[2] },
  timelineDash: {
    flex: 1,
    width: 1,
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary[200],
    marginTop: 2,
  },
  timelineCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.soft,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing[2] },
  cardAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing[2],
  },
  cardAvatarText: { color: '#FFFFFF', fontSize: 10, fontWeight: 'bold' },
  cardTime: { ...typography.caption, color: colors.textMuted },
  cardContent: { ...typography.body, color: colors.textPrimary, lineHeight: 20, marginBottom: spacing[2] },
  cardImageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
  cardImage: {
    width: TIMELINE_IMAGE_SIZE,
    height: TIMELINE_IMAGE_SIZE,
    borderRadius: radius.sm,
  },
  cardImageSingle: { width: '100%', height: 160, borderRadius: radius.sm },

  // Empty
  emptyState: { marginTop: spacing[10] },

  // Bottom bar
  bottomBar: {},
});
