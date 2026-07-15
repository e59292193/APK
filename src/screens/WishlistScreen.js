/**
 * WishlistScreen — Couple's shared wishlist of "big things to do together".
 *
 * Two sub-tabs: "心愿中" (pending) and "已达成" (completed).
 * Features: add/edit/delete wishes, complete wish with celebration animation,
 * random pick, realtime sync between partners.
 *
 * Architecture follows AnniversaryScreen pattern:
 * - fetchWithTimeout on all Supabase queries
 * - Realtime Strategy B (optimistic payload merge for INSERT/UPDATE/DELETE)
 * - FlatList with performance props
 * - Bottom-sheet Modal for add/edit form
 * - AppState foreground reconnect
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  BackHandler,
  Keyboard,
  LayoutAnimation,
  UIManager,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { usePolling } from '../hooks/usePolling';
import { pickAndUploadImage } from '../lib/photoUtils';
import { formatLocalDate } from '../lib/dateUtils';
import { CachedImage } from '../lib/imageCache';
import { colors, typography, spacing, radius, shadows, layout } from '../theme';
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
  IconButton,
} from '../components/ui';
import CelebrationOverlay from '../components/CelebrationOverlay';
import RandomPickModal from '../components/RandomPickModal';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function WishlistScreen({ userId, isActive = true }) {
  const insets = useSafeAreaInsets();

  // ─── State ───
  const [wishes, setWishes] = useState([]);
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'completed'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Add/Edit modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formTitle, setFormTitle] = useState('');
  const [formImage, setFormImage] = useState(null); // local URI before upload, or remote URL
  const [formWhisper, setFormWhisper] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Random pick state
  const [randomVisible, setRandomVisible] = useState(false);
  const [randomItem, setRandomItem] = useState(null);

  // Celebration state
  const [celebrationVisible, setCelebrationVisible] = useState(false);

  // Refs
  const isActiveRef = useRef(false);

  // ─── Derived data ───
  const pendingWishes = useMemo(
    () => wishes.filter(w => w.status === 'pending').sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    ),
    [wishes]
  );

  const completedWishes = useMemo(
    () => wishes.filter(w => w.status === 'completed').sort((a, b) =>
      new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at)
    ),
    [wishes]
  );

  // ─── Fetch ───
  const fetchWishes = useCallback(async () => {
    try {
      const { data, error } = await fetchWithTimeout(() =>
        supabase.from('wishes').select('*').order('created_at', { ascending: false }).limit(100)
      );
      if (error) throw error;
      setWishes(data || []);
    } catch (error) {
      console.error('Error fetching wishes:', error);
      Alert.alert('网络有点开小差', '无法加载愿望清单，下拉刷新重试');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // ─── Mount: fetch + 启动轮询（15 秒）───
  useEffect(() => {
    fetchWishes();
  }, []);
  usePolling(fetchWishes, 15000, { active: isActive });

  // ─── AppState foreground 拉一次兜底 ───
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active') {
        fetchWishes();
      }
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  // ─── Refresh on tab focus ───
  useEffect(() => {
    if (isActive && !isActiveRef.current) {
      fetchWishes();
    }
    isActiveRef.current = isActive;
  }, [isActive]);

  // ─── Android back button ───
  useEffect(() => {
    const onBackPress = () => {
      if (modalVisible) { closeModal(); return true; }
      if (randomVisible) { setRandomVisible(false); return true; }
      return false;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, [modalVisible, randomVisible]);

  // ─── Refresh ───
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchWishes();
  }, [fetchWishes]);

  // ─── Tab switch with animation ───
  const handleTabSwitch = (tab) => {
    if (tab === activeTab) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(tab);
  };

  // ─── Modal helpers ───
  const closeModal = () => {
    Keyboard.dismiss();
    if (Platform.OS !== 'web') {
      setTimeout(() => {
        setModalVisible(false);
        setEditingId(null);
        setFormTitle('');
        setFormImage(null);
        setFormWhisper('');
      }, 150);
    } else {
      setModalVisible(false);
      setEditingId(null);
      setFormTitle('');
      setFormImage(null);
      setFormWhisper('');
    }
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setFormTitle('');
    setFormImage(null);
    setFormWhisper('');
    setModalVisible(true);
  };

  const handleOpenEdit = (item) => {
    setEditingId(item.id);
    setFormTitle(item.title || '');
    setFormImage(item.image_url || null);
    setFormWhisper(item.whisper || '');
    setModalVisible(true);
  };

  // ─── Image picker ───
  const handlePickImage = async () => {
    try {
      setUploading(true);
      const url = await pickAndUploadImage({ quality: 0.6, maxWidth: 1200 });
      if (url) {
        setFormImage(url);
      }
    } catch (e) {
      Alert.alert('图片上传失败', '请重试');
    } finally {
      setUploading(false);
    }
  };

  // ─── Save (add or edit) ───
  const handleSave = async () => {
    if (!formTitle.trim()) {
      Alert.alert('提示', '请输入愿望标题');
      return;
    }
    if (formTitle.length > 30) {
      Alert.alert('提示', '标题不能超过30字');
      return;
    }
    if (formWhisper.length > 50) {
      Alert.alert('提示', '悄悄话不能超过50字');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        // Update existing
        const { error } = await fetchWithTimeout(() =>
          supabase.from('wishes').update({
            title: formTitle.trim(),
            image_url: formImage,
            whisper: formWhisper.trim(),
          }).eq('id', editingId)
        );
        if (error) throw error;
      } else {
        // Insert new
        const { data, error } = await fetchWithTimeout(() =>
          supabase.from('wishes').insert([{
            creator_id: userId,
            title: formTitle.trim(),
            image_url: formImage,
            whisper: formWhisper.trim(),
            status: 'pending',
          }]).select()
        );
        if (error) throw error;
        // Optimistic prepend
        if (data && data.length > 0) {
          setWishes((prev) => [data[0], ...prev]);
        }
      }
      closeModal();
    } catch (error) {
      console.error('Error saving wish:', error);
      Alert.alert('保存失败', '请检查网络后重试');
    } finally {
      setSaving(false);
    }
  };

  // ─── Complete wish ───
  const handleComplete = async (item) => {
    // Show celebration immediately
    setCelebrationVisible(true);

    try {
      const { error } = await fetchWithTimeout(() =>
        supabase.from('wishes').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        }).eq('id', item.id)
      );
      if (error) throw error;
      // Realtime UPDATE will move it from pending to completed
    } catch (error) {
      console.error('Error completing wish:', error);
      // Don't show error alert — celebration already played
      // The optimistic update will be reverted on next fetch
    }
  };

  // ─── Card press: action sheet ───
  const handleCardPress = (item) => {
    Alert.alert(item.title, '选择操作', [
      { text: '✍️ 编辑', onPress: () => handleOpenEdit(item) },
      { text: '🗑️ 删除', style: 'destructive', onPress: () => handleDelete(item) },
      { text: '取消', style: 'cancel' },
    ]);
  };

  // ─── Delete ───
  const handleDelete = (item) => {
    Alert.alert('删除愿望', `确定要删除「${item.title}」吗？此操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '确定删除',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await fetchWithTimeout(() =>
              supabase.from('wishes').delete().eq('id', item.id)
            );
            if (error) throw error;
            // Realtime DELETE will remove from list
          } catch (error) {
            console.error('Error deleting wish:', error);
            Alert.alert('删除失败', '请重试');
          }
        },
      },
    ]);
  };

  // ─── Random pick ───
  const handleRandomPick = () => {
    if (pendingWishes.length === 0) {
      Alert.alert('没有愿望', '愿望都完成啦，去添加新的吧 ✨');
      return;
    }
    const random = pendingWishes[Math.floor(Math.random() * pendingWishes.length)];
    setRandomItem(random);
    setRandomVisible(true);
  };

  const handleReroll = () => {
    if (pendingWishes.length === 0) return;
    let candidates = pendingWishes.filter(w => w.id !== randomItem?.id);
    if (candidates.length === 0) candidates = pendingWishes;
    const random = candidates[Math.floor(Math.random() * candidates.length)];
    setRandomItem(random);
  };

  const handleRandomComplete = (item) => {
    setRandomVisible(false);
    setRandomItem(null);
    // Slight delay for modal close animation
    setTimeout(() => {
      handleComplete(item);
    }, 200);
  };

  // ─── Render wish card ───
  const renderWishCard = useCallback(({ item }) => {
    const isPending = item.status === 'pending';
    const hasImage = !!item.image_url;
    const creatorLabel = item.creator_id === userId ? '我' : 'Ta';

    return (
      <Card
        variant="interactive"
        onPress={() => handleCardPress(item)}
        style={styles.card}
      >
        {hasImage && (
          <View style={styles.mediaWrap}>
            <CachedImage
              source={item.image_url}
              style={styles.media}
              contentFit="cover"
              previewable={false}
            />
          </View>
        )}

        <View style={styles.cardBody}>
          <View style={styles.cardHeaderRow}>
            {!hasImage && (
              <View style={styles.iconTile}>
                <Ionicons name="sparkles" size={20} color={colors.primary[500]} />
              </View>
            )}
            <View style={styles.cardHeaderSpacer} />
            {isPending ? (
              <Badge variant="primary" size="sm">心愿中</Badge>
            ) : (
              <Badge variant="mint" size="sm">已达成</Badge>
            )}
          </View>

          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>

          {item.whisper ? (
            <Text style={styles.cardWhisper} numberOfLines={2}>「{item.whisper}」</Text>
          ) : null}

          <View style={styles.cardMetaRow}>
            <Ionicons name="person-outline" size={12} color={colors.textMuted} />
            <Text style={styles.cardMetaText}>
              {creatorLabel} · {formatLocalDate(item.created_at)}
            </Text>
          </View>

          {isPending ? (
            <View style={styles.cardActionRow}>
              <Button
                variant="ghost"
                size="small"
                iconLeft="checkmark-circle-outline"
                onPress={(e) => {
                  e?.stopPropagation?.();
                  handleComplete(item);
                }}
              >
                点亮星星
              </Button>
            </View>
          ) : item.completed_at ? (
            <View style={styles.cardActionRow}>
              <View style={styles.completedDateWrap}>
                <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                <Text style={styles.completedDate}>
                  完成于 {formatLocalDate(item.completed_at)}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </Card>
    );
  }, []);

  // ─── Loading ───
  if (loading) {
    return (
      <View style={styles.container}>
        <AppHeader
          title="愿望清单"
          subtitle="一起把小小愿望变成回忆"
        />
        <LoadingState text="加载愿望清单中..." style={styles.loadingState} />
      </View>
    );
  }

  const currentList = activeTab === 'pending' ? pendingWishes : completedWishes;

  return (
    <View style={styles.container}>
      {/* ─── Header ─── */}
      <AppHeader
        title="愿望清单"
        subtitle="一起把小小愿望变成回忆"
        rightAction={
          <IconButton
            icon="dice-outline"
            size={22}
            color={colors.primaryAction}
            onPress={handleRandomPick}
            accessibilityLabel="随机抽取"
          />
        }
      />

      {/* ─── Sub-tabs ─── */}
      <SegmentedControl
        segments={[
          { key: 'pending', label: '心愿中', badge: pendingWishes.length },
          { key: 'completed', label: '已达成', badge: completedWishes.length },
        ]}
        selectedIndex={activeTab === 'pending' ? 0 : 1}
        onChange={(i) => handleTabSwitch(i === 0 ? 'pending' : 'completed')}
        style={styles.segmentedControl}
      />

      {/* ─── List ─── */}
      <FlatList
        data={currentList}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderWishCard}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={8}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primaryAction} />
        }
        ListEmptyComponent={
          activeTab === 'pending' ? (
            <EmptyState
              icon="sparkles-outline"
              title="还没有愿望？"
              description="点右下角按钮，写下你们的第一件大事"
              actionLabel="新增愿望"
              onAction={handleOpenAdd}
            />
          ) : (
            <EmptyState
              icon="trophy-outline"
              title="还没有达成的愿望"
              description="一起去完成第一件大事吧，它会变成你们的专属勋章"
            />
          )
        }
      />

      {/* ─── FAB ─── */}
      <Pressable
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + spacing[5] },
          pressed && styles.fabPressed,
        ]}
        onPress={handleOpenAdd}
        android_ripple={{ color: colors.primaryActionPressed, radius: 28 }}
        accessibilityRole="button"
        accessibilityLabel="新增愿望"
      >
        <Ionicons name="sparkles" size={22} color={colors.surface} />
        <Text style={styles.fabLabel}>新增愿望</Text>
      </Pressable>

      {/* ─── Add/Edit Modal (Bottom Sheet) ─── */}
      <BottomSheetContainer
        visible={modalVisible}
        title={editingId ? '编辑愿望' : '写下愿望'}
        onClose={closeModal}
        actionLabel={editingId ? '保存修改' : '写下愿望'}
        onAction={handleSave}
        loading={saving}
        disableAction={!formTitle.trim() || uploading}
        maxHeight="90%"
      >
        {/* Title input */}
        <AppInput
          label="愿望标题"
          placeholder="如：一起去爬华山看日出"
          value={formTitle}
          onChangeText={setFormTitle}
          maxLength={30}
        />

        {/* Image picker */}
        <Text style={[typography.label, styles.fieldLabel]}>配图（选填）</Text>
        <Pressable
          style={styles.imagePickerButton}
          onPress={handlePickImage}
          disabled={uploading}
        >
          {formImage ? (
            <View style={styles.imagePreviewWrapper}>
              <CachedImage
                source={formImage}
                style={styles.imagePreview}
                contentFit="cover"
                previewable={false}
              />
              <Pressable
                style={styles.imageRemoveButton}
                onPress={() => setFormImage(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="移除图片"
              >
                <Ionicons name="close" size={14} color={colors.surface} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.imagePickerPlaceholder}>
              {uploading ? (
                <ActivityIndicator color={colors.primaryAction} size="small" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={26} color={colors.primary[400]} />
                  <Text style={styles.imagePickerText}>选择参考图</Text>
                </>
              )}
            </View>
          )}
        </Pressable>

        {/* Whisper input */}
        <AppInput
          label="悄悄话（选填）"
          placeholder="为什么想和 Ta 做这件事"
          value={formWhisper}
          onChangeText={setFormWhisper}
          maxLength={50}
          multiline
        />
      </BottomSheetContainer>

      {/* ─── Random Pick Modal ─── */}
      <RandomPickModal
        visible={randomVisible}
        item={randomItem}
        onReroll={handleReroll}
        onComplete={handleRandomComplete}
        onClose={() => {
          setRandomVisible(false);
          setRandomItem(null);
        }}
      />

      {/* ─── Celebration Overlay ─── */}
      <CelebrationOverlay
        visible={celebrationVisible}
        onClose={() => setCelebrationVisible(false)}
      />
    </View>
  );
}

