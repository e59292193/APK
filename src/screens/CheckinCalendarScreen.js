/**
 * CheckinCalendarScreen — 全日历页（现代淡紫风格）
 *
 * 多月日历视图，每格显示打卡照片缩略图。
 * 性能优化：限制3个月范围 + 客户端按日期分组 + useMemo缓存 + "只看我"纯客户端过滤
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  RefreshControl,
  Alert,
  Dimensions,
  BackHandler,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { usePolling } from '../hooks/usePolling';
import { formatLocalDate } from '../lib/dateUtils';
import { CachedImage } from '../lib/imageCache';
import { colors, typography, spacing, radius } from '../theme';
import { AppHeader, Card, EmptyState, LoadingState } from '../components/ui';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Page horizontal margin (spacing[5]=20) + Card padding (spacing[4]=16), both sides
const CAL_CELL_WIDTH = (SCREEN_WIDTH - (spacing[5] + spacing[4]) * 2) / 7;
const CAL_CELL_HEIGHT = CAL_CELL_WIDTH + 18; // taller to fit date + thumbnail
const THUMB_SIZE = CAL_CELL_WIDTH - 6;

const VALID_USERS = { momo: true, '苞米': true };

// ─── Calendar helpers ───
function getDateKey(d) {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function buildCalendarGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const firstDayOfWeek = (firstDay.getDay() + 6) % 7; // Monday=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // 补齐最后一行到7格（防止星期日位置缺失）
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function getMonthRange(year, month) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ─── Build list of last 3 months (including current) ───
function getRecentMonths(count) {
  const now = new Date();
  const months = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  return months; // [current, last, ...] most recent first
}

export default function CheckinCalendarScreen({ theme, userId, onBack }) {
  const insets = useSafeAreaInsets();
  const [allRecords, setAllRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [onlyMe, setOnlyMe] = useState(false);

  const partnerId = Object.keys(VALID_USERS).find((u) => u !== userId) || '';
  const months = useMemo(() => getRecentMonths(3), []);
  const now = new Date();
  const todayKey = getDateKey(now);

  // ─── Fetch 3 months of records ───
  const fetchCalendarData = useCallback(async () => {
    try {
      // Get range covering all 3 months
      const oldestMonth = months[months.length - 1];
      const { start } = getMonthRange(oldestMonth.year, oldestMonth.month);
      const nowEnd = new Date();
      nowEnd.setHours(23, 59, 59, 999);

      const { data, error } = await fetchWithTimeout(() =>
        supabase
          .from('checkin_records')
          .select('id, user_id, media_urls, content, created_at')
          .eq('theme_id', theme.id)
          .gte('created_at', start)
          .lte('created_at', nowEnd.toISOString())
          .order('created_at', { ascending: true })
      );

      if (error) throw error;
      setAllRecords(data || []);
    } catch (error) {
      console.error('Error fetching calendar data:', error);
      Alert.alert('网络有点开小差', '请尝试下拉刷新');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [theme.id, months]);

  // ─── Mount + 启动 15 秒轮询 ───
  useEffect(() => {
    fetchCalendarData();
  }, []);
  usePolling(fetchCalendarData, 15000);

  // ─── Android back button ───
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => backHandler.remove();
  }, [onBack]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchCalendarData();
  }, [fetchCalendarData]);

  // ─── Group records by date key, with optional "only me" filter ───
  const recordsByDate = useMemo(() => {
    const filtered = onlyMe ? allRecords.filter((r) => r.user_id === userId) : allRecords;
    const map = {};
    filtered.forEach((r) => {
      const d = new Date(r.created_at);
      const key = getDateKey(d);
      if (!map[key]) map[key] = [];
      map[key].push(r);
    });
    return map;
  }, [allRecords, onlyMe, userId]);

  // ─── Helpers ───
  const getAvatarLabel = (uid) => uid === 'momo' ? 'M' : uid === '苞米' ? '苞' : '?';
  const isMe = (uid) => uid === userId;

  // ─── Render a calendar cell ───
  const renderCalCell = (dayNum, year, month) => {
    if (dayNum === null) {
      return <View key={`empty-${Math.random()}`} style={styles.calCell} />;
    }
    const dateObj = new Date(year, month, dayNum);
    const key = getDateKey(dateObj);
    const dayRecords = recordsByDate[key] || [];
    const hasRecords = dayRecords.length > 0;
    const isToday = key === todayKey;
    const isFuture = dateObj > now;

    // 收集每个用户的第一张照片
    const photosByUser = [];
    const seenUsers = new Set();
    for (const rec of dayRecords) {
      if (!seenUsers.has(rec.user_id) && rec.media_urls && rec.media_urls.length > 0) {
        seenUsers.add(rec.user_id);
        photosByUser.push({ url: rec.media_urls[0], isMe: isMe(rec.user_id) });
      }
    }

    return (
      <View key={key} style={[styles.calCell, isFuture && styles.calCellFuture]}>
        <View style={[styles.calDateWrap, isToday && styles.calDateWrapToday]}>
          <Text style={[styles.calDate, isToday && styles.calDateToday]}>{dayNum}</Text>
        </View>
        {photosByUser.length === 1 ? (
          <CachedImage
            source={photosByUser[0].url}
            style={styles.calThumb}
            contentFit="cover"
            previewable={false}
          />
        ) : photosByUser.length >= 2 ? (
          <View style={styles.calThumbPair}>
            <CachedImage
              source={photosByUser.find(p => !p.isMe)?.url || photosByUser[0].url}
              style={styles.calThumbHalf}
              contentFit="cover"
              previewable={false}
            />
            <CachedImage
              source={photosByUser.find(p => p.isMe)?.url || photosByUser[1].url}
              style={[styles.calThumbHalf, styles.calThumbHalfRight]}
              contentFit="cover"
              previewable={false}
            />
          </View>
        ) : hasRecords ? (
          <View style={styles.calDot} />
        ) : null}
      </View>
    );
  };

  // ─── Render a month card ───
  const renderMonthCard = ({ year, month }) => {
    const cells = buildCalendarGrid(year, month);
    const monthLabel = `${year}年${month + 1}月`;

    return (
      <Card key={`${year}-${month}`} style={styles.monthCard}>
        <Text style={styles.monthTitle}>{monthLabel}</Text>
        <View style={styles.weekHeader}>
          {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
            <Text key={d} style={styles.weekText}>{d}</Text>
          ))}
        </View>
        <View style={styles.calGrid}>
          {cells.map((day) => renderCalCell(day, year, month))}
        </View>
      </Card>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <AppHeader showBack onBack={onBack} title="打卡日历" compact />
        <LoadingState text="加载日历..." style={styles.loadingState} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ─── Header ─── */}
      <AppHeader
        showBack
        onBack={onBack}
        title="打卡日历"
        subtitle={`${theme.icon} ${theme.title}`}
        compact
      />

      {/* ─── Calendar scroll ─── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primaryAction}
          />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing[10] }}
      >
        {/* ─── Filter Row ─── */}
        <View style={styles.filterRow}>
          <Ionicons name="eye-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.filterLabel}>仅看我</Text>
          <Switch
            value={onlyMe}
            onValueChange={setOnlyMe}
            trackColor={{ false: colors.neutral[200], true: colors.primaryAction }}
            thumbColor={colors.surface}
            style={styles.filterSwitch}
          />
        </View>

        {/* ─── Summary ─── */}
        <Card style={styles.summaryCard}>
          <View style={styles.summaryInner}>
            <View style={styles.summarySide}>
              <View style={[styles.summaryAvatar, { backgroundColor: colors.partner }]}>
                <Text style={styles.summaryAvatarText}>{getAvatarLabel(partnerId)}</Text>
              </View>
              <Text style={styles.summaryCount}>
                <Text style={styles.summaryCountBold}>
                  {onlyMe ? '—' : allRecords.filter((r) => r.user_id === partnerId).length}
                </Text> 次
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summarySide}>
              <View style={[styles.summaryAvatar, { backgroundColor: colors.me }]}>
                <Text style={styles.summaryAvatarText}>我</Text>
              </View>
              <Text style={styles.summaryCount}>
                <Text style={styles.summaryCountBold}>
                  {allRecords.filter((r) => r.user_id === userId).length}
                </Text> 次
              </Text>
            </View>
          </View>
        </Card>

        {/* ─── Month cards ─── */}
        {months.map((m) => renderMonthCard(m))}

        {/* ─── Empty state ─── */}
        {allRecords.length === 0 && (
          <EmptyState
            icon="images-outline"
            title="近三个月还没有打卡记录"
            description="去打卡，留下你们的足迹吧"
          />
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Loading
  loadingState: { flex: 1 },

  // Filter Row
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  filterLabel: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    marginLeft: spacing[2],
    flex: 1,
  },
  filterSwitch: {
    transform: [{ scale: 0.9 }],
  },

  // Summary
  summaryCard: {
    marginHorizontal: spacing[5],
    marginBottom: spacing[3],
  },
  summaryInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
  },
  summarySide: { flex: 1, alignItems: 'center' },
  summaryAvatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing[1],
  },
  summaryAvatarText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '700',
  },
  summaryCount: {
    ...typography.caption,
    color: colors.textMuted,
  },
  summaryCountBold: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primaryAction,
  },
  summaryDivider: {
    width: 1,
    height: 48,
    backgroundColor: colors.border,
  },

  // Month card
  monthCard: {
    marginHorizontal: spacing[5],
    marginBottom: spacing[6],
  },
  monthTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing[3],
  },
  weekHeader: {
    flexDirection: 'row',
    marginBottom: spacing[1],
  },
  weekText: {
    flex: 1,
    textAlign: 'center',
    ...typography.label,
    color: colors.textMuted,
  },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calCell: {
    width: CAL_CELL_WIDTH,
    height: CAL_CELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  calCellFuture: {
    opacity: 0.4,
  },
  calDateWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    marginBottom: 2,
  },
  calDateWrapToday: {
    backgroundColor: colors.primary[100],
  },
  calDate: {
    ...typography.label,
    color: colors.textSecondary,
  },
  calDateToday: {
    color: colors.primaryAction,
    fontWeight: '700',
  },
  calThumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.xs,
  },
  calThumbPair: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    flexDirection: 'row',
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  calThumbHalf: {
    width: THUMB_SIZE / 2 + 2,
    height: THUMB_SIZE,
  },
  calThumbHalfRight: {
    marginLeft: -2,
  },
  calDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primary[300],
    marginTop: spacing[1],
  },
});
