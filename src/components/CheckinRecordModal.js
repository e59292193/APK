import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { uploadImages } from '../lib/photoUtils';
import { CachedImage } from '../lib/imageCache';
import { colors, typography, spacing, radius, shadows } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const MAX_IMAGES = 9;

export default function CheckinRecordModal({ visible, onClose, onSubmit, theme, userId }) {
  const [content, setContent] = useState('');
  const [images, setImages] = useState([]); // stores URI strings only (no base64)
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const pickImage = async () => {
    if (images.length >= MAX_IMAGES) {
      Alert.alert('提示', `最多上传 ${MAX_IMAGES} 张图片`);
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1, // Let our compressor handle quality
        allowsMultipleSelection: true,
        selectionLimit: MAX_IMAGES - images.length,
        // No base64 — avoids memory bloat with large images
      });

      if (!result.canceled && result.assets) {
        const newUris = result.assets.map((a) => a.uri);
        setImages((prev) => [...prev, ...newUris].slice(0, MAX_IMAGES));
      }
    } catch (error) {
      Alert.alert('错误', '选择图片失败');
    }
  };

  const removeImage = (index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!content.trim() && images.length === 0) {
      Alert.alert('提示', '请输入打卡内容或添加图片');
      return;
    }

    setSaving(true);
    try {
      let mediaUrls = [];

      // Upload images using unified pipeline (with compression)
      if (images.length > 0) {
        setUploading(true);
        mediaUrls = await uploadImages(images, { folder: 'checkin', quality: 0.7 });
        setUploading(false);
      }

      await onSubmit({
        content: content.trim(),
        media_urls: mediaUrls,
      });

      Keyboard.dismiss();
      // Reset
      setContent('');
      setImages([]);
      onClose();
    } catch (error) {
      console.error('Error submitting record:', error);
      Alert.alert('错误', '提交失败，请重试');
    } finally {
      setSaving(false);
      setUploading(false);
    }
  };

  const handleClose = () => {
    Keyboard.dismiss();
    setContent('');
    setImages([]);
    onClose();
  };

  const themeIcon = theme?.icon || '✨';
  const themeTitle = theme?.title || '打卡';
  const isSubmitDisabled = !content.trim() && images.length === 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      statusBarTranslucent={true}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.fullScreen}
      >
        <Pressable style={styles.overlayTouchable} onPress={handleClose} />
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.headerIcon}>{themeIcon}</Text>
                <Text style={styles.headerTitle}>记录 {themeTitle}</Text>
              </View>
              <Pressable
                onPress={handleClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.closeBtn}
                accessibilityLabel="关闭"
                accessibilityRole="button"
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={{ flexGrow: 1, paddingBottom: 100 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Text Input */}
              <TextInput
                style={styles.contentInput}
                value={content}
                onChangeText={setContent}
                placeholder="今天打卡想说点什么..."
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={200}
                textAlignVertical="top"
              />
              <Text style={styles.charCount}>{content.length}/200</Text>

              {/* Image Grid */}
              <View style={styles.sectionLabelRow}>
                <Ionicons name="images-outline" size={15} color={colors.textSecondary} />
                <Text style={styles.sectionLabel}>
                  图片 ({images.length}/{MAX_IMAGES})
                </Text>
              </View>
              <View style={styles.imageGrid}>
                {images.map((img, index) => (
                  <View key={index} style={styles.imageItem}>
                    <CachedImage source={{ uri: img }} style={styles.imageThumb} contentFit="cover" />
                    <TouchableOpacity
                      style={styles.imageRemoveBtn}
                      onPress={() => removeImage(index)}
                      accessibilityLabel="删除图片"
                      accessibilityRole="button"
                    >
                      <Ionicons name="close" size={12} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                ))}
                {images.length < MAX_IMAGES && (
                  <TouchableOpacity
                    style={styles.addImageBtn}
                    onPress={pickImage}
                    activeOpacity={0.7}
                    accessibilityLabel="添加图片"
                    accessibilityRole="button"
                  >
                    <Ionicons name="add" size={26} color={colors.textMuted} />
                    <Text style={styles.addImageText}>添加</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>

            {/* Bottom Button */}
            <View style={styles.bottomArea}>
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  isSubmitDisabled && styles.submitButtonDisabled,
                ]}
                onPress={handleSubmit}
                disabled={saving || uploading || isSubmitDisabled}
                activeOpacity={0.8}
              >
                {saving || uploading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text style={[styles.submitButtonText, { marginLeft: spacing[2] }]}>
                      {uploading ? '上传图片中...' : '提交中...'}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.loadingRow}>
                    <Ionicons name="sparkles" size={18} color="#FFFFFF" />
                    <Text style={[styles.submitButtonText, { marginLeft: spacing[2] }]}>完成记录</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
    </Modal>
  );
}

const GRID_COLUMNS = 3;
const GRID_GAP = spacing[2]; // 8
const GRID_PADDING = spacing[4]; // 16
const IMAGE_SIZE = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  overlayTouchable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  container: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '92%',
    paddingBottom: spacing[6],
    flexShrink: 1,
    ...shadows.floating,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    fontSize: 22,
    marginRight: spacing[2],
  },
  headerTitle: {
    ...typography.pageTitle,
    color: colors.textPrimary,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral[100],
  },
  body: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    flexShrink: 1,
  },
  contentInput: {
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    padding: spacing[3],
    ...typography.body,
    color: colors.textPrimary,
    minHeight: 100,
    lineHeight: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  charCount: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: spacing[1],
    marginBottom: spacing[3],
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
    fontWeight: '600',
    marginLeft: spacing[1],
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    marginBottom: spacing[2],
  },
  imageItem: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  imageThumb: {
    width: '100%',
    height: '100%',
  },
  imageRemoveBtn: {
    position: 'absolute',
    top: spacing[1],
    right: spacing[1],
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addImageBtn: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    borderRadius: radius.md,
    backgroundColor: colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  addImageText: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing[1],
  },
  bottomArea: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
  },
  submitButton: {
    backgroundColor: colors.primaryAction,
    borderRadius: radius.md,
    paddingVertical: spacing[5] - 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.floating,
  },
  submitButtonDisabled: {
    backgroundColor: colors.primaryActionDisabled,
    shadowOpacity: 0,
    elevation: 0,
  },
  submitButtonText: {
    color: '#FFFFFF',
    ...typography.bodyMedium,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
