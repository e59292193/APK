import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Keyboard,
  BackHandler,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { usePolling } from '../hooks/usePolling';
import { pickAndUploadImage, uploadImages } from '../lib/photoUtils';
import { formatLocalDate, formatLocalTime, formatLocalDateTime } from '../lib/dateUtils';
import { CachedImage } from '../lib/imageCache';
import * as ImagePicker from 'expo-image-picker';
import {
  colors,
  typography,
  spacing,
  radius,
  shadows,
  layout,
} from '../theme';
import {
  AppHeader,
  Card,
  Button,
  AppInput,
  EmptyState,
  LoadingState,
  FloatingActionButton,
  IconButton,
} from '../components/ui';

// ─── Memo style tokens for different users (light lavender identity) ───
// All colors pulled from the theme palette — no hardcoded hex values.
const MEMO_STYLES = {
  me: {
    bg: colors.meSoft,
    border: colors.border,
    accent: colors.me,
    tape: colors.primary[200],
  },
  other: {
    bg: colors.partnerSoft,
    border: colors.border,
    accent: colors.partner,
    tape: colors.mint[200],
  },
};

export default function TravelDiaryScreen({ userId: propUserId }) {
  const userId = propUserId || '';
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState(null);

  // Add trip modal
  const [addTripModalVisible, setAddTripModalVisible] = useState(false);
  const [newTripTitle, setNewTripTitle] = useState('');
  const [newTripLocation, setNewTripLocation] = useState('');
  const [newTripCoverUrl, setNewTripCoverUrl] = useState('');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [savingTrip, setSavingTrip] = useState(false);

  // Entries
  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const flatListRef = useRef(null);

  // ─── Diary Editor Modal ───
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorContent, setEditorContent] = useState('');
  const [editorImages, setEditorImages] = useState([]);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorUploading, setEditorUploading] = useState(false);

  const VALID_USERS = { momo: true, '苞米': true };
  const partnerId = Object.keys(VALID_USERS).find((u) => u !== userId) || '';

  useEffect(() => { fetchTrips(); }, []);

  const fetchTrips = async () => {
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('trips').select('*').order('created_at', { ascending: false }).limit(50)
      );
      if (error) throw error;
      setTrips(data);
    } catch (error) {
      console.error('Error fetching trips:', error);
      Alert.alert('网络有点开小差', '请尝试下拉刷新或稍后再试');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => { setRefreshing(true); fetchTrips(); }, []);

  const handlePickCover = async () => {
    try {
      setUploadingCover(true);
      const url = await pickAndUploadImage({ quality: 0.8 });
      if (url) setNewTripCoverUrl(url);
    } catch (error) {
      Alert.alert('上传失败', error.message || '请重试');
    } finally { setUploadingCover(false); }
  };

  const handleAddTrip = async () => {
    if (!newTripTitle.trim()) { Alert.alert('提示', '请输入旅行标题'); return; }
    setSavingTrip(true);
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('trips').insert([{
          title: newTripTitle.trim(),
          location: newTripLocation.trim() || null,
          cover_url: newTripCoverUrl || null,
        }]).select()
      );
      if (error) throw error;
      if (data && data.length > 0) setTrips((prev) => [data[0], ...prev]);
      setNewTripTitle(''); setNewTripLocation(''); setNewTripCoverUrl('');
      setAddTripModalVisible(false);
    } catch (error) {
      console.error('Error adding trip:', error);
      Alert.alert('错误', '创建旅程失败，请检查网络');
    } finally { setSavingTrip(false); }
  };

  const enterTrip = (trip) => {
    setSelectedTrip(trip);
    setEntries([]);
    setEntriesLoading(true);
    fetchEntries(trip.id);
  };

  const goBack = () => {
    setSelectedTrip(null);
    setEntries([]);
    fetchTrips();
  };

  const fetchEntries = async (tripId) => {
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('trip_entries').select('*').eq('trip_id', tripId).order('created_at', { ascending: true }).limit(100)
      );
      if (error) throw error;
      setEntries(data);
    } catch (error) {
      console.error('Error fetching entries:', error);
    } finally { setEntriesLoading(false); }
  };

  // ─── 选中某次旅行时拉取 entries + 启动 15 秒轮询 ───
  useEffect(() => {
    if (!selectedTrip) return;
    fetchEntries(selectedTrip.id);
  }, [selectedTrip]);
  usePolling(
    () => { if (selectedTrip) fetchEntries(selectedTrip.id); },
    15000,
    { active: !!selectedTrip }
  );

  useEffect(() => {
    const onBackPress = () => {
      if (editorVisible) {
        closeEditor();
        return true;
      }
      if (addTripModalVisible) {
        setAddTripModalVisible(false);
        return true;
      }
      if (selectedTrip) {
        goBack();
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, [editorVisible, addTripModalVisible, selectedTrip]);

  // ─── Diary Editor Logic ───
  const pickEditorImages = async () => {
    if (editorImages.length >= 9) { Alert.alert('提示', '最多9张图片'); return; }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 0.7,
        allowsMultipleSelection: true, selectionLimit: 9 - editorImages.length,
      });
      if (!result.canceled && result.assets) {
        setEditorImages((prev) => [...prev, ...result.assets.map((a) => a.uri)].slice(0, 9));
      }
    } catch (error) { Alert.alert('错误', '选择图片失败'); }
  };

  // uploadDiaryImage removed — using unified compressAndUpload from photoUtils

  const closeEditor = () => {
    Keyboard.dismiss();
    if (Platform.OS !== 'web') {
      setTimeout(() => {
        setEditorVisible(false);
        setEditorContent('');
        setEditorImages([]);
      }, 150);
    } else {
      setEditorVisible(false);
      setEditorContent('');
      setEditorImages([]);
    }
  };

  const insertDiaryEntries = async ({ content = '', imageUris = [] }) => {
    let photoUrls = [];
    if (imageUris.length > 0) {
      setEditorUploading(true);
      photoUrls = await uploadImages(imageUris, { folder: 'trips', quality: 0.7 });
      setEditorUploading(false);
    }

    const rows = [];
    if (content.trim() || photoUrls.length === 0) {
      rows.push({
        trip_id: selectedTrip.id,
        user_id: userId,
        content: content.trim(),
        photo_url: photoUrls[0] || null,
      });
    }

    const startIndex = content.trim() ? 1 : 0;
    photoUrls.slice(startIndex).forEach((url) => {
      rows.push({
        trip_id: selectedTrip.id,
        user_id: userId,
        content: '',
        photo_url: url,
      });
    });

    const { data, error } = await fetchWithTimeout(() =>
      supabase.from('trip_entries').insert(rows).select()
    );
    if (error) throw error;
    if (data && data.length > 0) {
      setEntries((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        return [...prev, ...data.filter((e) => !existingIds.has(e.id))];
      });
    }
  };

  const resetAndCloseEditor = () => {
    Keyboard.dismiss();
    setEditorContent('');
    setEditorImages([]);
    if (Platform.OS !== 'web') {
      setTimeout(() => setEditorVisible(false), 150);
    } else {
      setEditorVisible(false);
    }
  };

  const submitDiary = async () => {
    if (!editorContent.trim() && editorImages.length === 0) {
      Alert.alert('提示', '请输入内容或添加照片');
      return;
    }
    setEditorSaving(true);
    try {
      await insertDiaryEntries({ content: editorContent, imageUris: editorImages });
      resetAndCloseEditor();
    } catch (error) {
      console.error('Error submitting diary:', error);
      Alert.alert('错误', error?.message || '发布失败，请重试');
    } finally { setEditorSaving(false); setEditorUploading(false); }
  };

  const handleSendImagesOnly = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: 9,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      setEditorSaving(true);
      await insertDiaryEntries({ imageUris: result.assets.map((a) => a.uri) });
    } catch (error) {
      console.error('Error sending diary images:', error);
      Alert.alert('错误', error?.message || '发送图片失败，请重试');
    } finally { setEditorSaving(false); setEditorUploading(false); }
  };

  const getAvatarLabel = (uid) => {
    if (uid === 'momo') return 'M';
    if (uid === '苞米') return '苞';
    return '?';
  };

  // ─── Trip Card Renderer ───
  // No more random red/green/blue/orange card colors. Every card uses a white
  // surface with a subtle border and a single primary accent.
  const renderTripCard = ({ item, index }) => {
    return (
      <Card
        variant="interactive"
        onPress={() => enterTrip(item)}
        style={styles.tripCard}
        contentStyle={styles.tripCardContent}
      >
        <View style={styles.tripAccentStripe} />
        {item.cover_url ? (
          <CachedImage source={{ uri: item.cover_url }} style={styles.tripCoverThumb} contentFit="cover" previewable={false} />
        ) : (
          <View style={styles.tripColorThumb}>
            <Ionicons name="airplane" size={22} color={colors.primary[400]} />
          </View>
        )}
        <View style={styles.tripCardBody}>
          <Text style={styles.tripCardTitle} numberOfLines={1}>{item.title}</Text>
          {item.location ? (
            <View style={styles.tripCardLocationRow}>
              <Ionicons name="location-outline" size={12} color={colors.textMuted} />
              <Text style={styles.tripCardLocation} numberOfLines={1}>{item.location}</Text>
            </View>
          ) : null}
          <Text style={styles.tripCardDate}>{formatLocalDate(item.created_at)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.primary[300]} style={styles.tripCardArrow} />
      </Card>
    );
  };

  // ─── Memo Card Renderer ───
  const renderMemo = (item, index) => {
    const isMe = item.user_id === userId;
    const memoStyle = isMe ? MEMO_STYLES.me : MEMO_STYLES.other;
    const alignRight = isMe;

    return (
      <View key={item.id.toString()} style={[styles.memoRow, alignRight ? styles.memoRowRight : styles.memoRowLeft]}>
        {/* Pin icon */}
        <View style={styles.memoPinContainer}>
          <Ionicons name="pin" size={18} color={memoStyle.accent} />
        </View>

        {/* Memo card */}
        <View style={[styles.memoCard, { backgroundColor: memoStyle.bg, borderColor: memoStyle.border }]}>
          {/* Tape decoration */}
          <View style={[styles.memoTape, { backgroundColor: memoStyle.tape }]} />

          {/* Author row */}
          <View style={styles.memoAuthorRow}>
            <View style={[styles.memoAvatar, { backgroundColor: memoStyle.accent }]}>
              <Text style={styles.memoAvatarText}>{isMe ? '我' : getAvatarLabel(item.user_id)}</Text>
            </View>
            <Text style={[styles.memoAuthorName, { color: memoStyle.accent }]}>{isMe ? '我' : item.user_id}</Text>
            <Text style={styles.memoTime}>{formatLocalDateTime(item.created_at)}</Text>
          </View>

          {/* Photo */}
          {item.photo_url && (
            <CachedImage source={{ uri: item.photo_url }} style={styles.memoPhoto} contentFit="cover" />
          )}

          {/* Content */}
          {item.content ? (
            <Text style={styles.memoContent}>{item.content}</Text>
          ) : null}
        </View>
      </View>
    );
  };

  // ─── Detail View ───
  if (selectedTrip) {
    return (
      <View style={styles.detailContainer}>
        {/* Header */}
        <AppHeader
          title={selectedTrip.title}
          subtitle={selectedTrip.location || undefined}
          showBack
          onBack={goBack}
        />

        {/* Memos list */}
        {entriesLoading ? (
          <LoadingState text="加载中..." style={styles.entriesLoadingContainer} />
        ) : (
          <ScrollView
            ref={flatListRef}
            contentContainerStyle={styles.memoListContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => { if (flatListRef.current && entries.length > 0) flatListRef.current.scrollToEnd({ animated: true }); }}
          >
            {entries.length === 0 ? (
              <EmptyState
                icon="book-outline"
                title="还没有旅行记录"
                description="点击下方按钮，写下第一篇旅行手账吧"
                style={styles.entriesEmpty}
              />
            ) : (
              entries.map((item, index) => renderMemo(item, index))
            )}
            <View style={{ height: 120 }} />
          </ScrollView>
        )}

        {/* Floating action buttons */}
        <View style={styles.floatingBar}>
          <Button
            variant="secondary"
            size="medium"
            onPress={handleSendImagesOnly}
            disabled={editorSaving || editorUploading}
            iconLeft={editorUploading ? undefined : 'camera-outline'}
            fullWidth={false}
            style={styles.photoButton}
          >
            {editorUploading ? '上传中...' : '发图片'}
          </Button>
          <Button
            variant="primary"
            size="medium"
            onPress={() => setEditorVisible(true)}
            iconLeft="create-outline"
            style={styles.writeButton}
          >
            写旅行日记
          </Button>
        </View>

        {/* Diary Editor Modal */}
        <Modal
          visible={editorVisible}
          animationType="slide"
          transparent={false}
          statusBarTranslucent={true}
          onRequestClose={closeEditor}
        >
          <KeyboardAvoidingView
            behavior="padding"
            style={styles.editorFullScreen}
          >
            <Pressable style={styles.editorOverlayTouchable} onPress={closeEditor} />
            <View style={styles.editorContainer}>
              <View style={styles.editorHeader}>
                <View style={styles.editorTitleRow}>
                  <Ionicons name="create-outline" size={20} color={colors.primaryAction} style={styles.editorTitleIcon} />
                  <Text style={styles.editorTitle}>写旅行日记</Text>
                </View>
                <IconButton icon="close" size={20} color={colors.textSecondary} onPress={closeEditor} accessibilityLabel="关闭" />
              </View>

              <ScrollView style={styles.editorBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <TextInput
                  style={styles.editorInput}
                  value={editorContent}
                  onChangeText={setEditorContent}
                  placeholder="记录今天的旅行故事..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  maxLength={2000}
                  textAlignVertical="top"
                />
                <Text style={styles.editorCharCount}>{editorContent.length}/2000</Text>

                {/* Image grid */}
                <Text style={styles.editorSectionLabel}>照片 ({editorImages.length}/9)</Text>
                <View style={styles.editorImageGrid}>
                  {editorImages.map((uri, i) => (
                    <View key={i} style={styles.editorImageItem}>
                      <CachedImage source={{ uri }} style={styles.editorImageThumb} contentFit="cover" />
                      <TouchableOpacity style={styles.editorImageRemove} onPress={() => setEditorImages((prev) => prev.filter((_, idx) => idx !== i))}>
                        <Ionicons name="close" size={12} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {editorImages.length < 9 && (
                    <TouchableOpacity style={styles.editorAddImage} onPress={pickEditorImages}>
                      <Ionicons name="add" size={28} color={colors.textMuted} />
                      <Text style={styles.editorAddImageText}>添加</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </ScrollView>

              <View style={styles.editorBottom}>
                <Button
                  variant="primary"
                  size="large"
                  fullWidth
                  loading={editorSaving || editorUploading}
                  disabled={editorSaving || editorUploading || (!editorContent.trim() && editorImages.length === 0)}
                  onPress={submitDiary}
                  iconLeft={(!editorSaving && !editorUploading) ? 'sparkles-outline' : undefined}
                >
                  {editorUploading ? '上传中...' : editorSaving ? '发布中...' : '发布日记'}
                </Button>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    );
  }

  // ─── List View ───
  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingState text="正在加载旅程..." />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader
        title="恋爱足迹"
        subtitle="记录我们的每一段旅程"
      />

      <ScrollView
        contentContainerStyle={styles.tripListContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primaryAction} colors={[colors.primaryAction]} />}
      >
        {trips.length === 0 ? (
          <EmptyState
            icon="airplane-outline"
            title="还没有旅行记录"
            description="点击右下角按钮，记录你们的第一次旅行"
            style={styles.emptyContainer}
          />
        ) : (
          trips.map((item, index) => (
            <React.Fragment key={item.id.toString()}>{renderTripCard({ item, index })}</React.Fragment>
          ))
        )}
      </ScrollView>

      <FloatingActionButton
        icon="add"
        label="新增旅程"
        onPress={() => setAddTripModalVisible(true)}
      />

      {/* Add Trip Modal */}
      <Modal visible={addTripModalVisible} animationType="slide" transparent={false} statusBarTranslucent={true} onRequestClose={() => setAddTripModalVisible(false)}>
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.modalFullScreen}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Ionicons name="airplane-outline" size={20} color={colors.primaryAction} style={styles.modalTitleIcon} />
                <Text style={styles.modalTitle}>新增旅程</Text>
              </View>
              <IconButton icon="close" size={20} color={colors.textSecondary} onPress={() => setAddTripModalVisible(false)} accessibilityLabel="关闭" />
            </View>
            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>旅行标题</Text>
              <TextInput
                style={styles.modalInput}
                value={newTripTitle}
                onChangeText={setNewTripTitle}
                placeholder="例如：大理五日游"
                placeholderTextColor={colors.textMuted}
                maxLength={50}
              />
              <Text style={styles.inputLabel}>地点（可选）</Text>
              <TextInput
                style={styles.modalInput}
                value={newTripLocation}
                onChangeText={setNewTripLocation}
                placeholder="例如：云南大理"
                placeholderTextColor={colors.textMuted}
                maxLength={100}
              />
              <Text style={styles.inputLabel}>封面图（可选）</Text>
              <TouchableOpacity style={styles.coverUploadButton} onPress={handlePickCover} disabled={uploadingCover}>
                {uploadingCover ? (
                  <View style={styles.coverUploadRow}>
                    <ActivityIndicator color={colors.primaryAction} size="small" />
                    <Text style={styles.coverUploadText}>上传中...</Text>
                  </View>
                ) : newTripCoverUrl ? (
                  <View style={styles.coverUploadRow}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                    <Text style={styles.coverUploadDone}>封面图已选择</Text>
                  </View>
                ) : (
                  <View style={styles.coverUploadRow}>
                    <Ionicons name="camera-outline" size={18} color={colors.textSecondary} />
                    <Text style={styles.coverUploadText}>选择封面图</Text>
                  </View>
                )}
              </TouchableOpacity>
            </ScrollView>
            <View style={styles.modalFooter}>
              <Button
                variant="primary"
                size="large"
                fullWidth
                loading={savingTrip}
                disabled={savingTrip}
                onPress={handleAddTrip}
                iconLeft={!savingTrip ? 'sparkles-outline' : undefined}
              >
                {savingTrip ? '创建中...' : '创建旅程'}
              </Button>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  // ── Trip list ──
  tripListContent: { padding: spacing[3], paddingBottom: layout.listBottomPadding },

  tripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing[2],
    padding: 0,
  },
  tripCardContent: { flexDirection: 'row', alignItems: 'center' },
  tripAccentStripe: {
    width: 4,
    alignSelf: 'stretch',
    minHeight: 56,
    backgroundColor: colors.primaryAction,
  },
  tripCoverThumb: { width: 56, height: 56 },
  tripColorThumb: {
    width: 56,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.meSoft,
  },
  tripCardBody: { flex: 1, paddingVertical: spacing[2], paddingHorizontal: spacing[3], minWidth: 0 },
  tripCardTitle: { ...typography.cardTitle, fontSize: 15, color: colors.textPrimary },
  tripCardLocationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  tripCardLocation: { ...typography.caption, color: colors.textMuted, marginLeft: 2, flexShrink: 1 },
  tripCardDate: { ...typography.tabLabel, color: colors.textMuted, marginTop: 2 },
  tripCardArrow: { marginRight: spacing[3], marginLeft: spacing[1] },

  emptyContainer: { marginTop: spacing[12] },

  // ── Modal shared ──
  modalFullScreen: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing[5],
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingBottom: spacing[5],
    ...shadows.medium,
    flexShrink: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center' },
  modalTitleIcon: { marginRight: spacing[2] },
  modalTitle: { ...typography.sectionTitle, color: colors.textPrimary },
  modalBody: { padding: spacing[4], flexShrink: 1 },
  inputLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing[1],
    marginTop: spacing[2],
  },
  modalInput: {
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    padding: spacing[3],
    ...typography.body,
    color: colors.textPrimary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  coverUploadButton: {
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    padding: spacing[4] - 2,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
  },
  coverUploadRow: { flexDirection: 'row', alignItems: 'center' },
  coverUploadText: { ...typography.caption, color: colors.textSecondary, marginLeft: spacing[2] },
  coverUploadDone: { ...typography.caption, color: colors.success, fontWeight: '600', marginLeft: spacing[2] },
  modalFooter: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },

  // ── Detail View ──
  detailContainer: { flex: 1, backgroundColor: colors.background },
  entriesLoadingContainer: { flex: 1 },
  entriesEmpty: { marginTop: spacing[12] },

  // ── Memo Cards ──
  memoListContent: { padding: spacing[3] + 2, paddingBottom: spacing[5] },
  memoRow: { marginBottom: spacing[4], paddingHorizontal: spacing[1] },
  memoRowLeft: { alignItems: 'flex-start' },
  memoRowRight: { alignItems: 'flex-end' },
  memoPinContainer: { marginBottom: -spacing[2], zIndex: 2, marginLeft: spacing[5] },
  memoCard: {
    width: '88%',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingTop: spacing[3] + 2,
    paddingBottom: spacing[3],
    paddingHorizontal: spacing[3] + 2,
    ...shadows.soft,
    overflow: 'hidden',
  },
  memoTape: {
    position: 'absolute',
    top: 0,
    left: '30%',
    right: '30%',
    height: 6,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    opacity: 0.6,
  },
  memoAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing[2] + 2,
    marginTop: 2,
  },
  memoAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing[2],
  },
  memoAvatarText: { color: '#FFFFFF', fontSize: 10, fontWeight: 'bold' },
  memoAuthorName: { ...typography.caption, fontWeight: '700', flex: 1 },
  memoTime: { ...typography.tabLabel, color: colors.textMuted },
  memoPhoto: { width: '100%', height: 180, borderRadius: radius.sm, marginBottom: spacing[2] + 2 },
  memoContent: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },

  // ── Floating Bar (detail view) ──
  floatingBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: spacing[2] + 2,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: Platform.OS === 'ios' ? spacing[8] : spacing[4] + 2,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...shadows.medium,
  },
  photoButton: { flex: 0.9 },
  writeButton: { flex: 1.4 },

  // ── Editor Modal ──
  editorFullScreen: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  editorOverlayTouchable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  editorContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '92%',
    paddingBottom: spacing[6],
    flexShrink: 1,
  },
  editorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  editorTitleRow: { flexDirection: 'row', alignItems: 'center' },
  editorTitleIcon: { marginRight: spacing[2] },
  editorTitle: { ...typography.sectionTitle, color: colors.textPrimary },
  editorBody: { paddingHorizontal: spacing[4], paddingTop: spacing[3], flexShrink: 1 },
  editorInput: {
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    padding: spacing[3] + 2,
    ...typography.body,
    color: colors.textPrimary,
    minHeight: 120,
    lineHeight: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  editorCharCount: {
    ...typography.label,
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: spacing[1],
    marginBottom: spacing[3],
  },
  editorSectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing[2] + 2,
  },
  editorImageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[2] },
  editorImageItem: {
    width: 80,
    height: 80,
    borderRadius: radius.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  editorImageThumb: { width: '100%', height: '100%' },
  editorImageRemove: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  editorAddImage: {
    width: 80,
    height: 80,
    borderRadius: radius.sm,
    backgroundColor: colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
  },
  editorAddImageText: {
    ...typography.label,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  editorBottom: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },
});