// ─── Styles ───
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingState: {
    flex: 1,
  },

  // Segmented control
  segmentedControl: {
    marginHorizontal: spacing[5],
    marginTop: spacing[3],
    marginBottom: spacing[1],
  },

  // List
  listContent: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[2],
  },

  // Wish card
  card: {
    marginBottom: spacing[3],
    padding: 0,
  },
  mediaWrap: {
    width: '100%',
    height: 140,
    overflow: 'hidden',
  },
  media: {
    width: '100%',
    height: '100%',
  },
  cardBody: {
    padding: spacing[4],
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderSpacer: {
    flex: 1,
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: spacing[1],
  },
  cardWhisper: {
    ...typography.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: spacing[2],
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[2],
  },
  cardMetaText: {
    ...typography.label,
    color: colors.textMuted,
    marginLeft: 4,
  },
  cardActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  completedDateWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  completedDate: {
    ...typography.label,
    color: colors.success,
    marginLeft: spacing[1],
  },

  // FAB
  fab: {
    position: 'absolute',
    right: spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    height: layout.fabExtendedHeight,
    borderRadius: layout.fabExtendedHeight / 2,
    paddingHorizontal: spacing[4],
    backgroundColor: colors.primaryAction,
    ...shadows.floating,
    zIndex: 99,
  },
  fabPressed: {
    opacity: 0.88,
  },
  fabLabel: {
    ...typography.bodyMedium,
    color: colors.surface,
    marginLeft: spacing[2],
  },

  // Form fields
  fieldLabel: {
    color: colors.textSecondary,
    marginBottom: spacing[1],
    marginTop: spacing[1],
  },

  // Image picker
  imagePickerButton: {
    marginBottom: spacing[3],
  },
  imagePreviewWrapper: {
    position: 'relative',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  imagePreview: {
    width: '100%',
    height: 160,
    borderRadius: radius.md,
  },
  imageRemoveButton: {
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
  imagePickerPlaceholder: {
    height: 100,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary[200],
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary[50],
  },
  imagePickerText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing[1],
  },
});
