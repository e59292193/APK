import React, { memo, useCallback, useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { saveImageToGallery } from './imageSaver';
import { resolvePhotosUrl } from './mediaResolver';

const DEFAULT_PLACEHOLDER = { blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' };

function CachedImageInner({ style, source, contentFit, placeholder, transition, previewable = true, ...rest }) {
  const rawSource = typeof source === 'string' ? source : source?.uri || source;
  const [imageSource, setImageSource] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true; setImageSource(null);
    if (!rawSource) return undefined;
    resolvePhotosUrl(rawSource).then((url) => { if (alive) setImageSource(url || rawSource); }).catch(() => { if (alive) setImageSource(rawSource); });
    return () => { alive = false; };
  }, [rawSource]);
  const save = useCallback(async () => {
    if (!imageSource) return; setSaving(true);
    try { await saveImageToGallery(imageSource); } catch (error) { console.error('Save failed from preview:', error); }
    finally { setSaving(false); }
  }, [imageSource]);
  const close = useCallback(() => setModalVisible(false), []);
  const renderImage = (imageStyle) => <Image source={imageSource} style={imageStyle} contentFit={contentFit || 'cover'} placeholder={placeholder || DEFAULT_PLACEHOLDER} transition={transition ?? 200} cachePolicy="disk" {...rest} />;
  if (!previewable || !imageSource) return renderImage(style);
  return <>
    <TouchableOpacity activeOpacity={0.9} onPress={() => setModalVisible(true)} style={style}>{renderImage(StyleSheet.absoluteFill)}</TouchableOpacity>
    {modalVisible ? <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.modalBg}><Image source={imageSource} style={styles.modalImage} contentFit="contain" cachePolicy="disk" />
        <TouchableOpacity style={styles.closeBtn} onPress={close}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
        <View style={styles.action}><TouchableOpacity style={[styles.saveBtn, saving && styles.disabled]} onPress={save} disabled={saving}>{saving ? <ActivityIndicator color="#fff" size="small" /> : <><Text style={styles.saveIcon}>📥</Text><Text style={styles.saveText}>保存图片</Text></>}</TouchableOpacity></View>
      </View>
    </Modal> : null}
  </>;
}
export const CachedImage = memo(CachedImageInner);

export function ResolvedImage({ value, ...props }) {
  const [uri, setUri] = useState(null);
  useEffect(() => {
    let alive = true; setUri(null);
    if (!value) return undefined;
    resolvePhotosUrl(value).then((url) => { if (alive) setUri(url || value); }).catch(() => { if (alive) setUri(value); });
    return () => { alive = false; };
  }, [value]);
  return <Image source={uri ? { uri } : null} placeholder={DEFAULT_PLACEHOLDER} {...props} />;
}

const styles = StyleSheet.create({
  modalBg: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }, modalImage: { width: '100%', height: '100%' },
  closeBtn: { position: 'absolute', top: Platform.OS === 'ios' ? 50 : 40, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }, closeText: { color: '#fff', fontSize: 20, fontWeight: '300' },
  action: { position: 'absolute', bottom: Platform.OS === 'ios' ? 50 : 36, left: 0, right: 0, alignItems: 'center' }, saveBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 25 }, disabled: { opacity: 0.7 }, saveIcon: { fontSize: 16, marginRight: 6 }, saveText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
export default CachedImage;
