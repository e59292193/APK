// 菜品新增/编辑抽屉：四分类、图片、AI 食谱识别、统一延迟删除
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography, useTheme } from '../../theme';
import { AppInput, CenterToast } from '../ui';
import { CachedImage } from '../../lib/imageCache';
import { CATEGORIES, uploadKitchenImage, saveDish } from '../../lib/kitchenUtils';
import { recognizeRecipeImage } from '../../lib/aiProvider';
import { pickSingleImageUri } from '../../lib/imagePicker';

export function DishEditModal({ visible, dish, userId, onClose, onSaved, onDeleteRequest }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isEdit = Boolean(dish?.id);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('meat');
  const [imagePath, setImagePath] = useState('');
  const [recipeText, setRecipeText] = useState('');
  const [recipeImages, setRecipeImages] = useState([]);
  const [lastLocalImage, setLastLocalImage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingRecipeImage, setUploadingRecipeImage] = useState(false);
  const [aiRecognizing, setAiRecognizing] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const dishCategory = dish?.category === 'vegetable' ? 'veg' : dish?.category;
    setTitle(dish?.title || '');
    setCategory(CATEGORIES.some((item) => item.key === dishCategory) ? dishCategory : 'meat');
    setImagePath(dish?.image_path || '');
    setRecipeText(dish?.recipe_text || '');
    setRecipeImages(Array.isArray(dish?.recipe_images) ? dish.recipe_images : []);
    setLastLocalImage('');
  }, [dish, visible]);

  const pickMainImage = async () => {
    try {
      const uri = await pickSingleImageUri({ allowsEditing: true, quality: 0.9 });
      if (!uri) return;
      setUploadingImage(true);
      const uploaded = await uploadKitchenImage(uri);
      setImagePath(uploaded);
      setLastLocalImage(uri);
      setToast('菜品封面图已就位 📸');
    } catch (error) {
      Alert.alert('上传失败', error.message || '请检查网络后重试');
    } finally {
      setUploadingImage(false);
    }
  };

  const runRecipeOcr = async (uri) => {
    const target = uri || lastLocalImage;
    if (!target) {
      Alert.alert('提示', '请先上传一张本机菜品图或食谱图再识别');
      return;
    }
    setAiRecognizing(true);
    try {
      const result = await recognizeRecipeImage(target);
      if (!result.success || !result.text) {
        Alert.alert('AI 识别提示', result.error || '未识别到有效文字内容');
      } else if (result.text.includes('该图片不包含食谱内容')) {
        setToast('这张图片似乎不是菜谱哦');
      } else {
        setRecipeText((previous) => previous ? `${previous}\n\n${result.text}` : result.text);
        setToast('✨ AI 已提取食谱内容');
      }
    } catch (error) {
      Alert.alert('识别失败', error.message || 'AI 识别遇到问题');
    } finally {
      setAiRecognizing(false);
    }
  };

  const addRecipeImage = async () => {
    try {
      const uri = await pickSingleImageUri({ allowsEditing: false, quality: 0.9 });
      if (!uri) return;
      setUploadingRecipeImage(true);
      const uploaded = await uploadKitchenImage(uri);
      setRecipeImages((previous) => [...previous, uploaded]);
      setLastLocalImage(uri);
      await runRecipeOcr(uri);
    } catch (error) {
      Alert.alert('上传失败', error.message || '请检查网络后重试');
    } finally {
      setUploadingRecipeImage(false);
    }
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return Alert.alert('提示', '请输入菜品名称');
    if (trimmed.length > 20) return Alert.alert('提示', '菜品名称请限制在 20 字以内');
    if (!imagePath) return Alert.alert('提示', '请上传一张菜品图片');

    setSubmitting(true);
    try {
      const saved = await saveDish({
        title: trimmed,
        category: category === 'veg' ? 'vegetable' : category,
        image_path: imagePath,
        recipe_text: recipeText.trim(),
        recipe_images: recipeImages,
      }, dish?.id, userId);
      onSaved?.(saved);
      onClose?.();
    } catch (error) {
      Alert.alert('保存失败', error.message || '请检查网络后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const requestDelete = () => {
    if (!dish?.id || !onDeleteRequest) return;
    Alert.alert('确认删除', `确定要删除「${dish.title}」吗？删除后 5 秒内可以撤销。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          onDeleteRequest(dish.id);
          onClose?.();
        },
      },
    ]);
  };

  return <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.drawer, { height: Math.min(Math.round(height * 0.88), height - 60), paddingBottom: insets.bottom + spacing[3] }]}>
        <View style={styles.header}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            <Text style={styles.headerTitle}>{isEdit ? '编辑菜品' : '添加美味新菜'}</Text>
            <TouchableOpacity onPress={submit} disabled={submitting || uploadingImage} style={styles.headerAction}>
              {submitting ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.headerActionText}>完成</Text>}
            </TouchableOpacity>
          </View>
        </View>

        <CenterToast visible={Boolean(toast)} message={toast} duration={2200} onDismiss={() => setToast('')} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
              <Text style={styles.label}>菜品封面图 <Text style={styles.required}>*</Text></Text>
              <TouchableOpacity style={[styles.imageBox, imagePath ? styles.imageFilled : styles.imageEmpty]} onPress={pickMainImage} disabled={uploadingImage} activeOpacity={0.86}>
                {imagePath ? <View style={styles.flex}>
                  <CachedImage source={imagePath} style={styles.preview} contentFit="cover" previewable={false} />
                  <View style={styles.changeOverlay}><Ionicons name="camera" size={16} color={colors.textOnPrimary} /><Text style={styles.changeText}>点击更换图片</Text></View>
                </View> : uploadingImage ? <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.hint}>正在压缩上传...</Text></View> : <View style={styles.center}>
                  <View style={styles.cameraCircle}><Ionicons name="camera-outline" size={34} color={colors.primary} /></View>
                  <Text style={styles.uploadTitle}>点击上传或拍照封面图</Text><Text style={styles.hint}>支持自由比例裁剪</Text>
                </View>}
              </TouchableOpacity>
            </View>

            <View style={styles.section}><AppInput label="菜品名称 *" placeholder="例如：蜜汁烤鸡翅" value={title} onChangeText={setTitle} maxLength={20} /></View>

            <View style={styles.section}>
              <Text style={styles.label}>所属分类 <Text style={styles.required}>*</Text></Text>
              <View style={styles.categories}>{CATEGORIES.map((item) => {
                const selected = category === item.key;
                return <TouchableOpacity key={item.key} style={[styles.category, selected && styles.categorySelected]} onPress={() => setCategory(item.key)}>
                  <Text style={styles.categoryEmoji}>{item.icon}</Text><Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>{item.label}</Text>
                </TouchableOpacity>;
              })}</View>
            </View>

            <View style={styles.section}>
              <View style={styles.rowBetween}><Text style={styles.label}>秘籍步骤说明</Text><TouchableOpacity style={styles.aiButton} onPress={() => runRecipeOcr()} disabled={aiRecognizing}>
                {aiRecognizing ? <ActivityIndicator size="small" color={colors.textOnPrimary} /> : <><Ionicons name="sparkles" size={14} color={colors.textOnPrimary} /><Text style={styles.aiText}>AI 智能识图</Text></>}
              </TouchableOpacity></View>
              <AppInput placeholder="记录烹饪步骤、调料配比与小秘诀..." value={recipeText} onChangeText={setRecipeText} multiline numberOfLines={6} style={styles.recipeInput} />
            </View>

            <View style={styles.section}>
              <View style={styles.rowBetween}><Text style={styles.label}>食谱附图</Text><TouchableOpacity style={styles.addButton} onPress={addRecipeImage} disabled={uploadingRecipeImage}><Ionicons name="add" size={16} color={colors.primary} /><Text style={styles.addText}>{uploadingRecipeImage ? '上传中...' : '追加配图'}</Text></TouchableOpacity></View>
              {recipeImages.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}>{recipeImages.map((path, index) => <View key={`${path}-${index}`} style={styles.thumbWrap}>
                <CachedImage source={path} style={styles.thumb} contentFit="cover" previewable />
                <TouchableOpacity style={styles.removeButton} onPress={() => setRecipeImages((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}><Ionicons name="close-circle" size={20} color={styles.required.color} /></TouchableOpacity>
              </View>)}</ScrollView> : <Text style={styles.hint}>添加手写菜谱或步骤截图，可自动触发 AI 识别</Text>}
            </View>

            <TouchableOpacity style={styles.saveButton} onPress={submit} disabled={submitting || uploadingImage}>
              {submitting ? <ActivityIndicator size="small" color={colors.textOnPrimary} /> : <Text style={styles.saveText}>{isEdit ? '保存修改' : '确认收录进厨房'}</Text>}
            </TouchableOpacity>
            {isEdit ? <TouchableOpacity style={styles.deleteButton} onPress={requestDelete} disabled={submitting}><Text style={styles.deleteText}>删除这道菜</Text></TouchableOpacity> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </View>
  </Modal>;
}

const createStyles = (c) => {
  const danger = c.danger || c.error || '#D94D55';
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay || 'rgba(0,0,0,0.45)' },
    backdrop: { ...StyleSheet.absoluteFillObject },
    drawer: { width: '100%', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', backgroundColor: c.card, shadowColor: c.shadow, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
    header: { alignItems: 'center', paddingTop: 8, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    handle: { width: 40, height: 4, borderRadius: 2, marginBottom: 8, backgroundColor: c.borderStrong || c.border },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingHorizontal: spacing[4] },
    iconButton: { padding: 4 }, headerAction: { minWidth: 40, alignItems: 'flex-end', padding: 4 },
    headerTitle: { ...typography.cardTitle, fontSize: 17, fontWeight: '700', color: c.text }, headerActionText: { fontSize: 16, fontWeight: '700', color: c.primary },
    flex: { flex: 1 }, content: { padding: spacing[4] }, section: { marginBottom: spacing[4] },
    label: { ...typography.label, fontWeight: '700', color: c.text, marginBottom: spacing[2] }, required: { color: danger },
    imageBox: { height: 180, borderRadius: radius.lg, overflow: 'hidden' }, imageFilled: { borderWidth: 1, borderColor: c.border },
    imageEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.primary, backgroundColor: c.surfaceSoft },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, preview: { width: '100%', height: '100%' },
    changeOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 36, backgroundColor: c.overlay || 'rgba(0,0,0,0.45)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    changeText: { color: c.textOnPrimary, fontSize: 12, fontWeight: '600' }, cameraCircle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySoft, marginBottom: spacing[2] },
    uploadTitle: { ...typography.body, fontWeight: '600', color: c.primary }, hint: { ...typography.caption, color: c.textSecondary, marginTop: 4 },
    categories: { flexDirection: 'row', gap: spacing[2] }, category: { flex: 1, minWidth: 0, minHeight: 42, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, paddingHorizontal: 3 },
    categorySelected: { borderColor: c.primary, backgroundColor: c.primary }, categoryEmoji: { fontSize: 16 }, categoryText: { ...typography.caption, color: c.text, fontWeight: '600' }, categoryTextSelected: { color: c.textOnPrimary },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[2] },
    aiButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: c.primary }, aiText: { color: c.textOnPrimary, fontSize: 12, fontWeight: '700' },
    recipeInput: { minHeight: 110, textAlignVertical: 'top' }, addButton: { flexDirection: 'row', alignItems: 'center', padding: 5 }, addText: { color: c.primary, fontSize: 13, fontWeight: '600' },
    thumbWrap: { position: 'relative', marginRight: 10, marginTop: 4 }, thumb: { width: 80, height: 80, borderRadius: radius.md }, removeButton: { position: 'absolute', top: -6, right: -6, backgroundColor: c.card, borderRadius: 10 },
    saveButton: { minHeight: 48, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', marginTop: spacing[3] }, saveText: { color: c.textOnPrimary, fontSize: 16, fontWeight: '700' },
    deleteButton: { paddingVertical: 14, alignItems: 'center', marginTop: spacing[2] }, deleteText: { color: danger, fontSize: 14, fontWeight: '600' },
  });
};
