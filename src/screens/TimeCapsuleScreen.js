import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Image,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { pickAndUploadImage } from '../lib/photoUtils';
import { formatLocalDate, formatLocalTime, formatLocalDateTime, getCountdown } from '../lib/dateUtils';

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

// ─── Countdown Hook ───
function useCountdownTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return tick;
}

function getCapsuleStatus(item) {
  const now = new Date();
  const unlockTime = new Date(item.unlock_time);
  if (item.is_opened) return 'opened';
  if (now >= unlockTime) return 'ready';
  return 'locked';
}

// ─── Main Component ───
export default function TimeCapsuleScreen({ userId: propUserId }) {
  const [capsules, setCapsules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const userId = propUserId || '';
  const [connectionError, setConnectionError] = useState(false);
  const channelRef = useRef(null);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [letterContent, setLetterContent] = useState('');
  const [unlockDate, setUnlockDate] = useState(new Date(Date.now() + 86400000));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [capsulePhotoUrl, setCapsulePhotoUrl] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Countdown tick — triggers re-render every second
  useCountdownTick();

  useEffect(() => {
    initializeApp();
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  const initializeApp = async () => {
    try {
      await fetchCapsules();

      const channel = supabase
        .channel('realtime-capsules')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'time_capsules' },
          (payload) => {
            setCapsules((prev) => {
              // Avoid duplicates from optimistic update
              if (prev.some((c) => c.id === payload.new.id)) return prev;
              return [payload.new, ...prev];
            });
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'time_capsules' },
          (payload) => {
            setCapsules((prev) =>
              prev.map((item) => (item.id === payload.new.id ? payload.new : item))
            );
          }
        )
        .subscribe();

      channelRef.current = channel;
    } catch (error) {
      console.error('Error initializing app:', error);
      setConnectionError(true);
    }
  };

  const fetchCapsules = async () => {
    try {
      const { data, error } = await supabase
        .from('time_capsules')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCapsules(data);
      setConnectionError(false);
    } catch (error) {
      console.error('Error fetching capsules:', error);
      setConnectionError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

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
      const { data, error } = await supabase.from('time_capsules').insert([
        {
          creator_id: userId,
          content: letterContent.trim(),
          unlock_time: unlockDate.toISOString(),
          is_opened: false,
          photo_url: capsulePhotoUrl || null,
        },
      ]).select();

      if (error) throw error;

      // Optimistic update: add the new capsule to the top of the list
      if (data && data.length > 0) {
        setCapsules((prev) => [data[0], ...prev]);
      }
      setLetterContent('');
      setUnlockDate(new Date(Date.now() + 86400000));
      setCapsulePhotoUrl('');
      setModalVisible(false);
    } catch (error) {
      console.error('Error sealing capsule:', error);
      Alert.alert('错误', '封存失败，请检查网络连接');
    } finally {
      setSaving(false);
    }
  };

  // ─── Unlock Action ───
  const handleOpenCapsule = (item) => {
    Alert.alert(
      '✨ 开启时光胶囊',
      '准备好开启这封来自过去的信了吗？',
      [
        { text: '再等等', style: 'cancel' },
        {
          text: '拆开信件',
          onPress: async () => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

            try {
              const { error } = await supabase
                .from('time_capsules')
                .update({ is_opened: true })
                .eq('id', item.id);

              if (error) throw error;

              setCapsules((prev) =>
                prev.map((c) =>
                  c.id === item.id ? { ...c, is_opened: true } : c
                )
              );
            } catch (error) {
              console.error('Error opening capsule:', error);
              Alert.alert('错误', '开启失败，请重试');
            }
          },
        },
      ]
    );
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
            // After date is picked, show time picker
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
                  // User dismissed time picker, still use the picked date
                  setUnlockDate(pickedDate);
                },
              });
            }
          }
        },
        onDismiss: () => {
          // User dismissed date picker, do nothing
        },
      });
    } else {
      setShowDatePicker(true);
    }
  };

  // ─── iOS: declarative picker onChange handler ───
  const onIOSDateChange = (_event, selectedDate) => {
    setShowDatePicker(false);
    if (_event.type === 'dismissed') {
      return;
    }
    if (selectedDate) {
      setUnlockDate(selectedDate);
    }
  };

  const onWebDateChange = (e) => {
    const value = e.target.value;
    if (value) {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        setUnlockDate(parsed);
      }
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

  // ─── Card Renderer ───
  const renderItem = ({ item }) => {
    const status = getCapsuleStatus(item);
    const isMe = item.creator_id === userId;

    // ── Status A: Locked (封存中) ──
    if (status === 'locked') {
      const countdown = getCountdown(item.unlock_time);
      return (
        <View style={[styles.card, styles.cardLocked]}>
          <View style={styles.lockedIconRow}>
            <Text style={styles.lockedIcon}>✉️</Text>
          </View>
          <Text style={styles.lockedTitle}>时光胶囊封存中</Text>
          <View style={styles.countdownBox}>
            <Text style={styles.countdownLabel}>距离解锁还有</Text>
            <Text style={styles.countdownText}>{countdown}</Text>
          </View>
          <View style={styles.cardFooter}>
            <Text style={styles.footerText}>
              由 {isMe ? '我' : item.creator_id} 封存于 {formatLocalDate(item.created_at)}
            </Text>
          </View>
        </View>
      );
    }

    // ── Status B: Ready (待拆开) ──
    if (status === 'ready') {
      return (
        <TouchableOpacity
          style={[styles.card, styles.cardReady]}
          onPress={() => handleOpenCapsule(item)}
          activeOpacity={0.7}
        >
          <View style={styles.readyIconRow}>
            <Text style={styles.readyIcon}>✨</Text>
          </View>
          <Text style={styles.readyTitle}>时光已送达</Text>
          <Text style={styles.readySubtitle}>点击拆开信件</Text>
          <View style={styles.cardFooter}>
            <Text style={styles.footerText}>
              由 {isMe ? '我' : item.creator_id} 于 {formatLocalDate(item.created_at)} 封存
            </Text>
            <Text style={styles.footerText}>
              原定解锁：{formatLocalDateTime(item.unlock_time)}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }

    // ── Status C: Opened (已解锁) ──
    return (
      <View style={[styles.card, styles.cardOpened]}>
        <View style={styles.openedHeader}>
          <Text style={styles.openedIcon}>📖</Text>
          <Text style={styles.openedTitle}>
            来自 {isMe ? '我' : item.creator_id} 的未来信
          </Text>
        </View>
        <View style={styles.contentArea}>
          <Text style={styles.contentText}>{item.content}</Text>
          {item.photo_url && (
            <View style={styles.capsulePhotoContainer}>
              <Image
                source={{ uri: item.photo_url }}
                style={{
                  width: '100%',
                  borderRadius: 12,
                  marginTop: 12,
                }}
                resizeMode="cover"
              />
            </View>
          )}
        </View>
        <View style={styles.cardFooter}>
          <Text style={styles.footerText}>
            发送时间：{formatLocalDateTime(item.created_at)}
          </Text>
          <Text style={styles.footerText}>
            解锁时间：{formatLocalDateTime(item.unlock_time)}
          </Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6C5CE7" />
        <Text style={styles.loadingText}>正在加载时光胶囊...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>💌 时光胶囊</Text>
        <Text style={styles.headerSubtitle}>写给未来的信</Text>
        <View style={styles.userBadge}>
          <Text style={styles.userBadgeText}>当前身份: {userId}</Text>
        </View>
      </View>

      {/* Error Banner */}
      {connectionError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>连接中断，下拉刷新重试</Text>
        </View>
      )}

      {/* Capsules List */}
      <ScrollView
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6C5CE7" />
        }
      >
        {capsules.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>还没有时光胶囊</Text>
            <Text style={styles.emptySubText}>点击右下角按钮，给未来写封信吧</Text>
          </View>
        ) : (
          capsules.map((item) => (
            <React.Fragment key={item.id.toString()}>
              {renderItem({ item })}
            </React.Fragment>
          ))
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>✍️</Text>
        <Text style={styles.fabLabel}>写封未来信</Text>
      </TouchableOpacity>

      {/* Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalContainer}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>✍️ 写给未来的信</Text>
                <Pressable onPress={() => setModalVisible(false)}>
                  <Text style={styles.modalClose}>✕</Text>
                </Pressable>
              </View>

              <ScrollView style={styles.modalBody}>
                <Text style={styles.inputLabel}>信件内容</Text>
                <TextInput
                  style={styles.letterInput}
                  value={letterContent}
                  onChangeText={setLetterContent}
                  placeholder="亲爱的未来的我们..."
                  multiline
                  maxLength={2000}
                  textAlignVertical="top"
                />

                <Text style={styles.inputLabel}>解锁时间</Text>
                {Platform.OS === 'web' ? (
                  <View style={styles.dateSelector}>
                    <Text style={styles.dateText2}>📅</Text>
                    <input
                      type="datetime-local"
                      value={toDatetimeLocalString(unlockDate)}
                      onChange={onWebDateChange}
                      min={getMinDatetimeLocal()}
                      style={{
                        flex: 1,
                        marginLeft: 10,
                        fontSize: 15,
                        padding: 8,
                        border: 'none',
                        backgroundColor: 'transparent',
                        color: '#2D3436',
                        fontWeight: '500',
                        outline: 'none',
                        cursor: 'pointer',
                      }}
                    />
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.dateSelector}
                      onPress={Platform.OS === 'android' ? showAndroidDateTimePicker : () => setShowDatePicker(true)}
                    >
                      <Text style={styles.dateText2}>
                        📅 {unlockDate.getFullYear()}/{(unlockDate.getMonth() + 1).toString().padStart(2, '0')}/{unlockDate.getDate().toString().padStart(2, '0')}{' '}
                        {unlockDate.getHours().toString().padStart(2, '0')}:{unlockDate.getMinutes().toString().padStart(2, '0')}
                      </Text>
                      <Text style={styles.changeDateText}>点击修改</Text>
                    </TouchableOpacity>

                    {showDatePicker && RNDateTimePicker && Platform.OS === 'ios' && (
                      <RNDateTimePicker
                        value={unlockDate}
                        mode="datetime"
                        display="spinner"
                        onValueChange={onIOSDateChange}
                        minimumDate={new Date(Date.now() + 60000)}
                      />
                    )}
                  </>
                )}
              </ScrollView>

              {/* Photo Upload */}
              <View style={styles.photoUploadRow}>
                <TouchableOpacity
                  style={styles.photoUploadButton}
                  onPress={handlePickCapsulePhoto}
                  disabled={uploadingPhoto}
                >
                  {uploadingPhoto ? (
                    <ActivityIndicator color="#6C5CE7" size="small" />
                  ) : capsulePhotoUrl ? (
                    <Text style={styles.photoUploadDone}>✅ 附带照片已选择</Text>
                  ) : (
                    <Text style={styles.photoUploadText}>📷 附带一张老照片</Text>
                  )}
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.sealButton, saving && styles.sealButtonDisabled]}
                onPress={sealCapsule}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.sealButtonText}>📮 封存时光胶囊</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Container ──
  container: {
    flex: 1,
    backgroundColor: '#FAF7FF',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF7FF',
  },
  loadingText: {
    marginTop: 12,
    color: '#9B8EC4',
    fontSize: 16,
  },

  // ── Header ──
  header: {
    paddingTop: 20,
    paddingBottom: 18,
    paddingHorizontal: 22,
    backgroundColor: '#1A1128',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#F5E6FF',
    letterSpacing: 1,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#9B8EC4',
    marginTop: 4,
  },
  userBadge: {
    marginTop: 12,
    backgroundColor: 'rgba(180,142,220,0.2)',
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  userBadgeText: {
    color: '#D4B8F0',
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Error ──
  errorBanner: {
    backgroundColor: '#FFF3E0',
    padding: 10,
    alignItems: 'center',
  },
  errorText: {
    color: '#E65100',
    fontSize: 14,
  },

  // ── List ──
  listContent: {
    padding: 18,
    paddingBottom: 100,
  },

  // ── Card (shared) ──
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    marginBottom: 18,
    padding: 24,
    shadowColor: '#B48EDC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },

  // ── Card Locked ──
  cardLocked: {
    alignItems: 'center',
    paddingBottom: 28,
  },
  lockedIconRow: {
    marginBottom: 14,
  },
  lockedIcon: {
    fontSize: 44,
  },
  lockedTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8B5FC7',
    marginBottom: 18,
    letterSpacing: 0.5,
  },
  countdownBox: {
    backgroundColor: '#F3E8FF',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: 'center',
    width: '100%',
    marginBottom: 18,
  },
  countdownLabel: {
    fontSize: 12,
    color: '#A78DC4',
    marginBottom: 8,
    fontWeight: '500',
  },
  countdownText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#8B5FC7',
    letterSpacing: 2,
  },

  // ── Card Ready ──
  cardReady: {
    alignItems: 'center',
    paddingBottom: 28,
    backgroundColor: '#FFFBF0',
  },
  readyIconRow: {
    marginBottom: 14,
  },
  readyIcon: {
    fontSize: 44,
  },
  readyTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#E6A23C',
    marginBottom: 6,
  },
  readySubtitle: {
    fontSize: 15,
    color: '#D4845A',
    fontWeight: '500',
    marginBottom: 18,
  },

  // ── Card Opened ──
  cardOpened: {
    paddingBottom: 28,
  },
  openedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  openedIcon: {
    fontSize: 22,
    marginRight: 8,
  },
  openedTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#7EB89E',
  },
  contentArea: {
    backgroundColor: '#F8F5FF',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
  },
  contentText: {
    fontSize: 15,
    color: '#3D2B5A',
    lineHeight: 24,
  },
  cardFooter: {
    borderTopWidth: 0,
    paddingTop: 12,
    width: '100%',
  },
  footerText: {
    fontSize: 12,
    color: '#B8A6C8',
    marginTop: 3,
  },

  // ── Empty ──
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    color: '#7B6B8A',
    fontWeight: '600',
  },
  emptySubText: {
    fontSize: 14,
    color: '#B8A6C8',
    marginTop: 8,
  },

  // ── FAB ──
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    backgroundColor: '#B48EDC',
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 26,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#B48EDC',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  fabText: {
    fontSize: 18,
    marginRight: 6,
  },
  fabLabel: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },

  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26,17,40,0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
    paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 22,
    borderBottomWidth: 1,
    borderBottomColor: '#F3E8FF',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2D1B4E',
  },
  modalClose: {
    fontSize: 22,
    color: '#B8A6C8',
    padding: 4,
  },
  modalBody: {
    padding: 22,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7B6B8A',
    marginBottom: 8,
    marginTop: 14,
  },
  letterInput: {
    backgroundColor: '#F8F2FF',
    borderRadius: 18,
    padding: 18,
    fontSize: 16,
    minHeight: 180,
    color: '#2D1B4E',
    lineHeight: 24,
    borderWidth: 0,
  },
  dateSelector: {
    backgroundColor: '#F8F2FF',
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateText2: {
    fontSize: 15,
    color: '#3D2B5A',
    fontWeight: '500',
  },
  changeDateText: {
    fontSize: 13,
    color: '#8B5FC7',
    fontWeight: '600',
  },
  sealButton: {
    marginHorizontal: 22,
    marginTop: 18,
    backgroundColor: '#B48EDC',
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#B48EDC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  sealButtonDisabled: {
    backgroundColor: '#C8B6D6',
    shadowOpacity: 0,
  },
  sealButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },

  // ── Photo Upload ──
  photoUploadRow: {
    paddingHorizontal: 22,
    marginTop: 10,
  },
  photoUploadButton: {
    backgroundColor: '#F8F2FF',
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8D8F8',
    borderStyle: 'dashed',
  },
  photoUploadText: {
    fontSize: 14,
    color: '#9B8EC4',
  },
  photoUploadDone: {
    fontSize: 14,
    color: '#7EB89E',
    fontWeight: '600',
  },

  // ── Capsule Photo ──
  capsulePhotoContainer: {
    borderRadius: 16,
    overflow: 'hidden',
  },
});
