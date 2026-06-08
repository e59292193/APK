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
} from 'react-native';
import { supabase } from '../lib/supabase';
import { pickAndUploadImage } from '../lib/photoUtils';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Only import DateTimePicker on native platforms
let DateTimePicker = null;
if (Platform.OS !== 'web') {
  try {
    DateTimePicker = require('@react-native-community/datetimepicker').default;
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

// ─── Countdown Formatter ───
function getCountdown(unlockTime) {
  const now = Date.now();
  const target = new Date(unlockTime).getTime();
  let diff = target - now;
  if (diff <= 0) return null;

  const days = Math.floor(diff / 86400000);
  diff %= 86400000;
  const hours = Math.floor(diff / 3600000);
  diff %= 3600000;
  const minutes = Math.floor(diff / 60000);
  diff %= 60000;
  const seconds = Math.floor(diff / 1000);

  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  parts.push(`${String(hours).padStart(2, '0')}时`);
  parts.push(`${String(minutes).padStart(2, '0')}分`);
  parts.push(`${String(seconds).padStart(2, '0')}秒`);
  return parts.join(' ');
}

// ─── Date Helpers ───
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
}

function formatDateTime(dateStr) {
  const date = new Date(dateStr);
  return `${formatDate(dateStr)} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
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

  const onDateChange = (event, selectedDate) => {
    setShowDatePicker(false);
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
              由 {isMe ? '我' : item.creator_id} 封存于 {formatDate(item.created_at)}
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
              由 {isMe ? '我' : item.creator_id} 于 {formatDate(item.created_at)} 封存
            </Text>
            <Text style={styles.footerText}>
              原定解锁：{formatDateTime(item.unlock_time)}
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
              <img
                src={item.photo_url}
                alt="capsule photo"
                style={{
                  width: '100%',
                  borderRadius: 12,
                  marginTop: 12,
                }}
              />
            </View>
          )}
        </View>
        <View style={styles.cardFooter}>
          <Text style={styles.footerText}>
            发送时间：{formatDateTime(item.created_at)}
          </Text>
          <Text style={styles.footerText}>
            解锁时间：{formatDateTime(item.unlock_time)}
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
      <FlatList
        data={capsules}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6C5CE7" />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>还没有时光胶囊</Text>
            <Text style={styles.emptySubText}>点击右下角按钮，给未来写封信吧</Text>
          </View>
        }
      />

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
                      onPress={() => setShowDatePicker(true)}
                    >
                      <Text style={styles.dateText2}>
                        📅 {unlockDate.getFullYear()}/{(unlockDate.getMonth() + 1).toString().padStart(2, '0')}/{unlockDate.getDate().toString().padStart(2, '0')}{' '}
                        {unlockDate.getHours().toString().padStart(2, '0')}:{unlockDate.getMinutes().toString().padStart(2, '0')}
                      </Text>
                      <Text style={styles.changeDateText}>点击修改</Text>
                    </TouchableOpacity>

                    {showDatePicker && DateTimePicker && (
                      <DateTimePicker
                        value={unlockDate}
                        mode="datetime"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={onDateChange}
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
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
  },
  loadingText: {
    marginTop: 12,
    color: '#636E72',
    fontSize: 16,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: '#2D3436',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#DFE6E9',
    marginTop: 4,
  },
  userBadge: {
    marginTop: 12,
    backgroundColor: 'rgba(108,92,231,0.3)',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  userBadgeText: {
    color: '#A29BFE',
    fontSize: 12,
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: '#FFEAA7',
    padding: 10,
    alignItems: 'center',
  },
  errorText: {
    color: '#D35400',
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardLocked: {
    borderLeftWidth: 4,
    borderLeftColor: '#6C5CE7',
    alignItems: 'center',
  },
  lockedIconRow: {
    marginBottom: 12,
  },
  lockedIcon: {
    fontSize: 40,
  },
  lockedTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6C5CE7',
    marginBottom: 16,
  },
  countdownBox: {
    backgroundColor: '#F0EDFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  countdownLabel: {
    fontSize: 12,
    color: '#6C5CE7',
    marginBottom: 6,
  },
  countdownText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#6C5CE7',
    letterSpacing: 1,
  },
  cardReady: {
    borderLeftWidth: 4,
    borderLeftColor: '#FDCB6E',
    alignItems: 'center',
    backgroundColor: '#FFFDF5',
  },
  readyIconRow: {
    marginBottom: 12,
  },
  readyIcon: {
    fontSize: 40,
  },
  readyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#F39C12',
    marginBottom: 6,
  },
  readySubtitle: {
    fontSize: 15,
    color: '#E17055',
    fontWeight: '500',
    marginBottom: 16,
  },
  cardOpened: {
    borderLeftWidth: 4,
    borderLeftColor: '#00B894',
  },
  openedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  openedIcon: {
    fontSize: 22,
    marginRight: 8,
  },
  openedTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#00B894',
  },
  contentArea: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
  contentText: {
    fontSize: 15,
    color: '#2D3436',
    lineHeight: 24,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingTop: 12,
    width: '100%',
  },
  footerText: {
    fontSize: 12,
    color: '#B2BEC3',
    marginTop: 2,
  },
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
    color: '#636E72',
    fontWeight: '600',
  },
  emptySubText: {
    fontSize: 14,
    color: '#B2BEC3',
    marginTop: 8,
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    backgroundColor: '#6C5CE7',
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2D3436',
  },
  modalClose: {
    fontSize: 22,
    color: '#636E72',
    padding: 4,
  },
  modalBody: {
    padding: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#636E72',
    marginBottom: 8,
    marginTop: 12,
  },
  letterInput: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    minHeight: 180,
    color: '#2D3436',
    lineHeight: 24,
  },
  dateSelector: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateText2: {
    fontSize: 15,
    color: '#2D3436',
    fontWeight: '500',
  },
  changeDateText: {
    fontSize: 13,
    color: '#6C5CE7',
    fontWeight: '600',
  },
  sealButton: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: '#6C5CE7',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  sealButtonDisabled: {
    backgroundColor: '#A29BFE',
  },
  sealButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
  },
  // ── Photo Upload ──
  photoUploadRow: {
    paddingHorizontal: 20,
    marginTop: 8,
  },
  photoUploadButton: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderStyle: 'dashed',
  },
  photoUploadText: {
    fontSize: 14,
    color: '#636E72',
  },
  photoUploadDone: {
    fontSize: 14,
    color: '#27AE60',
    fontWeight: '600',
  },
  // ── Capsule Photo ──
  capsulePhotoContainer: {
    borderRadius: 12,
    overflow: 'hidden',
  },
});
