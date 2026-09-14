// ═══════════════════════════════════════════════════════
// DishEditModal —— 菜品编辑与录入抽屉 (功能1 & 功能9 UI优化)
// 底部抽屉式设计、虚线图片上传区、AI 智能识别食谱、全宽主题色主按钮
// ═══════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius, shadows, useTheme } from '../../theme';
import { AppInput, CenterToast } from '../ui';
import { CachedImage } from '../../lib/imageCache';
import { CATEGORIES, uploadKitchenImage, saveDish, deleteDish } from '../../lib/kitchenUtils';
import { recognizeRecipeImage } from '../../lib/aiProvider';
import { pickSingleImageUri } from '../../lib/imagePicker';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  const primary = colors.primary || '#FF6B35';
  const cardBg = colors.card || '#FFFFFF';
  const textMain = colors.text || '#2D1B00';
  const textSecondary = colors.textSecondary || '#706879';
  const border = colors.border || '#F0EBE1';
  const background = colors.background || '#FFF8F5';

  const isEdit = !!dish?.id;
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('meat');
  const [imagePath, setImagePath] = useState('');
  const [recipeText, setRecipeText] = useState('');
  const [recipeImages, setRecipeImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingRecipeImage, setUploadingRecipeImage] = useState(false);
  const [aiRecognizing, setAiRecognizing] = useState(false);

  // Toast
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setToastVisible(true);
  };

  useEffect(() => {
    if (dish) {
      setTitle(dish.title || '');
      setCategory(dish.category === 'vegetable' ? 'veg' : (dish.category || 'meat'));
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

  // 从相册选择菜品主图（自由比例裁剪）
  const handlePickMainImage = async () => {
    try {
      const uri = await pickSingleImageUri({ allowsEditing: true, quality: 0.9 });
      if (!uri) return;

      setUploadingImage(true);
      const uploadedPath = await uploadKitchenImage(uri);
      setImagePath(uploadedPath);
      showToast('菜品封面图已就位 📸');
    } catch (error) {
      console.error('[DishEdit] 图片上传失败:', error);
      Alert.alert('上传失败', error.message || '请检查网络重试');
    } finally {
      setUploadingImage(false);
    }
  };

  // 上传食谱手写或步骤图，并可触发 AI 识图
  const handleAddRecipeImage = async () => {
    try {
      const uri = await pickSingleImageUri({ allowsEditing: false, quality: 0.9 });
      if (!uri) return;

      setUploadingRecipeImage(true);
      const uploadedPath = await uploadKitchenImage(uri);
      setRecipeImages((prev) => [...prev, uploadedPath]);

      // 提示或自动调用 AI 识别食谱
      triggerRecipeOcr(uri);
    } catch (error) {
      console.error('[DishEdit] 食谱图片上传失败:', error);
      Alert.alert('上传失败', error.message || '请重试');
    } finally {
      setUploadingRecipeImage(false);
    }
  };

  // AI OCR 识图提取菜谱步骤
  const triggerRecipeOcr = async (imageUri) => {
    const targetUri = imageUri || (recipeImages.length > 0 ? recipeImages[recipeImages.length - 1] : imagePath);
    if (!targetUri) {
      Alert.alert('提示', '请先上传菜品或食谱图片');
      return;
    }

    setAiRecognizing(true);
    try {
      const res = await recognizeRecipeImage(targetUri);
      if (res.success && res.text) {
        if (res.text.includes('该图片不包含食谱内容')) {
          showToast('该图片似乎不是菜谱哦');
        } else {
          setRecipeText((prev) => (prev ? `${prev}\n\n${res.text}` : res.text));
          showToast('✨ AI 已成功提取食谱内容');
        }
      } else {
        Alert.alert('AI 识别提示', res.error || '未识别到有效文字内容');
      }
    } catch (err) {
      Alert.alert('识别失败', err.message || 'AI 识别遇到问题');
    } finally {
      setAiRecognizing(false);
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
        category: category === 'veg' ? 'vegetable' : category,
        image_path: imagePath,
        recipe_text: recipeText.trim(),
        recipe_images: recipeImages,
      };

      const saved = await saveDish(dishData, dish?.id, userId);
      onSaved && onSaved(saved);
      onClose();
    } catch (error) {
      console.error('[DishEdit] 保存菜品失败:', error);
      Alert.alert('保存失败', error.message || '请检查网络重试');
    } finally {
      setSubmitting(false);
    }
  };

  // 删除菜品
  const handleDelete = () => {
    Alert.alert('确认删除', `确定要删除菜品「${dish.title}」吗？删除后不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setSubmitting(true);
          try {
            await deleteDish(dish.id);
            onDeleted && onDeleted(dish.id);
            onClose();
          } catch (err) {
            console.error('[DishEdit] 删除失败:', err);
            Alert.alert('删除失败', '请稍后重试');
          } finally {
            setSubmitting(false);
          }
        },
      },
    ]);
  };

  const drawerHeight = Math.min(Math.round(SCREEN_HEIGHT * 0.88), SCREEN_HEIGHT - 60);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />

        <View
          style={[
            styles.drawerContainer,
            {
              height: drawerHeight,
              backgroundColor: cardBg,
              paddingBottom: insets.bottom + spacing[3],
            },
          ]}
        >
          {/* 抽屉顶部拉手与标题 */}
          <View style={[styles.drawerHeader, { borderBottomColor: border }]}>
            <View style={[styles.dragHandle, { backgroundColor: border }]} />
            <View style={styles.headerRow}>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={24} color={textMain} />
              </TouchableOpacity>
              <Text style={[styles.headerTitle, { color: textMain }]}>{isEdit ? '编辑菜品' : '添加美味新菜'}</Text>
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={submitting || uploadingImage}
                style={styles.headerSaveBtn}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={primary} />
                ) : (
                  <Text style={[styles.headerSaveText, { color: primary }]}>完成</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          <CenterToast
            visible={toastVisible}
            message={toastMessage}
            duration={2200}
            onDismiss={() => setToastVisible(false)}
          />

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardAvoid}
          >
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* 菜品主图上传区 (虚线边框 + 全尺寸预览) */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: textMain }]}>
                  菜品封面图 <Text style={{ color: '#FF4D4F' }}>*</Text>
                </Text>
                <TouchableOpacity
                  style={[
                    styles.imagePickerBox,
                    imagePath
                      ? [styles.imagePickerBoxFilled, { borderColor: border }]
                      : [
                          styles.imagePickerBoxEmpty,
                          {
                            backgroundColor: background,
                            borderColor: primary + '60',
                          },
                        ],
                  ]}
                  onPress={handlePickMainImage}
                  activeOpacity={0.85}
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
                        <Text style={styles.imageChangeText}>点击更换图片</Text>
                      </View>
                    </View>
                  ) : uploadingImage ? (
                    <View style={styles.uploadingBox}>
                      <ActivityIndicator size="large" color={primary} />
                      <Text style={[styles.uploadingText, { color: textSecondary }]}>正在压缩上传图片...</Text>
                    </View>
                  ) : (
                    <View style={styles.emptyImageBox}>
                      <View style={[styles.cameraIconWrap, { backgroundColor: primary + '18' }]}>
                        <Ionicons name="camera-outline" size={34} color={primary} />
                      </View>
                      <Text style={[styles.uploadHint, { color: primary }]}>点击上传或拍照封面图</Text>
                      <Text style={[styles.uploadSubHint, { color: textSecondary }]}>支持自由比例裁剪，清晰呈现美食</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>

              {/* 菜品名称 */}
              <View style={styles.section}>
                <AppInput
                  label="菜品名称 *"
                  placeholder="例如：蜜汁烤鸡翅、番茄牛腩..."
                  value={title}
                  onChangeText={setTitle}
                  maxLength={20}
                />
              </View>

              {/* 所属分类 */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: textMain }]}>
                  所属分类 <Text style={{ color: '#FF4D4F' }}>*</Text>
                </Text>
                <View style={styles.categoryRow}>
                  {CATEGORIES.map((cat) => {
                    const isSelected = category === cat.key || (cat.key === 'veg' && category === 'vegetable');
                    return (
                      <TouchableOpacity
                        key={cat.key}
                        style={[
                          styles.categoryBtn,
                          {
                            borderColor: isSelected ? primary : border,
                            backgroundColor: isSelected ? primary : cardBg,
                          },
                        ]}
                        onPress={() => setCategory(cat.key)}
                        activeOpacity={0.8}
                      >
                        <Text style={{ fontSize: 18, marginRight: 6 }}>{cat.icon}</Text>
                        <Text
                          style={[
                            styles.categoryBtnText,
                            { color: isSelected ? '#FFFFFF' : textMain },
                          ]}
                        >
                          {cat.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* 文字食谱 + AI 识别按钮 */}
              <View style={styles.section}>
                <View style={styles.recipeHeaderRow}>
                  <Text style={[styles.sectionLabel, { color: textMain }]}>秘籍步骤说明</Text>
                  <TouchableOpacity
                    style={[styles.aiOcrBtn, { backgroundColor: primary }]}
                    onPress={() => triggerRecipeOcr()}
                    disabled={aiRecognizing}
                    activeOpacity={0.8}
                  >
                    {aiRecognizing ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons name="sparkles" size={14} color="#FFFFFF" />
                        <Text style={styles.aiOcrBtnText}>AI 智能识图</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
                <AppInput
                  placeholder="记录烹饪步骤、调料配比与小秘诀（支持 AI 从食谱图中直接识别填充）..."
                  value={recipeText}
                  onChangeText={setRecipeText}
                  multiline
                  numberOfLines={6}
                  style={styles.recipeInput}
                />
              </View>

              {/* 食谱多图 (手写/截图) */}
              <View style={styles.section}>
                <View style={styles.recipeHeaderRow}>
                  <Text style={[styles.sectionLabel, { color: textMain }]}>食谱附图 (手写笔记/步骤截图)</Text>
                  <TouchableOpacity
                    style={styles.addStepImgBtn}
                    onPress={handleAddRecipeImage}
                    disabled={uploadingRecipeImage}
                  >
                    <Ionicons name="add" size={16} color={primary} />
                    <Text style={[styles.addStepImgText, { color: primary }]}>
                      {uploadingRecipeImage ? '上传中...' : '追加配图'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {recipeImages.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stepImgScroll}>
                    {recipeImages.map((imgPath, index) => (
                      <View key={`${imgPath}-${index}`} style={styles.stepThumbWrap}>
                        <CachedImage
                          source={imgPath}
                          style={styles.stepThumb}
                          contentFit="cover"
                          previewable={true}
                        />
                        <TouchableOpacity
                          style={styles.removeStepBtn}
                          onPress={() => handleRemoveRecipeImage(index)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Ionicons name="close-circle" size={20} color="#FF4D4F" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={[styles.noStepHint, { color: textSecondary }]}>
                    还未上传食谱配图，添加手写菜谱或烹饪截图可自动触发 AI 识别步骤哦
                  </Text>
                )}
              </View>

              {/* 保存按钮 */}
              <TouchableOpacity
                style={[styles.saveMainBtn, { backgroundColor: primary }]}
                onPress={handleSubmit}
                disabled={submitting || uploadingImage}
                activeOpacity={0.88}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveMainBtnText}>{isEdit ? '保存修改' : '确认收录进厨房'}</Text>
                )}
              </TouchableOpacity>

              {/* 删除菜品 */}
              {isEdit && (
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={handleDelete}
                  disabled={submitting}
                >
                  <Text style={styles.deleteBtnText}>删除这道菜</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  drawerContainer: {
    width: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    ...shadows.soft,
  },
  drawerHeader: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: spacing[4],
  },
  closeBtn: {
    padding: 4,
  },
  headerTitle: {
    ...typography.cardTitle,
    fontSize: 17,
    fontWeight: '700',
  },
  headerSaveBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerSaveText: {
    fontSize: 16,
    fontWeight: '700',
  },
  keyboardAvoid: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing[4],
  },
  section: {
    marginBottom: spacing[4],
  },
  sectionLabel: {
    ...typography.label,
    fontWeight: '700',
    marginBottom: spacing[2],
  },
  imagePickerBox: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    height: 180,
  },
  imagePickerBoxEmpty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePickerBoxFilled: {
    borderWidth: 1,
  },
  emptyImageBox: {
    alignItems: 'center',
  },
  cameraIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  uploadHint: {
    ...typography.body,
    fontWeight: '600',
  },
  uploadSubHint: {
    ...typography.caption,
    marginTop: 4,
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
    bottom: 0,
    left: 0,
    right: 0,
    height: 36,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  imageChangeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  uploadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadingText: {
    ...typography.caption,
    marginTop: spacing[2],
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
  },
  categoryBtnText: {
    ...typography.caption,
    fontWeight: '600',
  },
  recipeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  aiOcrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  aiOcrBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  recipeInput: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  addStepImgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  addStepImgText: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 2,
  },
  stepImgScroll: {
    marginTop: 4,
  },
  stepThumbWrap: {
    position: 'relative',
    marginRight: 10,
  },
  stepThumb: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
  },
  removeStepBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  noStepHint: {
    ...typography.caption,
    lineHeight: 18,
  },
  saveMainBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[3],
    ...shadows.soft,
  },
  saveMainBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  deleteBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing[2],
  },
  deleteBtnText: {
    color: '#FF4D4F',
    fontSize: 14,
    fontWeight: '500',
  },
});
