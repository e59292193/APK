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
  Image,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { pickAndUploadImage } from '../lib/photoUtils';
import { formatLocalDate, formatLocalTime, formatLocalDateTime } from '../lib/dateUtils';

// ─── Card gradient colors (rotation) ───
const CARD_COLORS = [
  { bg: '#E8DAEF', accent: '#8E44AD' },
  { bg: '#D5F5E3', accent: '#27AE60' },
  { bg: '#D6EAF8', accent: '#2980B9' },
  { bg: '#FDEBD0', accent: '#E67E22' },
  { bg: '#FADBD8', accent: '#E74C3C' },
  { bg: '#D4EFDF', accent: '#1ABC9C' },
];

// ─── Main Component ───
export default function TravelDiaryScreen({ userId: propUserId }) {
  const userId = propUserId || '';
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Navigation state
  const [selectedTrip, setSelectedTrip] = useState(null);

  // Add trip modal
  const [addTripModalVisible, setAddTripModalVisible] = useState(false);
  const [newTripTitle, setNewTripTitle] = useState('');
  const [newTripLocation, setNewTripLocation] = useState('');
  const [newTripCoverUrl, setNewTripCoverUrl] = useState('');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [savingTrip, setSavingTrip] = useState(false);

  // Trip entries state (for detail view)
  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [newEntryContent, setNewEntryContent] = useState('');
  const [sendingEntry, setSendingEntry] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const flatListRef = useRef(null);

  // ─── Init ───
  useEffect(() => {
    fetchTrips();
  }, []);

  // ─── Fetch Trips ───
  const fetchTrips = async () => {
    try {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTrips(data);
    } catch (error) {
      console.error('Error fetching trips:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchTrips();
  }, []);

  // ─── Add Trip ───
  // ─── Upload Cover Photo ───
  const handlePickCover = async () => {
    try {
      setUploadingCover(true);
      const url = await pickAndUploadImage({ quality: 0.8 });
      if (url) {
        setNewTripCoverUrl(url);
      }
    } catch (error) {
      Alert.alert('上传失败', error.message || '请重试');
    } finally {
      setUploadingCover(false);
    }
  };

  // ─── Upload Entry Photo (returns URL) ───
  const handlePickEntryPhoto = async () => {
    try {
      setUploadingPhoto(true);
      const url = await pickAndUploadImage({ quality: 0.7 });
      if (url) {
        // Send immediately with photo
        await sendEntryWithPhoto(url);
      }
    } catch (error) {
      Alert.alert('上传失败', error.message || '请重试');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const sendEntryWithPhoto = async (photoUrl) => {
    setSendingEntry(true);
    try {
      const { data, error } = await supabase.from('trip_entries').insert([
        {
          trip_id: selectedTrip.id,
          user_id: userId,
          content: newEntryContent.trim() || '',
          photo_url: photoUrl,
        },
      ]).select();

      if (error) throw error;
      if (data && data.length > 0) {
        setEntries((prev) => {
          if (prev.some((e) => e.id === data[0].id)) return prev;
          return [...prev, data[0]];
        });
      }
      setNewEntryContent('');
    } catch (error) {
      console.error('Error sending entry:', error);
      Alert.alert('错误', '发送失败，请重试');
    } finally {
      setSendingEntry(false);
    }
  };

  const handleAddTrip = async () => {
    if (!newTripTitle.trim()) {
      Alert.alert('提示', '请输入旅行标题');
      return;
    }

    setSavingTrip(true);
    try {
      const { data, error } = await supabase
        .from('trips')
        .insert([
          {
            title: newTripTitle.trim(),
            location: newTripLocation.trim() || null,
            cover_url: newTripCoverUrl || null,
          },
        ])
        .select();

      if (error) throw error;

      if (data && data.length > 0) {
        setTrips((prev) => [data[0], ...prev]);
      }
      setNewTripTitle('');
      setNewTripLocation('');
      setNewTripCoverUrl('');
      setAddTripModalVisible(false);
    } catch (error) {
      console.error('Error adding trip:', error);
      Alert.alert('错误', '创建旅程失败，请检查网络');
    } finally {
      setSavingTrip(false);
    }
  };

  // ─── Enter Detail ───
  const enterTrip = (trip) => {
    setSelectedTrip(trip);
    setEntries([]);
    setEntriesLoading(true);
    fetchEntries(trip.id);
  };

  // ─── Go Back ───
  const goBack = () => {
    setSelectedTrip(null);
    setEntries([]);
    fetchTrips();
  };

  // ─── Fetch Entries ───
  const fetchEntries = async (tripId) => {
    try {
      const { data, error } = await supabase
        .from('trip_entries')
        .select('*')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setEntries(data);
    } catch (error) {
      console.error('Error fetching entries:', error);
    } finally {
      setEntriesLoading(false);
    }
  };

  // ─── Subscribe to Entries ───
  useEffect(() => {
    if (!selectedTrip) return;

    const tripId = selectedTrip.id;
    const channel = supabase
      .channel(`trip-entries-${tripId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'trip_entries',
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          setEntries((prev) => {
            // Avoid duplicates
            if (prev.some((e) => e.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedTrip]);

  // ─── Send Entry ───
  const sendEntry = async () => {
    if (!newEntryContent.trim()) {
      Alert.alert('提示', '请输入内容');
      return;
    }

    setSendingEntry(true);
    try {
      const { data, error } = await supabase.from('trip_entries').insert([
        {
          trip_id: selectedTrip.id,
          user_id: userId,
          content: newEntryContent.trim(),
        },
      ]).select();

      if (error) throw error;

      // Optimistic update: add the new entry to the list immediately
      if (data && data.length > 0) {
        setEntries((prev) => {
          if (prev.some((e) => e.id === data[0].id)) return prev;
          return [...prev, data[0]];
        });
      }
      setNewEntryContent('');
    } catch (error) {
      console.error('Error sending entry:', error);
      Alert.alert('错误', '发送失败，请重试');
    } finally {
      setSendingEntry(false);
    }
  };

  // ─── Trip Card Renderer ───
  const renderTripCard = ({ item, index }) => {
    const colorSet = CARD_COLORS[index % CARD_COLORS.length];

    return (
      <TouchableOpacity
        style={styles.tripCard}
        onPress={() => enterTrip(item)}
        activeOpacity={0.7}
      >
        {/* Cover image or color background */}
        <View style={styles.tripCardInner}>
          {item.cover_url ? (
            <View style={styles.tripCoverContainer}>
              <Image
                source={{ uri: item.cover_url }}
                style={{
                  width: '100%',
                  height: 120,
                  borderTopLeftRadius: 16,
                  borderTopRightRadius: 16,
                }}
                resizeMode="cover"
              />
              <View style={[styles.tripAccentOverlay, { backgroundColor: colorSet.accent }]} />
            </View>
          ) : (
            <View style={[styles.tripColorHeader, { backgroundColor: colorSet.bg }]}>
              <View style={[styles.tripAccent, { backgroundColor: colorSet.accent }]} />
            </View>
          )}
          <View style={[styles.tripCardBody, !item.cover_url && { backgroundColor: colorSet.bg }]}>
            <Text style={[styles.tripCardTitle, { color: colorSet.accent }]}>
              {item.title}
            </Text>
            {item.location ? (
              <View style={styles.tripCardLocationRow}>
                <Text style={styles.tripCardLocationIcon}>📍</Text>
                <Text style={styles.tripCardLocation}>{item.location}</Text>
              </View>
            ) : null}
            <Text style={styles.tripCardDate}>
              创建于 {formatLocalDate(item.created_at)}
            </Text>
          </View>
        </View>
        <Text style={styles.tripCardArrow}>›</Text>
      </TouchableOpacity>
    );
  };

  // ─── Entry Card Renderer ───
  const renderEntry = ({ item }) => {
    const isMe = item.user_id === userId;

    return (
      <View style={[styles.entryBubble, isMe ? styles.entryBubbleMe : styles.entryBubbleOther]}>
        {!isMe && (
          <View style={styles.entryAvatar}>
            <Text style={styles.entryAvatarText}>{item.user_id}</Text>
          </View>
        )}
          <View style={[styles.entryContentBox, isMe ? styles.entryBoxMe : styles.entryBoxOther]}>
          {!isMe && (
            <Text style={styles.entryUserIdLabel}>{item.user_id}</Text>
          )}
          {item.photo_url && (
            <View style={styles.entryPhotoContainer}>
              <Image
                source={{ uri: item.photo_url }}
                style={{
                  width: '100%',
                  maxWidth: 220,
                  borderRadius: 12,
                  marginBottom: 8,
                }}
                resizeMode="cover"
              />
            </View>
          )}
          {item.content ? <Text style={styles.entryText}>{item.content}</Text> : null}
          <Text style={styles.entryTime}>
            {formatLocalDateTime(item.created_at)}
          </Text>
        </View>
        {isMe && (
          <View style={[styles.entryAvatar, styles.entryAvatarMe]}>
            <Text style={styles.entryAvatarText}>我</Text>
          </View>
        )}
      </View>
    );
  };

  // ─── Detail View ───
  if (selectedTrip) {
    return (
      <View style={styles.detailContainer}>
        {/* Detail Header */}
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={goBack} style={styles.backButton}>
            <Text style={styles.backArrow}>‹</Text>
            <Text style={styles.backText}>返回</Text>
          </TouchableOpacity>
          <View style={styles.detailTitleArea}>
            <Text style={styles.detailTitle} numberOfLines={1}>
              {selectedTrip.title}
            </Text>
            {selectedTrip.location ? (
              <Text style={styles.detailLocation}>📍 {selectedTrip.location}</Text>
            ) : null}
          </View>
        </View>

        {/* Entries List */}
        {entriesLoading ? (
          <View style={styles.entriesLoadingContainer}>
            <ActivityIndicator size="large" color="#6C5CE7" />
            <Text style={styles.entriesLoadingText}>加载中...</Text>
          </View>
        ) : (
          <ScrollView
            ref={flatListRef}
            contentContainerStyle={styles.entriesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              if (flatListRef.current && entries.length > 0) {
                flatListRef.current.scrollToEnd({ animated: true });
              }
            }}
          >
            {entries.length === 0 ? (
              <View style={styles.entriesEmpty}>
                <Text style={styles.entriesEmptyIcon}>📝</Text>
                <Text style={styles.entriesEmptyText}>还没有日记</Text>
                <Text style={styles.entriesEmptySubText}>写下你们旅行中的第一段回忆吧</Text>
              </View>
            ) : (
              entries.map((item) => (
                <React.Fragment key={item.id.toString()}>
                  {renderEntry({ item })}
                </React.Fragment>
              ))
            )}
          </ScrollView>
        )}

        {/* Entry Input */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <View style={styles.entryInputBar}>
            <TouchableOpacity
              style={styles.cameraButton}
              onPress={handlePickEntryPhoto}
              disabled={uploadingPhoto || sendingEntry}
            >
              {uploadingPhoto ? (
                <ActivityIndicator color="#6C5CE7" size="small" />
              ) : (
                <Text style={styles.cameraButtonText}>📷</Text>
              )}
            </TouchableOpacity>
            <TextInput
              style={styles.entryInput}
              value={newEntryContent}
              onChangeText={setNewEntryContent}
              placeholder="记录此刻的感想..."
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[styles.sendButton, !newEntryContent.trim() && styles.sendButtonDisabled]}
              onPress={sendEntry}
              disabled={!newEntryContent.trim() || sendingEntry}
            >
              {sendingEntry ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.sendButtonText}>发送</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // ─── List View ───
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6C5CE7" />
        <Text style={styles.loadingText}>正在加载旅程...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>✈️ 恋爱足迹</Text>
        <Text style={styles.headerSubtitle}>记录我们的每一段旅程</Text>
      </View>

      {/* Trip List */}
      <ScrollView
        contentContainerStyle={styles.tripListContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6C5CE7" />
        }
      >
        {trips.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🌍</Text>
            <Text style={styles.emptyText}>还没有旅行记录</Text>
            <Text style={styles.emptySubText}>点击右下角按钮，记录你们的第一次旅行</Text>
          </View>
        ) : (
          trips.map((item, index) => (
            <React.Fragment key={item.id.toString()}>
              {renderTripCard({ item, index })}
            </React.Fragment>
          ))
        )}
      </ScrollView>

      {/* FAB: Add Trip */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setAddTripModalVisible(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>➕</Text>
        <Text style={styles.fabLabel}>新增旅程</Text>
      </TouchableOpacity>

      {/* Add Trip Modal */}
      <Modal
        visible={addTripModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setAddTripModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🌍 新增旅程</Text>
              <Pressable onPress={() => setAddTripModalVisible(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.inputLabel}>旅行标题</Text>
              <TextInput
                style={styles.modalInput}
                value={newTripTitle}
                onChangeText={setNewTripTitle}
                placeholder="例如：大理五日游"
                maxLength={50}
              />

              <Text style={styles.inputLabel}>地点（可选）</Text>
              <TextInput
                style={styles.modalInput}
                value={newTripLocation}
                onChangeText={setNewTripLocation}
                placeholder="例如：云南大理"
                maxLength={100}
              />

              <Text style={styles.inputLabel}>封面图（可选）</Text>
              <TouchableOpacity
                style={styles.coverUploadButton}
                onPress={handlePickCover}
                disabled={uploadingCover}
              >
                {uploadingCover ? (
                  <ActivityIndicator color="#6C5CE7" size="small" />
                ) : newTripCoverUrl ? (
                  <Text style={styles.coverUploadDone}>✅ 封面图已选择</Text>
                ) : (
                  <Text style={styles.coverUploadText}>📷 选择封面图</Text>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.createButton, savingTrip && styles.createButtonDisabled]}
              onPress={handleAddTrip}
              disabled={savingTrip}
            >
              {savingTrip ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.createButtonText}>✨ 创建旅程</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Common ──
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

  // ── List Header ──
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

  // ── Trip List ──
  tripListContent: {
    padding: 18,
    paddingBottom: 100,
  },
  tripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    marginBottom: 18,
    marginHorizontal: 2,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    shadowColor: '#B48EDC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  tripAccent: {
    width: 0,
    height: '100%',
    minHeight: 80,
  },
  tripCardBody: {
    flex: 1,
    padding: 20,
  },
  tripCardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2D1B4E',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  tripCardLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  tripCardLocationIcon: {
    fontSize: 13,
    marginRight: 4,
  },
  tripCardLocation: {
    fontSize: 13,
    color: '#9B8EC4',
  },
  tripCardDate: {
    fontSize: 11,
    color: '#B8A6C8',
    marginTop: 4,
  },
  tripCardArrow: {
    fontSize: 24,
    color: '#D4B8F0',
    marginRight: 18,
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
    backgroundColor: '#E8A0BF',
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 26,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#E8A0BF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  fabText: {
    fontSize: 18,
    marginRight: 6,
    color: '#fff',
  },
  fabLabel: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },

  // ── Add Trip Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26,17,40,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 28,
    paddingBottom: 28,
    shadowColor: '#B48EDC',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
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
    marginTop: 10,
  },
  modalInput: {
    backgroundColor: '#F8F2FF',
    borderRadius: 18,
    padding: 16,
    fontSize: 16,
    color: '#2D1B4E',
    borderWidth: 0,
  },
  createButton: {
    marginHorizontal: 22,
    marginTop: 10,
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
  createButtonDisabled: {
    backgroundColor: '#C8B6D6',
    shadowOpacity: 0,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },

  // ── Detail View ──
  detailContainer: {
    flex: 1,
    backgroundColor: '#FAF7FF',
  },
  detailHeader: {
    paddingTop: 20,
    paddingBottom: 16,
    paddingHorizontal: 18,
    backgroundColor: '#1A1128',
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 14,
    paddingVertical: 4,
  },
  backArrow: {
    fontSize: 28,
    color: '#F5E6FF',
    fontWeight: '300',
    marginRight: 2,
  },
  backText: {
    fontSize: 15,
    color: '#9B8EC4',
  },
  detailTitleArea: {
    flex: 1,
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#F5E6FF',
  },
  detailLocation: {
    fontSize: 12,
    color: '#9B8EC4',
    marginTop: 2,
  },

  // ── Entries List ──
  entriesList: {
    padding: 16,
    paddingBottom: 100,
  },
  entriesLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  entriesLoadingText: {
    marginTop: 10,
    color: '#9B8EC4',
  },
  entriesEmpty: {
    alignItems: 'center',
    marginTop: 60,
  },
  entriesEmptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  entriesEmptyText: {
    fontSize: 18,
    color: '#7B6B8A',
    fontWeight: '600',
  },
  entriesEmptySubText: {
    fontSize: 14,
    color: '#B8A6C8',
    marginTop: 8,
  },

  // ── Entry Bubbles ──
  entryBubble: {
    flexDirection: 'row',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  entryBubbleMe: {
    justifyContent: 'flex-end',
  },
  entryBubbleOther: {
    justifyContent: 'flex-start',
  },
  entryAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#7EB89E',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
    shadowColor: '#7EB89E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  entryAvatarMe: {
    backgroundColor: '#B48EDC',
    shadowColor: '#B48EDC',
  },
  entryAvatarText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  entryContentBox: {
    maxWidth: '75%',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#B48EDC',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  entryBoxMe: {
    backgroundColor: '#D4B8F0',
    borderTopRightRadius: 6,
    marginLeft: 8,
  },
  entryBoxOther: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 6,
    marginLeft: 8,
  },
  entryUserIdLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7EB89E',
    marginBottom: 4,
  },
  entryText: {
    fontSize: 15,
    color: '#2D1B4E',
    lineHeight: 22,
  },
  entryTime: {
    fontSize: 10,
    color: '#B8A6C8',
    marginTop: 6,
    textAlign: 'right',
  },

  // ── Entry Input Bar ──
  entryInputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderTopWidth: 0,
    shadowColor: '#B48EDC',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  entryInput: {
    flex: 1,
    backgroundColor: '#F8F2FF',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    color: '#2D1B4E',
    borderWidth: 0,
  },
  sendButton: {
    marginLeft: 10,
    backgroundColor: '#B48EDC',
    borderRadius: 22,
    paddingVertical: 10,
    paddingHorizontal: 20,
    justifyContent: 'center',
    shadowColor: '#B48EDC',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  sendButtonDisabled: {
    backgroundColor: '#D4C8E4',
    shadowOpacity: 0,
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  // ── Camera Button ──
  cameraButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  cameraButtonText: {
    fontSize: 20,
  },
  // ── Cover Upload ──
  coverUploadButton: {
    backgroundColor: '#F8F2FF',
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8D8F8',
    borderStyle: 'dashed',
  },
  coverUploadText: {
    fontSize: 15,
    color: '#9B8EC4',
  },
  coverUploadDone: {
    fontSize: 15,
    color: '#7EB89E',
    fontWeight: '600',
  },
  // ── Trip Card with Cover ──
  tripCardInner: {
    flex: 1,
  },
  tripCoverContainer: {
    position: 'relative',
  },
  tripAccentOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  tripColorHeader: {
    flexDirection: 'row',
  },
  // ── Entry Photo ──
  entryPhotoContainer: {
    marginBottom: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
});
