import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Keyboard, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { uploadImages } from '../lib/photoUtils';
import { CachedImage } from '../lib/imageCache';
import { typography, spacing, radius, useTheme } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MAX_IMAGES = 9;
const IMAGE_SIZE = (SCREEN_WIDTH - spacing[4] * 2 - spacing[2] * 2) / 3;

export default function CheckinRecordModal({ visible, onClose, onSubmit, theme }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [content, setContent] = useState('');
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const resetAndClose = () => { Keyboard.dismiss(); setContent(''); setImages([]); onClose?.(); };
  const pickImage = async () => {
    if (images.length >= MAX_IMAGES) return Alert.alert('提示', `最多上传 ${MAX_IMAGES} 张图片`);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: true, selectionLimit: MAX_IMAGES - images.length });
      if (!result.canceled && result.assets) setImages((prev) => [...prev, ...result.assets.map((asset) => asset.uri)].slice(0, MAX_IMAGES));
    } catch { Alert.alert('错误', '选择图片失败'); }
  };
  const submit = async () => {
    if (!content.trim() && !images.length) return Alert.alert('提示', '请输入打卡内容或添加图片');
    setSaving(true);
    try {
      let mediaUrls = [];
      if (images.length) { setUploading(true); mediaUrls = await uploadImages(images, { folder: 'checkin', quality: 0.7 }); setUploading(false); }
      await onSubmit?.({ content: content.trim(), media_urls: mediaUrls });
      resetAndClose();
    } catch (error) { console.error('Error submitting record:', error); Alert.alert('错误', '提交失败，请重试'); }
    finally { setSaving(false); setUploading(false); }
  };
  const disabled = !content.trim() && !images.length;

  return <Modal visible={visible} animationType="slide" transparent={false} statusBarTranslucent onRequestClose={resetAndClose}>
    <KeyboardAvoidingView behavior="padding" style={styles.fullScreen}>
      <Pressable style={styles.overlayTouchable} onPress={resetAndClose} />
      <View style={styles.container}>
        <View style={styles.header}><View style={styles.headerLeft}><Text style={styles.headerIcon}>{theme?.icon || '✨'}</Text><Text style={styles.headerTitle}>记录 {theme?.title || '打卡'}</Text></View><Pressable onPress={resetAndClose} hitSlop={8} style={styles.close} accessibilityLabel="关闭"><Ionicons name="close" size={22} color={colors.textSecondary} /></Pressable></View>
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TextInput style={styles.input} value={content} onChangeText={setContent} placeholder="今天打卡想说点什么..." placeholderTextColor={colors.textMuted} multiline maxLength={200} textAlignVertical="top" />
          <Text style={styles.charCount}>{content.length}/200</Text>
          <View style={styles.labelRow}><Ionicons name="images-outline" size={15} color={colors.textSecondary} /><Text style={styles.label}>图片 ({images.length}/{MAX_IMAGES})</Text></View>
          <View style={styles.grid}>
            {images.map((uri, index) => <View key={`${uri}-${index}`} style={styles.imageItem}><CachedImage source={{ uri }} style={styles.image} contentFit="cover" previewable={false} /><TouchableOpacity style={styles.remove} onPress={() => setImages((prev) => prev.filter((_, i) => i !== index))} accessibilityLabel="删除图片"><Ionicons name="close" size={12} color={colors.textOnPrimary} /></TouchableOpacity></View>)}
            {images.length < MAX_IMAGES ? <TouchableOpacity style={styles.add} onPress={pickImage}><Ionicons name="add" size={26} color={colors.textMuted} /><Text style={styles.addText}>添加</Text></TouchableOpacity> : null}
          </View>
        </ScrollView>
        <View style={styles.bottom}><TouchableOpacity style={[styles.submit, disabled && styles.submitDisabled]} onPress={submit} disabled={saving || uploading || disabled}>{saving || uploading ? <View style={styles.loading}><ActivityIndicator color={colors.textOnPrimary} size="small" /><Text style={styles.submitText}>{uploading ? '上传图片中...' : '提交中...'}</Text></View> : <View style={styles.loading}><Ionicons name="sparkles" size={18} color={colors.textOnPrimary} /><Text style={styles.submitText}>完成记录</Text></View>}</TouchableOpacity></View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const createStyles = (c) => StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' }, overlayTouchable: { ...StyleSheet.absoluteFillObject },
  container: { backgroundColor: c.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '92%', paddingBottom: spacing[6], flexShrink: 1, shadowColor: c.shadow, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 18, elevation: 7 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing[4], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }, headerLeft: { flexDirection: 'row', alignItems: 'center' }, headerIcon: { fontSize: 22, marginRight: spacing[2] }, headerTitle: { ...typography.pageTitle, color: c.text }, close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceSoft },
  body: { paddingHorizontal: spacing[4], paddingTop: spacing[3], flexShrink: 1 }, bodyContent: { flexGrow: 1, paddingBottom: 100 }, input: { backgroundColor: c.primarySoft, borderRadius: radius.md, padding: spacing[3], ...typography.body, color: c.text, minHeight: 100, lineHeight: 20, borderWidth: 1, borderColor: c.border }, charCount: { ...typography.caption, color: c.textMuted, textAlign: 'right', marginTop: spacing[1], marginBottom: spacing[3] },
  labelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing[2] }, label: { ...typography.label, color: c.textSecondary, fontWeight: '600', marginLeft: spacing[1] }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[2] }, imageItem: { width: IMAGE_SIZE, height: IMAGE_SIZE, borderRadius: radius.md, overflow: 'hidden', position: 'relative' }, image: { width: '100%', height: '100%' }, remove: { position: 'absolute', top: spacing[1], right: spacing[1], width: 22, height: 22, borderRadius: 11, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center' },
  add: { width: IMAGE_SIZE, height: IMAGE_SIZE, borderRadius: radius.md, backgroundColor: c.surfaceSoft, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: c.border, borderStyle: 'dashed' }, addText: { ...typography.label, color: c.textMuted, marginTop: spacing[1] }, bottom: { paddingHorizontal: spacing[4], paddingTop: spacing[3] }, submit: { backgroundColor: c.primary, borderRadius: radius.md, paddingVertical: spacing[4], alignItems: 'center' }, submitDisabled: { backgroundColor: c.primaryDisabled }, submitText: { color: c.textOnPrimary, ...typography.bodyMedium, fontWeight: '700', marginLeft: spacing[2] }, loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
