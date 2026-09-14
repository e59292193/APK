// ═══════════════════════════════════════════════════════
// MomiAISettingsScreen —— momi AI 配置界面 (功能10)
// ═══════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, radius } from '../theme';
import { AppHeader, AppInput, Button, CenterToast } from '../components/ui';
import {
  getAIConfig,
  saveAIConfig,
  PROVIDER_OPTIONS,
  getDefaultModel,
  getSuggestedModels,
} from '../lib/aiConfig';
import { testAIConnection } from '../lib/aiProvider';

export default function MomiAISettingsScreen({ onBack }) {
  const insets = useSafeAreaInsets();
  const [provider, setProvider] = useState('glm');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('GLM-5.3-Flash');
  const [providersData, setProvidersData] = useState({
    glm: { apiKey: '', modelName: 'GLM-5.3-Flash' },
    deepseek: { apiKey: '', modelName: 'deepseek-flash' },
    minimax: { apiKey: '', modelName: 'MiniMax M3' },
  });
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Toast
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setToastVisible(true);
  };

  useEffect(() => {
    (async () => {
      const cfg = await getAIConfig();
      const currentProvider = cfg.provider || 'glm';
      setProvider(currentProvider);
      setProvidersData(cfg.providers || {});
      setApiKey(cfg.apiKey || '');
      setModelName(cfg.modelName || getDefaultModel(currentProvider));
    })();
  }, []);

  const handleSelectProvider = (key) => {
    // 1. 先保存当前正在编辑的 provider 内容
    const updated = {
      ...providersData,
      [provider]: {
        apiKey: apiKey.trim(),
        modelName: modelName.trim() || getDefaultModel(provider),
      },
    };
    setProvidersData(updated);

    // 2. 切换到选中的 provider，加载其历史配置或默认推荐
    setProvider(key);
    const targetConfig = updated[key] || {
      apiKey: '',
      modelName: getDefaultModel(key),
    };
    setApiKey(targetConfig.apiKey || '');
    setModelName(targetConfig.modelName || getDefaultModel(key));
  };

  const handleKeyChange = (val) => {
    setApiKey(val);
    setProvidersData((prev) => ({
      ...prev,
      [provider]: {
        apiKey: val,
        modelName: modelName || getDefaultModel(provider),
      },
    }));
  };

  const handleModelChange = (val) => {
    setModelName(val);
    setProvidersData((prev) => ({
      ...prev,
      [provider]: {
        apiKey,
        modelName: val,
      },
    }));
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      showToast('请先输入 API Key 才能测试连接哦');
      return;
    }
    setTesting(true);
    try {
      const res = await testAIConnection({
        provider,
        apiKey: apiKey.trim(),
        modelName: modelName.trim() || getDefaultModel(provider),
      });
      if (res.success) {
        showToast('🎉 连接成功！momi 已准备就绪');
      } else {
        Alert.alert('连接测试失败', res.error || '无法连通该 API，请检查 Key 与模型名称');
      }
    } catch (err) {
      Alert.alert('连接测试失败', err.message || '网络异常');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const activeKey = apiKey.trim();
      const activeModel = modelName.trim() || getDefaultModel(provider);
      const updated = {
        ...providersData,
        [provider]: {
          apiKey: activeKey,
          modelName: activeModel,
        },
      };

      await saveAIConfig({
        provider,
        apiKey: activeKey,
        modelName: activeModel,
        providers: updated,
      });

      showToast('配置已保存到本地 ✨');
      setTimeout(() => {
        if (onBack) onBack();
      }, 700);
    } catch (err) {
      Alert.alert('保存失败', err.message || '请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const suggestedModels = getSuggestedModels(provider);

  return (
    <View style={styles.container}>
      <AppHeader
        title="momi AI 配置"
        subtitle="由您自主提供大模型 API Key"
        showBack
        onBack={onBack}
      />

      <CenterToast
        visible={toastVisible}
        message={toastMessage}
        duration={2200}
        onDismiss={() => setToastVisible(false)}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + spacing[8] },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* 安全提示卡片 */}
          <View style={styles.tipCard}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.mint[700]} />
            <Text style={styles.tipText}>
              隐私安全保护：API Key 仅安全存储在您的手机本地设备中，绝不上送云端服务器。
            </Text>
          </View>

          {/* Provider 选择器 */}
          <Text style={styles.sectionTitle}>选择 AI 服务商</Text>
          <View style={styles.providerRow}>
            {PROVIDER_OPTIONS.map((item) => {
              const active = provider === item.key;
              const hasKey = !!(providersData[item.key]?.apiKey);
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.providerTab, active && styles.providerTabActive]}
                  activeOpacity={0.8}
                  onPress={() => handleSelectProvider(item.key)}
                >
                  <Text style={[styles.providerTabText, active && styles.providerTabTextActive]}>
                    {item.label}
                  </Text>
                  {hasKey && (
                    <Text style={styles.configuredBadge}>已配置</Text>
                  )}
                  {active && <View style={styles.activeDot} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* API Key 输入框 */}
          <View style={styles.fieldSection}>
            <Text style={styles.fieldLabel}>API Key</Text>
            <View style={styles.keyInputWrap}>
              <TextInput
                style={styles.keyInput}
                placeholder="sk-..."
                placeholderTextColor={colors.textMuted}
                value={apiKey}
                onChangeText={handleKeyChange}
                secureTextEntry={!showKey}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowKey(!showKey)}
                accessibilityLabel="切换显示密码"
                activeOpacity={0.7}
              >
                <Ionicons
                  name={showKey ? 'eye-outline' : 'eye-off-outline'}
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldHint}>可在对应 AI 服务商开发者控制台中获取 Key（每个厂商独立存储）</Text>
          </View>

          {/* 模型名称输入框 */}
          <View style={styles.fieldSection}>
            <Text style={styles.fieldLabel}>模型名称 (Model)</Text>
            <AppInput
              placeholder={getDefaultModel(provider)}
              value={modelName}
              onChangeText={handleModelChange}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ marginBottom: spacing[2] }}
            />
            {suggestedModels.length > 0 && (
              <View style={styles.suggestedModelsRow}>
                <Text style={styles.suggestedLabel}>推荐模型：</Text>
                {suggestedModels.map((m) => {
                  const isSelected = modelName === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[styles.modelChip, isSelected && styles.modelChipActive]}
                      onPress={() => handleModelChange(m)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.modelChipText, isSelected && styles.modelChipTextActive]}>
                        {m}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <Text style={styles.fieldHint}>
              点击上方快捷标签可一键选用，也可手动输入任意兼容模型名
            </Text>
          </View>

          {/* 操作按钮组 */}
          <View style={styles.actions}>
            <Button
              variant="outline"
              size="large"
              fullWidth
              loading={testing}
              disabled={testing || saving}
              onPress={handleTestConnection}
              iconLeft="pulse-outline"
              style={{ marginBottom: spacing[3] }}
            >
              测试连接
            </Button>

            <Button
              variant="primary"
              size="large"
              fullWidth
              loading={saving}
              disabled={testing || saving}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing[4],
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.mint[50],
    padding: spacing[3],
    borderRadius: radius.md,
    marginBottom: spacing[5],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.mint[200],
  },
  tipText: {
    ...typography.caption,
    color: colors.mint[800],
    marginLeft: spacing[2],
    flex: 1,
    lineHeight: 18,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textPrimary,
    fontWeight: '600',
    marginBottom: spacing[2],
  },
  providerRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[5],
  },
  providerTab: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  providerTabActive: {
    borderColor: colors.primaryAction,
    backgroundColor: colors.primary[50],
  },
  providerTabText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  providerTabTextActive: {
    color: colors.primaryAction,
    fontWeight: '700',
  },
  configuredBadge: {
    fontSize: 9,
    color: colors.mint[700],
    backgroundColor: colors.mint[50],
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginTop: 3,
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primaryAction,
    marginTop: 4,
  },
  fieldSection: {
    marginBottom: spacing[4],
  },
  fieldLabel: {
    ...typography.label,
    color: colors.textPrimary,
    marginBottom: spacing[1],
    fontWeight: '600',
  },
  keyInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
  },
  keyInput: {
    flex: 1,
    paddingVertical: spacing[3],
    color: colors.textPrimary,
    ...typography.body,
  },
  eyeBtn: {
    padding: spacing[2],
  },
  suggestedModelsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  suggestedLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginRight: 2,
  },
  modelChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[2] + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  modelChipActive: {
    backgroundColor: colors.primary[50],
    borderColor: colors.primaryAction,
  },
  modelChipText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  modelChipTextActive: {
    color: colors.primaryAction,
    fontWeight: '600',
  },
  fieldHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 4,
  },
  actions: {
    marginTop: spacing[4],
  },
});

