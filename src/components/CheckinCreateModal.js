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
import { colors, typography, spacing, radius, shadows } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── 预设主题选项 ───
const PRESET_THEMES = [
  { icon: '🍲', label: '好好吃饭' },
  { icon: '🐟', label: '摸鱼打卡' },
  { icon: '🏃', label: '运动打卡' },
  { icon: '📖', label: '学习打卡' },
  { icon: '🧢', label: '今日穿搭' },
  { icon: '🥤', label: '喝水打卡' },
  { icon: '☀️', label: '早起打卡' },
  { icon: '💤', label: '晚安打卡' },
  { icon: '🥰', label: '幸福瞬间' },
];

export default function CheckinCreateModal({ visible, onClose, onCreate, userId, partnerId }) {
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [customTitle, setCustomTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const handlePresetPress = (preset) => {
    setSelectedPreset(preset);
    setCustomTitle('');
  };

  const handleCreate = async () => {
    const themeTitle = customTitle.trim() || (selectedPreset ? selectedPreset.label : '');
    const themeIcon = selectedPreset ? selectedPreset.icon : '✨';

    if (!themeTitle) {
      Alert.alert('提示', '请选择一个预设主题，或输入自定义主题名称');
      return;
    }

    if (themeTitle.length > 10) {
      Alert.alert('提示', '主题名称最多10个字');
      return;
    }

    setSaving(true);
    try {
      // Check for duplicate theme
      const { supabase } = require('../lib/supabase');
      const { data: existing } = await supabase
        .from('checkin_themes')
        .select('id')
        .eq('title', themeTitle)
        .or(`creator_id.eq.${userId},partner_id.eq.${userId}`)
        .limit(1);

      if (existing && existing.length > 0) {
        Alert.alert('提示', '该打卡主题已存在，请勿重复发起！');
        setSaving(false);
        return;
      }

      await onCreate({
        creator_id: userId,
        partner_id: partnerId,
        title: themeTitle,
        icon: themeIcon,
        status: 'pending',
      });
      Keyboard.dismiss();
      // Reset state
      setSelectedPreset(null);
      setCustomTitle('');
      onClose();
    } catch (error) {
      console.error('Error creating checkin theme:', error);
      Alert.alert('错误', '创建失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    Keyboard.dismiss();
    setSelectedPreset(null);
    setCustomTitle('');
    onClose();
  };

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
            <View style={styles.headerTitleRow}>
              <Ionicons name="bookmark-outline" size={22} color={colors.primaryAction} />
              <Text style={styles.headerTitle}>二人打卡</Text>
            </View>
            <Pressable onPress={handleClose} hitSlop={8} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Section: 预设主题 */}
            <Text style={styles.sectionLabel}>选择主题</Text>
            <View style={styles.presetGrid}>
              {PRESET_THEMES.map((preset, index) => {
                const isSelected = selectedPreset?.label === preset.label;
                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.presetItem,
                      isSelected && styles.presetItemSelected,
                    ]}
                    onPress={() => handlePresetPress(preset)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.presetIcon}>{preset.icon}</Text>
                    <Text
                      style={[
                        styles.presetLabel,
                        isSelected && styles.presetLabelSelected,
                      ]}
                    >
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>或自定义</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Section: 自定义主题 */}
            <Text style={styles.sectionLabel}>自定义主题</Text>
            <View style={styles.customInputWrapper}>
              <Ionicons name="create-outline" size={18} color={colors.textMuted} style={styles.customInputIcon} />
              <TextInput
                style={styles.customInput}
                value={customTitle}
                onChangeText={(text) => {
                  setCustomTitle(text);
                  if (text.length > 0) setSelectedPreset(null);
                }}
                placeholder="输入主题名称（最多10字）"
                placeholderTextColor={colors.textMuted}
                maxLength={10}
              />
              <Text style={styles.charCount}>{customTitle.length}/10</Text>
            </View>

            {/* Preview */}
            {(selectedPreset || customTitle.trim()) ? (
              <View style={styles.previewCard}>
                <Text style={styles.previewLabel}>预览</Text>
                <View style={styles.previewContent}>
                  <Text style={styles.previewIcon}>
                    {selectedPreset ? selectedPreset.icon : '✨'}
                  </Text>
                  <Text style={styles.previewTitle}>
                    {customTitle.trim() || (selectedPreset ? selectedPreset.label : '')}
                  </Text>
                </View>
              </View>
            ) : null}
          </ScrollView>

          {/* Bottom Button */}
          <View style={styles.bottomArea}>
            <TouchableOpacity
              style={[
                styles.createButton,
                (!selectedPreset && !customTitle.trim()) && styles.createButtonDisabled,
              ]}
              onPress={handleCreate}
              disabled={saving || (!selectedPreset && !customTitle.trim())}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View style={styles.createButtonContent}>
                  <Ionicons name="sparkles" size={18} color="#FFFFFF" />
                  <Text style={styles.createButtonText}>发起打卡</Text>
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
const GRID_GAP = 10;
const GRID_PADDING = 16;
const ITEM_SIZE = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

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

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  headerTitle: {
    ...typography.pageTitle,
    color: colors.textPrimary,
  },
  closeBtn: {
    padding: spacing[1],
  },

  // ── Body ──
  body: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    flexShrink: 1,
  },
  sectionLabel: {
    ...typography.label,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing[2] + 2,
  },

  // ── Preset Grid (Bento style) ──
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    marginBottom: spacing[4],
  },
  presetItem: {
    width: ITEM_SIZE,
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    paddingVertical: spacing[3] + 2,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  presetItemSelected: {
    backgroundColor: colors.meSoft,
    borderColor: colors.primaryAction,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  presetIcon: {
    fontSize: 26,
    marginBottom: spacing[1] + 2,
  },
  presetLabel: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  presetLabelSelected: {
    color: colors.primary[700],
    fontWeight: '700',
  },

  // ── Divider ──
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing[2],
    marginBottom: spacing[4],
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    ...typography.tabLabel,
    color: colors.textMuted,
    marginHorizontal: spacing[3],
  },

  // ── Custom Input ──
  customInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    paddingHorizontal: spacing[3] + 2,
    paddingVertical: spacing[1],
    marginBottom: spacing[4],
  },
  customInputIcon: {
    marginRight: spacing[2],
  },
  customInput: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing[2] + 2,
  },
  charCount: {
    ...typography.caption,
    color: colors.textMuted,
    marginLeft: spacing[2],
  },

  // ── Preview Card ──
  previewCard: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.md,
    padding: spacing[3] + 2,
    marginBottom: spacing[2],
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginBottom: spacing[2],
    fontWeight: '500',
  },
  previewContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewIcon: {
    fontSize: 24,
    marginRight: spacing[2] + 2,
  },
  previewTitle: {
    ...typography.body,
    fontWeight: 'bold',
    color: colors.primary[700],
  },

  // ── Bottom ──
  bottomArea: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
  },
  createButton: {
    backgroundColor: colors.primaryAction,
    borderRadius: radius.lg,
    paddingVertical: spacing[4] + 3,
    alignItems: 'center',
    shadowColor: colors.primaryAction,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  createButtonDisabled: {
    backgroundColor: colors.primaryActionDisabled,
    shadowOpacity: 0,
  },
  createButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  createButtonText: {
    color: '#FFFFFF',
    ...typography.body,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
});
