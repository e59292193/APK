import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Alert,
  Platform,
  BackHandler,
  Keyboard,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { usePolling } from '../hooks/usePolling';
import { colors, typography, spacing, radius } from '../theme';
import {
  AppHeader,
  Button,
  Card,
  AppInput,
  EmptyState,
  LoadingState,
  SegmentedControl,
  Badge,
  BottomSheetContainer,
  FloatingActionButton,
} from '../components/ui';

// Try loading DateTimePicker safely for cross-platform compatibility
let RNDateTimePicker = null;
let DateTimePickerAndroid = null;
if (Platform.OS !== 'web') {
  try {
    RNDateTimePicker = require('@react-native-community/datetimepicker').default;
    DateTimePickerAndroid = require('@react-native-community/datetimepicker').DateTimePickerAndroid;
  } catch (e) {
    console.warn('DateTimePicker not available in this environment');
  }
}

// ─── Math/Date Helpers for Anniversaries ───

// 1. Calculate elapsed days from past date (Cumulative)
function calculateDaysElapsed(dateString) {
  if (!dateString) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // parse standard date yyyy-mm-dd
  const start = new Date(dateString);
  start.setHours(0, 0, 0, 0);

  const diffTime = today.getTime() - start.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays >= 0 ? diffDays : 0;
}

// 2. Calculate remaining days until future date (Countdown)
function calculateDaysRemaining(dateString) {
  if (!dateString) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);

  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays >= 0 ? diffDays : 0;
}

