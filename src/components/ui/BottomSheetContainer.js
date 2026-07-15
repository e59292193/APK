import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, radius, spacing, shadows } from '../../theme';
import IconButton from './IconButton';
import Button from './Button';

export function BottomSheetContainer({
  visible,
  title,
  onClose,
  children,
  actionLabel,
  onAction,
  loading = false,
  disableAction = false,
  scrollable = true,
  maxHeight = '85%',
  style,
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing[3] }, style]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            {title && <Text style={[typography.sectionTitle, styles.title]}>{title}</Text>}
            <IconButton icon="close" size={22} onPress={onClose} accessibilityLabel="关闭" />
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            <ScrollView
              style={styles.body}
              contentContainerStyle={{ paddingBottom: spacing[4] }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </KeyboardAvoidingView>

          {actionLabel && (
            <View style={styles.footer}>
              <Button
                variant="primary"
                size="large"
                fullWidth
                loading={loading}
                disabled={disableAction}
                onPress={onAction}
              >
                {actionLabel}
              </Button>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing[2],
    paddingHorizontal: spacing[5],
    maxHeight: '85%',
    ...shadows.floating,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.neutral[300],
    alignSelf: 'center',
    marginBottom: spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  title: { color: colors.textPrimary, flex: 1 },
  body: { maxHeight: 400 },
  footer: { paddingTop: spacing[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});

export default BottomSheetContainer;
