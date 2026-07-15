/**
 * Unified cached image component using expo-image.
 * Provides automatic disk caching, blur placeholder, fade-in animation,
 * and direct full-screen preview with downloading capabilities.
 *
 * Optimized: React.memo prevents unnecessary re-renders from parent.
 * Modal is lazy-mounted (only when user taps to preview).
 */
import React, { useState, useCallback, memo } from 'react';
import { Image } from 'expo-image';
import { Modal, View, TouchableOpacity, StyleSheet, Text, ActivityIndicator, Platform } from 'react-native';
import { saveImageToGallery } from './imageSaver';

const DEFAULT_BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

function CachedImageInner({ style, source, contentFit, placeholder, transition, previewable = true, ...rest }) {
  const imageSource = typeof source === 'string' ? source : source?.uri || source;

  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!imageSource) return;
    setSaving(true);
    try {
      await saveImageToGallery(imageSource);
    } catch (e) {
      console.error('Save failed from preview:', e);
    } finally {
      setSaving(false);
    }
  }, [imageSource]);

  const handlePress = useCallback(() => {
    if (previewable && imageSource) {
      setModalVisible(true);
    }
  }, [previewable, imageSource]);

  const closePreview = useCallback(() => setModalVisible(false), []);

  // Base image renderer
  const renderBaseImage = (styleProps) => (
    <Image
      source={imageSource}
      style={styleProps}
      contentFit={contentFit || 'cover'}
      placeholder={{ blurhash: DEFAULT_BLURHASH }}
      transition={transition ?? 200}
      cachePolicy="disk"
      {...rest}
    />
  );

  // If preview is disabled or image source is empty, render plain image
  if (!previewable || !imageSource) {
    return renderBaseImage(style);
  }

  return (
    <>
      <TouchableOpacity activeOpacity={0.9} onPress={handlePress} style={style}>
        {renderBaseImage(StyleSheet.absoluteFill)}
      </TouchableOpacity>

      {/* Lazy-mounted Modal: only rendered when user taps to preview */}
      {modalVisible && (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={closePreview}
          statusBarTranslucent={true}
        >
          <View style={styles.modalBg}>
            <Image
              source={imageSource}
              style={styles.modalImage}
              contentFit="contain"
              cachePolicy="disk"
            />

            <TouchableOpacity
              style={styles.closeBtn}
              onPress={closePreview}
              activeOpacity={0.7}
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>

            <View style={styles.actionContainer}>
              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Text style={styles.saveBtnIcon}>📥</Text>
                    <Text style={styles.saveBtnText}>保存图片</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

// Memoize to prevent re-renders when parent re-renders but props haven't changed
export const CachedImage = memo(CachedImageInner);

const styles = StyleSheet.create({
  modalBg: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },
  closeBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  closeText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '300',
  },
  actionContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 50 : 36,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  saveBtnDisabled: {
    opacity: 0.7,
  },
  saveBtnIcon: {
    fontSize: 16,
    color: '#FFFFFF',
    marginRight: 6,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default CachedImage;
