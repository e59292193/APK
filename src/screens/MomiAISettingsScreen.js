// ═══════════════════════════════════════════════════════
// MomiAISettingsScreen —— momi AI 配置界面 V2
// DeepSeek V4.1 Flash 默认 / 识图能力提示与实测 / Key 仅本地保存
// ═══════════════════════════════════════════════════════

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius, useTheme } from '../theme';
import { AppHeader, AppInput, Button, CenterToast } from '../components/ui';
import {
  getAIConfig,
  saveAIConfig,
  PROVIDER_OPTIONS,
  DEFAULT_AI_CONFIG,
  getDefaultModel,
  getSuggestedModels,
  getProviderOption,
  modelSupportsVision,
} from '../lib/aiConfig';
import { testAIConnection, testVisionCapability } from '../lib/aiProvider';
import { VISION_TEST_IMAGE_DATA_URL } from '../lib/visionTestImage';

function maskApiKey(key) {
  const value = String(key || '');
  if (!value) return '';
  const last4 = value.slice(-4);
  return `••••••••${last4}`;
}

export default function MomiAISettingsScreen({ onBack }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [provider, setProvider] = useState(DEFAULT_AI_CONFIG.provider);
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState(DEFAULT_AI_CONFIG.modelName);
  const [providersData, setProvidersData] = useState(DEFAULT_AI_CONFIG.providers);
  const [showKey, setShowKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testingVision, setTestingVision] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visionResult, setVisionResult] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setToastVisible(true);
  };

  useEffect(() => {
    let alive = true;
    getAIConfig().then((cfg) => {
      if (!alive) return;
      const current = cfg.provider || DEFAULT_AI_CONFIG.provider;
      setProvider(current);
      setProvidersData(cfg.providers || DEFAULT_AI_CONFIG.providers);
      setApiKey(cfg.apiKey || '');
      setModelName(cfg.modelName || getDefaultModel(current));
    });
    return () => { alive = false; };
  }, []);

  const persistCurrentDraft = () => ({
    ...providersData,
    [provider]: {
      apiKey: apiKey.trim(),
      modelName: modelName.trim() || getDefaultModel(provider),
    },
  });

  const handleSelectProvider = (key) => {
    const updated = persistCurrentDraft();
    setProvidersData(updated);
    setProvider(key);
    const target = updated[key] || { apiKey: '', modelName: getDefaultModel(key) };
    setApiKey(target.apiKey || '');
    setModelName(target.modelName || getDefaultModel(key));
    setShowKey(false);
    setVisionResult('');
  };

  const handleKeyChange = (value) => {
    setApiKey(value);
    setProvidersData((prev) => ({
      ...prev,
      [provider]: { apiKey: value, modelName: modelName || getDefaultModel(provider) },
    }));
  };

  const handleModelChange = (value) => {
    setModelName(value);
    setVisionResult('');
    setProvidersData((prev) => ({
      ...prev,
      [provider]: { apiKey, modelName: value },
    }));
  };

  const activeConfig = () => ({
    provider,
    apiKey: apiKey.trim(),
    modelName: modelName.trim() || getDefaultModel(provider),
  });

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      showToast('请先输入 API Key 才能测试连接哦');
      return;
    }
    setTestingConnection(true);
    try {
      const res = await testAIConnection(activeConfig());
      if (res.success) showToast('🎉 连接成功！momi 已准备就绪');
      else Alert.alert('连接测试失败', `${res.error || '无法连通该 API'}${res.errorCode ? `\n错误码：${res.errorCode}` : ''}`);
    } catch (err) {
      Alert.alert('连接测试失败', err.message || '网络异常');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleTestVision = async () => {
    if (!apiKey.trim()) {
      showToast('请先输入 API Key 才能测试识图哦');
      return;
    }
    setTestingVision(true);
    setVisionResult('');
    try {
      const res = await testVisionCapability(activeConfig());
      if (res.success && res.text.trim()) {
        setVisionResult(res.text.trim());
        showToast(`📷 识图成功${res.usedFallbackModel ? '（使用了临时视觉模型）' : ''}`);
      } else {
        Alert.alert('识图测试失败', `${res.error || '模型没有返回有效描述'}${res.errorCode ? `\n错误码：${res.errorCode}` : ''}`);
      }
    } catch (err) {
      Alert.alert('识图测试失败', err.message || '网络异常');
    } finally {
      setTestingVision(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const active = activeConfig();
      const updated = {
        ...providersData,
        [provider]: { apiKey: active.apiKey, modelName: active.modelName },
      };
      await saveAIConfig({ ...active, providers: updated });
      setProvidersData(updated);
      setShowKey(false);
      showToast('配置已保存到本机 ✨');
      setTimeout(() => onBack?.(), 700);
    } catch (err) {
      Alert.alert('保存失败', err.message || '请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const suggestedModels = getSuggestedModels(provider);
  const currentModel = modelName.trim() || getDefaultModel(provider);
  const visionCapable = modelSupportsVision(provider, currentModel);
  const providerMeta = getProviderOption(provider);
  const anyBusy = testingConnection || testingVision || saving;

  return (
    <View style={styles.container}>
      <AppHeader title="momi AI 配置" subtitle="API Key 只保存在这台手机" showBack onBack={onBack} />
      <CenterToast
        visible={toastVisible}
        message={toastMessage}
        duration={2400}
        onDismiss={() => setToastVisible(false)}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={staticStyles.flex}>
        <ScrollView
          style={staticStyles.flex}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing[8] }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.tipCard}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.success} />
            <Text style={styles.tipText}>
              API Key 仅通过 AsyncStorage 保存在本机，绝不上传 Supabase 或其他服务端。
            </Text>
          </View>

          <Text style={styles.sectionTitle}>选择 AI 服务商</Text>
          <View style={styles.providerRow}>
            {PROVIDER_OPTIONS.map((item) => {
              const active = provider === item.key;
              const hasKey = Boolean(providersData[item.key]?.apiKey);
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.providerTab, active && styles.providerTabActive]}
                  activeOpacity={0.75}
                  onPress={() => handleSelectProvider(item.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.providerTabText, active && styles.providerTabTextActive]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <View style={styles.badgeRow}>
                    {item.recommended ? <Text style={styles.recommendedBadge}>推荐</Text> : null}
                    {hasKey ? <Text style={styles.configuredBadge}>已配置</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.fieldSection}>
            <Text style={styles.fieldLabel}>API Key</Text>
            <View style={styles.keyInputWrap}>
              <TextInput
                style={styles.keyInput}
                placeholder="sk-..."
                placeholderTextColor={colors.textMuted}
                value={showKey ? apiKey : maskApiKey(apiKey)}
                onChangeText={handleKeyChange}
                editable={showKey || !apiKey}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="API Key"
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowKey((v) => !v)}
                accessibilityLabel={showKey ? '隐藏 API Key' : '显示 API Key'}
              >
                <Ionicons name={showKey ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldHint}>
              默认仅显示最后 4 位；点击眼睛后可临时查看与编辑明文。
            </Text>
          </View>

          <View style={styles.fieldSection}>
            <View style={styles.fieldTitleRow}>
              <Text style={styles.fieldLabel}>模型名称 (Model)</Text>
              <View style={[styles.visionBadge, visionCapable ? styles.visionBadgeYes : styles.visionBadgeNo]}>
                <Text style={[styles.visionBadgeText, { color: visionCapable ? colors.success : colors.warning }]}>
                  {visionCapable ? '✓ 支持识图' : '! 不支持识图'}
                </Text>
              </View>
            </View>
            <AppInput
              placeholder={getDefaultModel(provider)}
              value={modelName}
              onChangeText={handleModelChange}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ marginBottom: spacing[2] }}
            />
            {!visionCapable ? (
              <View style={styles.warningCard}>
                <Ionicons name="warning-outline" size={16} color={colors.warning} />
                <Text style={styles.warningText}>
                  此模型不支持识图，momi 将看不到图片。发图时会尝试临时使用 {providerMeta?.visionFallbackModel || '视觉模型'}；无可用模型则明确报错，绝不静默丢图。
                </Text>
              </View>
            ) : null}
            {suggestedModels.length ? (
              <View style={styles.suggestedModelsRow}>
                {suggestedModels.map((m) => {
                  const selected = modelName === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[styles.modelChip, selected && styles.modelChipActive]}
                      onPress={() => handleModelChange(m)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.modelChipText, selected && styles.modelChipTextActive]}>{m}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
            <Text style={styles.fieldHint}>可点快捷标签，也可自由输入服务商实际支持的任意模型名。</Text>
          </View>

          <View style={styles.visionTestCard}>
            <Image source={{ uri: VISION_TEST_IMAGE_DATA_URL }} style={styles.testImage} />
            <View style={styles.visionTestInfo}>
              <Text style={styles.visionTestTitle}>识图测试图</Text>
              <Text style={styles.fieldHint}>模型应能描述为“白底上的红色圆形”。</Text>
              {visionResult ? <Text style={styles.visionResult}>momi：{visionResult}</Text> : null}
            </View>
          </View>

          <View style={styles.actions}>
            <View style={styles.secondaryActions}>
              <TouchableOpacity
                style={[styles.actionButton, anyBusy && styles.actionDisabled]}
                disabled={anyBusy}
                onPress={handleTestConnection}
              >
                {testingConnection ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="pulse-outline" size={19} color={colors.primary} />}
                <Text style={styles.actionButtonText}>测试连接</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, anyBusy && styles.actionDisabled]}
                disabled={anyBusy}
                onPress={handleTestVision}
              >
                {testingVision ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="image-outline" size={19} color={colors.primary} />}
                <Text style={styles.actionButtonText}>测试识图</Text>
              </TouchableOpacity>
            </View>
            <Button
              variant="primary"
              size="large"
              fullWidth
              loading={saving}
              disabled={anyBusy}
              onPress={handleSave}
              iconLeft="checkmark-circle-outline"
            >
              保存配置
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const staticStyles = StyleSheet.create({ flex: { flex: 1 } });

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scrollContent: { padding: spacing[4] },
  tipCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.successSoft,
    padding: spacing[3], borderRadius: radius.md, marginBottom: spacing[5],
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.success,
  },
  tipText: { ...typography.caption, color: c.text, marginLeft: spacing[2], flex: 1, lineHeight: 19 },
  sectionTitle: { ...typography.label, color: c.text, fontWeight: '700', marginBottom: spacing[2] },
  providerRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[5] },
  providerTab: {
    flex: 1, minHeight: 64, backgroundColor: c.card, paddingVertical: spacing[2], paddingHorizontal: 4,
    borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: c.border,
  },
  providerTabActive: { borderColor: c.primary, backgroundColor: c.primarySoft },
  providerTabText: { fontSize: 11, color: c.textSecondary, fontWeight: '500' },
  providerTabTextActive: { color: c.primary, fontWeight: '700' },
  badgeRow: { flexDirection: 'row', gap: 3, marginTop: 5, minHeight: 14 },
  recommendedBadge: { fontSize: 9, color: c.textOnPrimary, backgroundColor: c.primary, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  configuredBadge: { fontSize: 9, color: c.success, backgroundColor: c.successSoft, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  fieldSection: { marginBottom: spacing[5] },
  fieldTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[1] },
  fieldLabel: { ...typography.label, color: c.text, fontWeight: '700', marginBottom: spacing[1] },
  keyInputWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing[3], minHeight: 48,
  },
  keyInput: { flex: 1, paddingVertical: spacing[3], color: c.text, ...typography.body },
  eyeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  fieldHint: { ...typography.caption, color: c.textMuted, marginTop: 4, lineHeight: 18 },
  visionBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  visionBadgeYes: { backgroundColor: c.successSoft },
  visionBadgeNo: { backgroundColor: c.warningSoft },
  visionBadgeText: { fontSize: 11, fontWeight: '700' },
  warningCard: {
    flexDirection: 'row', gap: 7, backgroundColor: c.warningSoft, borderRadius: radius.sm,
    padding: spacing[2], marginBottom: spacing[2], borderWidth: StyleSheet.hairlineWidth, borderColor: c.warning,
  },
  warningText: { flex: 1, fontSize: 11, lineHeight: 17, color: c.text },
  suggestedModelsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[1] },
  modelChip: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  modelChipActive: { backgroundColor: c.primarySoft, borderColor: c.primary },
  modelChipText: { fontSize: 11, color: c.textSecondary },
  modelChipTextActive: { color: c.primary, fontWeight: '700' },
  visionTestCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: radius.lg,
    padding: spacing[3], borderWidth: 1, borderColor: c.border, marginBottom: spacing[4],
  },
  testImage: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: c.surfaceSoft },
  visionTestInfo: { flex: 1, marginLeft: spacing[3] },
  visionTestTitle: { ...typography.cardTitle, color: c.text },
  visionResult: { ...typography.caption, color: c.success, marginTop: 6 },
  actions: { marginTop: spacing[2] },
  secondaryActions: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] },
  actionButton: {
    flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: c.card, borderWidth: 1.5, borderColor: c.primary, borderRadius: radius.md,
  },
  actionButtonText: { ...typography.bodyMedium, color: c.primary },
  actionDisabled: { opacity: 0.5 },
});