// 3. Calculate days until the next yearly occurrence of a past date
function calculateDaysUntilNextAnniversary(dateString) {
  if (!dateString) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(dateString);

  // Create anniversary date for this year
  const thisYearAnn = new Date(today.getFullYear(), start.getMonth(), start.getDate());

  let nextAnn = thisYearAnn;
  if (thisYearAnn < today) {
    // If it passed this year, the next one is next year
    nextAnn = new Date(today.getFullYear() + 1, start.getMonth(), start.getDate());
  }

  const diffTime = nextAnn.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

export default function AnniversaryScreen({ userId }) {
  const insets = useSafeAreaInsets();
  const [anniversaries, setAnniversaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Form / Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null); // null means adding, number/string means editing
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType] = useState('cumulative'); // 'cumulative' or 'countdown'
  const [formDate, setFormDate] = useState(new Date());
  const [formRemark, setFormRemark] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load anniversaries
  useEffect(() => {
    fetchAnniversaries();
  }, []);

  // Back button handler for modal
  useEffect(() => {
    const onBackPress = () => {
      if (modalVisible) {
        closeModal();
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, [modalVisible]);

  const fetchAnniversaries = async () => {
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase
          .from('anniversaries')
          .select('*')
          .order('is_pinned', { ascending: false })
          .order('date', { ascending: true })
          .limit(50)
      );

      if (error) throw error;
      setAnniversaries(data || []);
    } catch (error) {
      console.error('Error fetching anniversaries:', error);
      Alert.alert('网络有点开小差', '无法加载纪念日列表，下拉刷新重试');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  // 启动 15 秒轮询（需放在 fetchAnniversaries 声明之后）
  usePolling(fetchAnniversaries, 15000);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAnniversaries();
  }, []);

  // Date Pickers
  const showAndroidDatePicker = () => {
    if (DateTimePickerAndroid && DateTimePickerAndroid.open) {
      DateTimePickerAndroid.open({
        mode: 'date',
        value: formDate,
        display: 'default',
        onValueChange: (_event, selectedDate) => {
          if (selectedDate) {
            setFormDate(selectedDate);
          }
        },
      });
    } else {
      setShowDatePicker(true);
    }
  };

  const handleDateChange = (_event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) {
      setFormDate(selectedDate);
    }
  };

  const handleWebDateChange = (e) => {
    const val = e.target.value;
    if (val) {
      const parsed = new Date(val);
      if (!isNaN(parsed.getTime())) {
        setFormDate(parsed);
      }
    }
  };

  // Open modal for Adding
  const handleOpenAdd = () => {
    setEditingId(null);
    setFormTitle('');
    setFormType('cumulative');
    setFormDate(new Date());
    setFormRemark('');
    setModalVisible(true);
  };

  // Open modal for Editing
  const handleOpenEdit = (item) => {
    setEditingId(item.id);
    setFormTitle(item.title);
    setFormType(item.type);
    setFormDate(new Date(item.date));
    setFormRemark(item.remark || '');
    setModalVisible(true);
  };

  const closeModal = () => {
    Keyboard.dismiss();
    setModalVisible(false);
    setShowDatePicker(false);
  };

  // Create or Update anniversary
  const handleSave = async () => {
    if (!formTitle.trim()) {
      Alert.alert('提示', '请输入纪念日标题');
      return;
    }

    setSaving(true);
    const dateStr = formDate.toISOString().split('T')[0]; // YYYY-MM-DD

    try {
      if (editingId) {
        // Update
        const { error } = await supabase
          .from('anniversaries')
          .update({
            title: formTitle.trim(),
            type: formType,
            date: dateStr,
            remark: formRemark.trim() || null,
          })
          .eq('id', editingId);

        if (error) throw error;
      } else {
        // Insert
        const { error } = await supabase
          .from('anniversaries')
          .insert([
            {
              creator_id: userId,
              title: formTitle.trim(),
              type: formType,
              date: dateStr,
              remark: formRemark.trim() || null,
              is_pinned: false,
            },
          ]);

        if (error) throw error;
      }

      closeModal();
      fetchAnniversaries();
    } catch (error) {
      console.error('Error saving anniversary:', error);
      Alert.alert('保存失败', '请检查网络连接后重试');
    } finally {
      setSaving(false);
    }
  };

  // Toggle Pinned status
  const handleTogglePin = async (item) => {
    try {
      const { error } = await supabase
        .from('anniversaries')
        .update({ is_pinned: !item.is_pinned })
        .eq('id', item.id);

      if (error) throw error;
      fetchAnniversaries();
    } catch (error) {
      console.error('Error toggling pin:', error);
      Alert.alert('操作失败', '请检查网络连接');
    }
  };

  // Delete anniversary
  const handleDelete = (id) => {
    Alert.alert('删除纪念日', '确定要删除这个纪念日吗？此操作不可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '确定删除',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase
              .from('anniversaries')
              .delete()
              .eq('id', id);

            if (error) throw error;
            closeModal();
            fetchAnniversaries();
          } catch (error) {
            console.error('Error deleting anniversary:', error);
            Alert.alert('删除失败', '请重试');
          }
        },
      },
    ]);
  };

  // Card Options: Pin, Edit, Delete
  const handleCardPress = (item) => {
    Alert.alert(
      item.title,
      '您想对该纪念日进行什么操作？',
      [
        {
          text: item.is_pinned ? '取消置顶' : '置顶纪念日',
          onPress: () => handleTogglePin(item),
        },
        {
          text: '编辑',
          onPress: () => handleOpenEdit(item),
        },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => handleDelete(item.id),
        },
        { text: '取消', style: 'cancel' },
      ]
    );
  };

  // Render Anniversary Card
  const renderItem = ({ item }) => {
    const isCumulative = item.type === 'cumulative';
    let daysNum = 0;
    let daysUntilNext = 0;

    if (isCumulative) {
      daysNum = calculateDaysElapsed(item.date);
      daysUntilNext = calculateDaysUntilNextAnniversary(item.date);
    } else {
      daysNum = calculateDaysRemaining(item.date);
    }

    const dateParts = item.date ? item.date.split('-') : [];
    const monthStr = dateParts[1] || '';
    const dayStr = dateParts[2] || '';
    const numberColor = isCumulative ? colors.primaryAction : colors.coral[500];

    return (
      <Card
        variant="interactive"
        onPress={() => handleCardPress(item)}
        style={styles.card}
      >
        <View style={styles.cardRow}>
          {/* Left small date block (start/target date) */}
          <View style={styles.dateBlock}>
            <Text style={styles.dateBlockMonth}>{monthStr}月</Text>
            <Text style={styles.dateBlockDay}>{dayStr}</Text>
          </View>

          {/* Center: title → next anniversary → note */}
          <View style={styles.cardCenter}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title}
              </Text>
              {item.is_pinned ? (
                <Badge variant="primary" size="sm" style={styles.pinBadge}>
                  <Ionicons name="pin" size={10} color={colors.primary[700]} /> 置顶
                </Badge>
              ) : null}
            </View>

            {isCumulative ? (
              <View style={styles.nextAnniversaryRow}>
                <Ionicons name="refresh-outline" size={12} color={colors.textMuted} />
                <Text style={styles.nextAnniversaryText}>
                  下个周年 · 还有{' '}
                  <Text style={styles.nextAnniversaryHighlight}>{daysUntilNext}</Text> 天
                </Text>
              </View>
            ) : null}

            {item.remark ? (
              <Text style={styles.cardRemark} numberOfLines={2}>
                {item.remark}
              </Text>
            ) : null}
          </View>

          {/* Right: core number with "已经/还有" semantic */}
          <View style={styles.cardRight}>
            <Text style={styles.semanticPre}>{isCumulative ? '已经' : '还有'}</Text>
            <Text style={[styles.bigNumber, { color: numberColor }]}>{daysNum}</Text>
            <Text style={styles.semanticPost}>天</Text>
          </View>
        </View>
      </Card>
    );
  };

  const formDateLabel = `${formDate.getFullYear()}年${(formDate.getMonth() + 1)
    .toString()
    .padStart(2, '0')}月${formDate.getDate().toString().padStart(2, '0')}日`;

  return (
    <View style={styles.container}>
      <AppHeader title="纪念日" subtitle="重要的日子，值得被好好记住" />

      {loading ? (
        <LoadingState text="加载纪念日中..." style={styles.loadingWrap} />
      ) : (
        <FlatList
          data={anniversaries}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={8}
          removeClippedSubviews={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primaryAction}
              colors={[colors.primaryAction]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="还没有记录纪念日"
              description="点击右下角按钮，记录你们的第一个纪念日吧"
              actionLabel="新增纪念日"
              onAction={handleOpenAdd}
              style={styles.emptyWrap}
            />
          }
        />
      )}

      {/* FAB */}
      <FloatingActionButton
        icon="calendar-outline"
        label="新增纪念日"
        onPress={handleOpenAdd}
      />

      {/* Add / Edit Modal */}
      <BottomSheetContainer
        visible={modalVisible}
        title={editingId ? '编辑纪念日' : '新增纪念日'}
        onClose={closeModal}
        actionLabel="保存记录"
        onAction={handleSave}
        loading={saving}
      >
        <AppInput
          label="事项名称"
          placeholder="例如：在一起、百天、Ta的生日..."
          value={formTitle}
          onChangeText={setFormTitle}
          maxLength={50}
        />

        <Text style={styles.fieldLabel}>计算类型</Text>
        <SegmentedControl
          segments={[
            { key: 'cumulative', label: '起始日' },
            { key: 'countdown', label: '倒计时' },
          ]}
          selectedIndex={formType === 'cumulative' ? 0 : 1}
          onChange={(i) => setFormType(i === 0 ? 'cumulative' : 'countdown')}
          style={styles.segmented}
        />

        <Text style={styles.fieldLabel}>选择日期</Text>
        {Platform.OS === 'web' ? (
          <View style={styles.datePickerContainer}>
            <input
              type="date"
              value={formDate.toISOString().split('T')[0]}
              onChange={handleWebDateChange}
              style={styles.webDatePicker}
            />
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={styles.datePickerBtn}
              onPress={Platform.OS === 'android' ? showAndroidDatePicker : () => setShowDatePicker(true)}
              activeOpacity={0.7}
            >
              <View style={styles.datePickerLeft}>
                <Ionicons name="calendar-outline" size={18} color={colors.primaryAction} />
                <Text style={styles.datePickerBtnText}>{formDateLabel}</Text>
              </View>
              <Text style={styles.datePickerChangeText}>修改</Text>
            </TouchableOpacity>

            {showDatePicker && RNDateTimePicker && Platform.OS === 'ios' && (
              <RNDateTimePicker
                value={formDate}
                mode="date"
                display="spinner"
                onChange={handleDateChange}
              />
            )}
          </>
        )}

        <AppInput
          label="个性备注 (选填)"
          placeholder="例如：♡+♡=♡²、岁岁常相见..."
          value={formRemark}
          onChangeText={setFormRemark}
          maxLength={80}
          multiline
        />

        {editingId ? (
          <Button
            variant="danger"
            size="medium"
            iconLeft="trash-outline"
            fullWidth
            onPress={() => handleDelete(editingId)}
            style={styles.deleteBtn}
          >
            删除纪念日
          </Button>
        ) : null}
      </BottomSheetContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingWrap: {
    flex: 1,
  },
  emptyWrap: {
    marginTop: spacing[10],
  },
  listContent: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
  },

  // ── Card ──
  card: {
    marginBottom: spacing[3],
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateBlock: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    marginRight: spacing[3],
  },
  dateBlockMonth: {
    ...typography.label,
    color: colors.primary[600],
    fontWeight: '600',
  },
  dateBlockDay: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.primary[800],
    marginTop: 2,
  },
  cardCenter: {
    flex: 1,
    marginRight: spacing[3],
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  pinBadge: {
    marginLeft: spacing[2],
  },
  cardRemark: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 4,
  },
  nextAnniversaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  nextAnniversaryText: {
    ...typography.caption,
    color: colors.textMuted,
    marginLeft: spacing[1],
  },
  nextAnniversaryHighlight: {
    color: colors.primaryAction,
    fontWeight: '600',
  },
  cardRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
  },
  semanticPre: {
    ...typography.caption,
    color: colors.textSecondary,
    marginRight: spacing[1],
  },
  bigNumber: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
  },
  semanticPost: {
    ...typography.caption,
    color: colors.textSecondary,
    marginLeft: spacing[1],
  },

  // ── Form ──
  fieldLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginTop: spacing[3],
    marginBottom: spacing[2],
  },
  segmented: {
    marginBottom: spacing[2],
  },
  datePickerContainer: {
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    marginBottom: spacing[2],
  },
  datePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    marginBottom: spacing[2],
  },
  datePickerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  datePickerBtnText: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    marginLeft: spacing[2],
  },
  datePickerChangeText: {
    ...typography.label,
    color: colors.primaryAction,
    fontWeight: '600',
  },
  webDatePicker: {
    width: '100%',
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontSize: 15,
    color: colors.textPrimary,
    outline: 'none',
    padding: 8,
  },
  deleteBtn: {
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
});
