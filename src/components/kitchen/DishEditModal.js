import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius, useTheme } from '../../theme';
import { Button, AppInput, IconButton } from '../ui';
import { CachedImage } from '../../lib/imageCache';
import { CATEGORIES, uploadKitchenImage, saveDish, deleteDish } from '../../lib/kitchenUtils';

export function DishEditModal({
  visible,
  dish,
  userId,
  onClose,
  onSaved,
  onDeleted,
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const isEdit = !!dish?.id;
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('meat');
  const [imagePath, setImagePath] = useState('');
  const [recipeText, setRecipeText] = useState('');
  const [recipeImages, setRecipeImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingRecipeImage, setUploadingRecipeImage] = useState(false);

  useEffect(() => {
    if (dish) {
      setTitle(dish.title || '');
      setCategory(dish.category || 'meat');
      setImagePath(dish.image_path || '');
      setRecipeText(dish.recipe_text || '');
      setRecipeImages(Array.isArray(dish.recipe_images) ? dish.recipe_images : []);
    } else {
      setTitle('');
      setCategory('meat');
      setImagePath('');
      setRecipeText('');
      setRecipeImages([]);
    }
  }, [dish, visible]);

  // 从相册选择菜品主图并上传
  const handlePickMainImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('提示', '需要相册权限才能上传菜品图片');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      setUploadingImage(true);
      const uploadedPath = await uploadKitchenImage(result.assets[0].uri);
      setImagePath(uploadedPath);
    } catch (error) {
      console.error('[DishEdit] 图片上传失败:', error);
      Alert.alert('上传失败', error.message || '请检查网络重试');
    } finally {
      setUploadingImage(false);
    }
  };

  // 上传食谱手写步骤图
  const handleAddRecipeImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('提示', '需要相册权限才能上传食谱配图');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      setUploadingRecipeImage(true);
      const uploadedPath = await uploadKitchenImage(result.assets[0].uri);
      setRecipeImages((prev) => [...prev, uploadedPath]);
    } catch (error) {
      console.error('[DishEdit] 食谱图片上传失败:', error);
      Alert.alert('上传失败', error.message || '请重试');
    } finally {
      setUploadingRecipeImage(false);
    }
  };

  const handleRemoveRecipeImage = (index) => {
    setRecipeImages((prev) => prev.filter((_, i) => i !== index));
  };

  // 提交保存
  const handleSubmit = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert('提示', '请输入菜品名称');
      return;
    }
    if (trimmedTitle.length > 20) {
      Alert.alert('提示', '菜品名称请限制在 20 字以内');
      return;
    }
    if (!imagePath) {
      Alert.alert('提示', '请上传一张菜品图片');
      return;
    }

    setSubmitting(true);
    try {
      const dishData = {
        title: trimmedTitle,
        category,
        image_path: imagePath,
        recipe_text: recipeText.trim(),
        recipe_images: recipeImages,
        created_by: dish?.created_by || userId,
      };
      if (dish?.id) {
        dishData.id = dish.id;
      }

      const { data, error } = await saveDish(dishData);
      if (error) throw error;

      if (onSaved) onSaved(data?.[0] || dishData);
      onClose();
    } catch (error) {
      console.error('[DishEdit] 保存菜品失败:', error);
      Alert.alert('保存失败', error.message || '请检查网络');
    } finally {
      setSubmitting(false);
    }
  };

  // 删除菜品
  const handleDelete = () => {
    if (!dish?.id) return;
    Alert.alert('删除菜品', `确定要删除「${dish.title}」吗？此操作不可撤销。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setSubmitting(true);
          try {
            const { error } = await deleteDish(dish.id);
            if (error) throw error;
            if (onDeleted) onDeleted(dish.id);
            onClose();
          } catch (e) {
            console.error('[DishEdit] 删除失败:', e);
            Alert.alert('删除失败', e.message || '请重试');
          } finally {
            setSubmitting(false);
          }
        },
      },
    ]);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* 顶部导航 */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: colors.backgroundLavender,
              borderBottomColor: colors.border,
              paddingTop: insets.top + spacing[2],
            },
          ]}
        >
          <IconButton icon="close" size={24} onPress={onClose} accessibilityLabel="关闭" />
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
            {isEdit ? '编辑菜品' : '上传新菜品'}
          </Text>
          <TouchableOpacity
            style={styles.saveHeaderBtn}
            onPress={handleSubmit}
            disabled={submitting || uploadingImage}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.primaryAction} />
            ) : (
              <Text style={[styles.saveHeaderText, { color: colors.primaryAction }]}>保存</Text>
            )}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: insets.bottom + spacing[6] },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            {/* 菜品主图 */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
                菜品图片 <Text style={{ color: colors.error }}>*</Text>
              </Text>
              <TouchableOpacity
                style={[
                  styles.imagePickerBox,
                  {
                    backgroundColor: colors.surface,
                    borderColor: imagePath ? colors.border : colors.primary[200],
                  },
                ]}
                onPress={handlePickMainImage}
                activeOpacity={0.8}
                disabled={uploadingImage}
              >
                {imagePath ? (
                  <View style={styles.imagePreviewWrap}>
                    <CachedImage
                      source={imagePath}
                      style={styles.imagePreview}
                      contentFit="cover"
                      previewable={false}
                    />
                    <View style={styles.imageChangeOverlay}>
                      <Ionicons name="camera" size={16} color="#FFFFFF" />
                      <Text style={styles.imageChangeText}>点击更换</Text>
                    </View>
                  </View>
                ) : uploadingImage ? (
                  <View style={styles.uploadingBox}>
                    <ActivityIndicator size="large" color={colors.primaryAction} />
                    <Text style={[styles.uploadingText, { color: colors.textSecondary }]}>
                      正在压缩并上传...
                    </Text>
                  </View>
                ) : (
                  <View style={styles.emptyImageBox}>
                    <View style={[styles.cameraIconWrap, { backgroundColor: colors.primary[50] }]}>
                      <Ionicons name="camera-outline" size={32} color={colors.primaryAction} />
                    </View>
                    <Text style={[styles.uploadHint, { color: colors.textSecondary }]}>
                      点击选择或拍摄菜品图片
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* 菜品名称 */}
            <View style={styles.section}>
              <AppInput
                label="菜品名称 *"
                placeholder="例如：可乐鸡翅（20字以内）"
                value={title}
                onChangeText={setTitle}
                maxLength={20}
              />
            </View>

            {/* 所属分类 */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
                所属分类 <Text style={{ color: colors.error }}>*</Text>
              </Text>
              <View style={styles.categoryRow}>
                {CATEGORIES.map((cat) => {
                  const isSelected = category === cat.key;
                  return (
                    <TouchableOpacity
                      key={cat.key}
                      style={[
                        styles.categoryBtn,
                        {
                          backgroundColor: isSelected ? colors.primaryAction : colors.surface,
                          borderColor: isSelected ? colors.primaryAction : colors.border,
                        },
                      ]}
                      onPress={() => setCategory(cat.key)}
                      activeOpacity={0.8}
                    >
                      <Text style={{ fontSize: 16, marginRight: 6 }}>{cat.icon}</Text>
                      <Text
                        style={[
                          styles.categoryBtnText,
                          { color: isSelected ? '#FFFFFF' : colors.textPrimary },
                        ]}
                      >
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* 文字食谱 */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
                文字食谱 (用料与步骤)
              </Text>
              <AppInput
                placeholder="记录这道菜的做法、用料配比或独家秘方~"
                value={recipeText}
                onChangeText={setRecipeText}
                multiline
                numberOfLines={6}
                style={styles.recipeInput}
              />
            </View>

            {/* 图片食谱 */}
            <View style={styles.section}>
              <View style={styles.recipeImageHeader}>
                <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
                  食谱图片 (手写/截图)
                </Text>
                <TouchableOpacity
                  style={[styles.addRecipeImgBtn, { borderColor: colors.primaryAction }]}
                  onPress={handleAddRecipeImage}
                  disabled={uploadingRecipeImage}
                >
                  <Ionicons name="add" size={14} color={colors.primaryAction} />
                  <Text style={[styles.addRecipeImgText, { color: colors.primaryAction }]}>
                    {uploadingRecipeImage ? '上传中...' : '追加图片'}
                  </Text>
                </TouchableOpacity>
              </View>

              {recipeImages.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recipeImgScroll}>
                  {recipeImages.map((imgPath, index) => (
                    <View key={`${imgPath}-${index}`} style={styles.recipeThumbWrap}>
                      <CachedImage
                        source={imgPath}
                        style={styles.recipeThumb}
                        contentFit="cover"
                        previewable={true}
                      />
                      <TouchableOpacity
                        style={styles.removeRecipeImgBtn}
                        onPress={() => handleRemoveRecipeImage(index)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Ionicons name="close-circle" size={20} color="#FF4D4F" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <Text style={[styles.noRecipeImgText, { color: colors.textMuted }]}>
                  暂未上传食谱配图（手写菜谱拍照也很温馨哦）
                </Text>
              )}
            </View>

            {/* 提交按钮 */}
            <Button
              variant="primary"
              size="large"
              fullWidth
              loading={submitting}
              disabled={submitting || uploadingImage}
              onPress={handleSubmit}
              style={{ marginTop: spacing[4] }}
            >
              {isEdit ? '保存修改' : '确认上传'}
            </Button>

            {/* 删除按钮 */}
            {isEdit && (
              <Button
                variant="danger"
                size="large"
                fullWidth
                disabled={submitting}
                onPress={handleDelete}
                style={{ marginTop: spacing[3] }}
              >
                删除菜品
              </Button>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    ...typography.pageTitle,
    fontSize: 17,
  },
  saveHeaderBtn: {
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  saveHeaderText: {
    fontSize: 16,
    fontWeight: '700',
  },
  scrollContent: {
    padding: spacing[4],
  },
  section: {
    marginBottom: spacing[4],
  },
  sectionLabel: {
    ...typography.sectionTitle,
    fontSize: 14,
    marginBottom: spacing[2],
  },
  imagePickerBox: {
    width: '100%',
    height: 190,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyImageBox: {
    alignItems: 'center',
  },
  cameraIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  uploadHint: {
    ...typography.caption,
  },
  uploadingBox: {
    alignItems: 'center',
    gap: 8,
  },
  uploadingText: {
    ...typography.caption,
  },
  imagePreviewWrap: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  imageChangeOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  imageChangeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  categoryRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  categoryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  categoryBtnText: {
    ...typography.bodyMedium,
    fontSize: 14,
  },
  recipeInput: {
    height: 120,
    textAlignVertical: 'top',
  },
  recipeImageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  addRecipeImgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    gap: 3,
  },
  addRecipeImgText: {
    fontSize: 12,
    fontWeight: '600',
  },
  recipeImgScroll: {
    flexDirection: 'row',
  },
  recipeThumbWrap: {
    width: 90,
    height: 90,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginRight: 10,
    position: 'relative',
  },
  recipeThumb: {
    width: '100%',
    height: '100%',
  },
  removeRecipeImgBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  noRecipeImgText: {
    ...typography.caption,
    fontStyle: 'italic',
  },
});

export default DishEditModal;
