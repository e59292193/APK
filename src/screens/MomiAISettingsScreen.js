// ═══════════════════════════════════════════════════════
// MomiAISettingsScreen —— momi 集中设置界面 V2
// 聚合：AI 服务商/模型/API Key、主动行为偏好、天气与位置、名字唤醒、小本本入口、运行诊断与手动触发
// ═══════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
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
import {
  DEFAULT_PROACTIVE_SETTINGS,
  getEffectiveProactiveSettings,
  saveProactiveSettings,
} from '../lib/momiProactiveSettings';
import { getProactiveDebugHistory } from '../lib/proactiveDebug';
import { tickProactiveScheduler } from '../lib/proactiveScheduler';
import { getMomiState } from '../lib/momiState';
import { formatLocalTime } from '../lib/dateUtils';
import { resetLocationPermissionState, createWeatherLocationProvider } from '../lib/weatherLocationProvider';
import { getWeatherForMomi } from '../lib/weatherService';

function maskApiKey(key) {
  const value = String(key || '');
  if (!value) return '';
  const last4 = value.slice(-4);
  return `••••••••${last4}`;
}

function isInQuietHours(quietStart, quietEnd, now = new Date()) {
  if (!quietStart || !quietEnd) return false;
  const curMinutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = (quietStart || '22:30').split(':').map(Number);
  const [eh, em] = (quietEnd || '09:00').split(':').map(Number);
  const startM = (sh || 0) * 60 + (sm || 0);
  const endM = (eh || 0) * 60 + (em || 0);
  if (startM <= endM) {
    return curMinutes >= startM && curMinutes < endM;
  }
  return curMinutes >= startM || curMinutes < endM;
}

export default function MomiAISettingsScreen({ userId = 'momo', onBack, onOpenNotebook }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // ─── AI 配置状态 ───
  const [provider, setProvider] = useState(DEFAULT_AI_CONFIG.provider);
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState(DEFAULT_AI_CONFIG.modelName);
  const [providersData, setProvidersData] = useState(DEFAULT_AI_CONFIG.providers);
  const [showKey, setShowKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testingVision, setTestingVision] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visionResult, setVisionResult] = useState('');

  // ─── 主动消息偏好状态 ───
  const [proactiveSettings, setProactiveSettings] = useState(DEFAULT_PROACTIVE_SETTINGS);

  // ─── 天气与位置状态 ───
  const [testingWeather, setTestingWeather] = useState(false);
  const [relocalizing, setRelocalizing] = useState(false);
  const [locationPermStatus, setLocationPermStatus] = useState('检查中');

  // ─── 诊断与状态 ───
  const [debugHistory, setDebugHistory] = useState([]);
  const [momiState, setMomiState] = useState(null);
  const [forcingProactive, setForcingProactive] = useState(false);

  // ─── 通用 Toast ───
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setToastVisible(true);
  };

  // 检查定位权限
  const checkLocationPermission = useCallback(async () => {
    try {
      if (typeof Location.getForegroundPermissionsAsync === 'function') {
        const perm = await Location.getForegroundPermissionsAsync();
        setLocationPermStatus(perm.granted ? '已授权' : perm.canAskAgain ? '可申请' : '未授权');
      } else {
        setLocationPermStatus('系统未支持');
      }
    } catch {
      setLocationPermStatus('未知');
    }
  }, []);

  // 统一加载所有配置
  const loadAll = useCallback(async () => {
    try {
      const [aiCfg, pSettings, dHistory, mState] = await Promise.all([
        getAIConfig(),
        getEffectiveProactiveSettings(userId),
        getProactiveDebugHistory(),
        getMomiState(),
      ]);
      const current = aiCfg.provider || DEFAULT_AI_CONFIG.provider;
      setProvider(current);
      setProvidersData(aiCfg.providers || DEFAULT_AI_CONFIG.providers);
      setApiKey(aiCfg.apiKey || '');
      setModelName(aiCfg.modelName || getDefaultModel(current));
      setProactiveSettings(pSettings || DEFAULT_PROACTIVE_SETTINGS);
      setDebugHistory(dHistory || []);
      setMomiState(mState || null);
      checkLocationPermission();
    } catch (err) {
      console.warn('[MomiSettings] 加载配置异常:', err.message);
    }
  }, [userId, checkLocationPermission]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 更新主动消息偏好
  const patchProactive = async (patch) => {
    const next = { ...proactiveSettings, ...patch };
    setProactiveSettings(next);
    try {
      const saved = await saveProactiveSettings(userId, patch);
      setProactiveSettings(saved);
    } catch (err) {
      showToast(`保存偏好失败：${err.message}`);
    }
  };

  // ─── AI 相关操作 ───
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
      const active = activeConfig();
      const res = await testAIConnection(active);
      if (res.success) {
        const updated = {
          ...providersData,
          [provider]: { apiKey: active.apiKey, modelName: active.modelName },
        };
        await saveAIConfig({ ...active, providers: updated });
        setProvidersData(updated);
        showToast('🎉 连接成功！配置已自动保存');
      } else {
        Alert.alert('连接测试失败', `${res.error || '无法连通该 API'}${res.errorCode ? `\n错误码：${res.errorCode}` : ''}`);
      }
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
      const active = activeConfig();
      const res = await testVisionCapability(active);
      if (res.success && res.text.trim()) {
        setVisionResult(res.text.trim());
        const updated = {
          ...providersData,
          [provider]: { apiKey: active.apiKey, modelName: active.modelName },
        };
        await saveAIConfig({ ...active, providers: updated });
        setProvidersData(updated);
        showToast(`📷 识图成功！配置已自动保存${res.usedFallbackModel ? '（使用了视觉模型）' : ''}`);
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
      await saveProactiveSettings(userId, proactiveSettings);
      setProvidersData(updated);
      setShowKey(false);
      showToast('全部配置已保存到本机 ✨');
      setTimeout(() => onBack?.(), 700);
    } catch (err) {
      Alert.alert('保存失败', err.message || '请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = async () => {
    try {
      if (apiKey.trim()) {
        const active = activeConfig();
        const updated = {
          ...providersData,
          [provider]: { apiKey: active.apiKey, modelName: active.modelName },
        };
        await saveAIConfig({ ...active, providers: updated });
      }
    } catch (err) {
      console.warn('[MomiAISettings] 退出自动保存失败:', err.message);
    }
    onBack?.();
  };

  useEffect(() => {
    const onHardwareBack = () => {
      handleBack();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [provider, apiKey, modelName, providersData, proactiveSettings]);

  // ─── 天气与位置操作 ───
  const handleRelocalize = async () => {
    setRelocalizing(true);
    try {
      resetLocationPermissionState();
      const providerFn = createWeatherLocationProvider();
      const res = await providerFn();
      if (res && res.city) {
        await patchProactive({
          city: res.city,
          latitude: res.latitude,
          longitude: res.longitude,
          resolvedAt: new Date().toISOString(),
        });
        showToast(`📍 定位成功：${res.city}`);
      } else {
        Alert.alert('定位提示', '未能获取当前位置坐标，请确认系统已开启定位权限，或直接在下方输入城市名。');
      }
      checkLocationPermission();
    } catch (err) {
      Alert.alert('重新定位失败', err.message || '系统异常');
    } finally {
      setRelocalizing(false);
    }
  };

  const handleTestWeather = async () => {
    setTestingWeather(true);
    try {
      const res = await getWeatherForMomi({ userId });
      if (res && !res.error && res.current) {
        showToast(`🌤️ ${res.location}：${res.current.desc} ${res.current.temp}℃（${res.advice?.clothing || '体感舒适'}）`);
      } else {
        Alert.alert('天气测试', `未获取到有效天气：${res.reason || res.error || '未知'}\n请确认已填写城市名称或开启定位权限。`);
      }
    } catch (err) {
      Alert.alert('天气测试失败', err.message);
    } finally {
      setTestingWeather(false);
    }
  };

  // ─── 诊断与立即主动触发 ───
  const handleForceProactive = async () => {
    setForcingProactive(true);
    try {
      const res = await tickProactiveScheduler({ userId, force: true });
      const [history, st] = await Promise.all([
        getProactiveDebugHistory(),
        getMomiState(),
      ]);
      setDebugHistory(history || []);
      setMomiState(st || null);
      if (res?.sent) {
        showToast(`🐾 momi 已发主动消息！类型：${res.type}`);
      } else {
        Alert.alert('测试触发结果', `本次未发送成功：${res?.reason || '无可用内容'}`);
      }
    } catch (err) {
      Alert.alert('触发异常', err.message || '系统内部错误');
    } finally {
      setForcingProactive(false);
    }
  };

  const suggestedModels = getSuggestedModels(provider);
  const currentModel = modelName.trim() || getDefaultModel(provider);
  const visionCapable = modelSupportsVision(provider, currentModel);
  const providerMeta = getProviderOption(provider);
  const anyBusy = testingConnection || testingVision || saving || testingWeather || relocalizing || forcingProactive;

  const lastDebug = debugHistory[0] || null;
  const inQuiet = isInQuietHours(proactiveSettings.quietStart, proactiveSettings.quietEnd);

  return (
    <View style={styles.container}>
      <AppHeader title="momi 助手设置" subtitle="AI 模型、主动消息、天气与插话" showBack onBack={handleBack} />
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
          {/* 小本本入口 (e) */}
          {onOpenNotebook ? (
            <TouchableOpacity style={styles.notebookCard} activeOpacity={0.7} onPress={onOpenNotebook}>
              <View style={[styles.menuIcon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="book-outline" size={20} color={colors.primary} />
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>momi 的小本本</Text>
                <Text style={styles.menuSubtitle}>查看和管理记住的事、习惯与专属回忆</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}

          {/* 隐私提示 */}
          <View style={styles.tipCard}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.success} />
            <Text style={styles.tipText}>
              API Key 与个人设置仅通过 AsyncStorage 保存在本机，绝不上传到未受控服务端。
            </Text>
          </View>

          {/* ─── A. AI 服务商与模型配置 ─── */}
          <Text style={styles.sectionLabel}>AI 模型配置</Text>
          <View style={styles.card}>
            <View style={styles.cardPad}>
              <Text style={styles.fieldLabel}>选择 AI 服务商</Text>
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
                        {hasKey ? <Text style={styles.configuredBadge}>已配</Text> : null}
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
                    onFocus={() => setShowKey(true)}
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
                <Text style={styles.fieldHint}>默认脱敏；点击眼睛切换明文编辑。</Text>
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
                      此模型不支持识图，发图时将尝试临时使用 {providerMeta?.visionFallbackModel || '视觉模型'}；无可用模型则提示更换，绝不假装看到。
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
              </View>

              <View style={styles.visionTestCard}>
                <Image source={{ uri: VISION_TEST_IMAGE_DATA_URL }} style={styles.testImage} />
                <View style={styles.visionTestInfo}>
                  <Text style={styles.visionTestTitle}>识图测试卡</Text>
                  <Text style={styles.fieldHint}>模型应能识别为“白底上的红色圆形”。</Text>
                  {visionResult ? <Text style={styles.visionResult}>momi：{visionResult}</Text> : null}
                </View>
              </View>

              <View style={styles.secondaryActions}>
                <TouchableOpacity
                  style={[styles.actionButton, anyBusy && styles.actionDisabled]}
                  disabled={anyBusy}
                  onPress={handleTestConnection}
                >
                  {testingConnection ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="pulse-outline" size={18} color={colors.primary} />}
                  <Text style={styles.actionButtonText}>测试连接</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, anyBusy && styles.actionDisabled]}
                  disabled={anyBusy}
                  onPress={handleTestVision}
                >
                  {testingVision ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="image-outline" size={18} color={colors.primary} />}
                  <Text style={styles.actionButtonText}>测试识图</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* ─── B. 主动消息与免扰 ─── */}
          <Text style={styles.sectionLabel}>主动关心与免扰 (B)</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.menuIcon}><Ionicons name="sparkles-outline" size={19} color={colors.primary} /></View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>主动来找你</Text>
                <Text style={styles.menuSubtitle}>静默后自然关心，或主动问候</Text>
              </View>
              <Switch
                value={Boolean(proactiveSettings.proactiveEnabled)}
                onValueChange={(v) => patchProactive({ proactiveEnabled: v })}
                trackColor={{ false: colors.border, true: colors.primarySoft }}
                thumbColor={proactiveSettings.proactiveEnabled ? colors.primary : colors.textMuted}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.menuIcon}><Ionicons name="sunny-outline" size={19} color={colors.primary} /></View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>早安 / 晚安问候</Text>
                <Text style={styles.menuSubtitle}>每天早晚各最多 1 条自然问候</Text>
              </View>
              <Switch
                value={Boolean(proactiveSettings.greetingEnabled)}
                onValueChange={(v) => patchProactive({ greetingEnabled: v })}
                trackColor={{ false: colors.border, true: colors.primarySoft }}
                thumbColor={proactiveSettings.greetingEnabled ? colors.primary : colors.textMuted}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.menuIcon}><Ionicons name="heart-outline" size={19} color={colors.primary} /></View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>纪念日提醒</Text>
                <Text style={styles.menuSubtitle}>提前 3 天、1 天与当天贴心关照</Text>
              </View>
              <Switch
                value={Boolean(proactiveSettings.anniversaryEnabled)}
                onValueChange={(v) => patchProactive({ anniversaryEnabled: v })}
                trackColor={{ false: colors.border, true: colors.primarySoft }}
                thumbColor={proactiveSettings.anniversaryEnabled ? colors.primary : colors.textMuted}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.inlineSetting}>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>免扰时段</Text>
                <Text style={styles.menuSubtitle}>HH:mm，到期提醒仍会送达</Text>
              </View>
              <TextInput
                style={styles.timeInput}
                value={proactiveSettings.quietStart || ''}
                onChangeText={(v) => setProactiveSettings((s) => ({ ...s, quietStart: v }))}
                onEndEditing={() => patchProactive({ quietStart: proactiveSettings.quietStart })}
                placeholder="22:30"
                placeholderTextColor={colors.textMuted}
                maxLength={5}
              />
              <Text style={styles.dash}>—</Text>
              <TextInput
                style={styles.timeInput}
                value={proactiveSettings.quietEnd || ''}
                onChangeText={(v) => setProactiveSettings((s) => ({ ...s, quietEnd: v }))}
                onEndEditing={() => patchProactive({ quietEnd: proactiveSettings.quietEnd })}
                placeholder="09:00"
                placeholderTextColor={colors.textMuted}
                maxLength={5}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.inlineSetting}>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>静默触发阈值</Text>
                <Text style={styles.menuSubtitle}>双方多久无互动后触发挂念（1-72 小时）</Text>
              </View>
              <TextInput
                style={styles.numberInput}
                value={String(proactiveSettings.silenceHours ?? '')}
                onChangeText={(v) => setProactiveSettings((s) => ({ ...s, silenceHours: v.replace(/\D/g, '') }))}
                onEndEditing={() => patchProactive({ silenceHours: Number(proactiveSettings.silenceHours) || 4 })}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.unit}>小时</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.inlineSetting}>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>每日主动上限</Text>
                <Text style={styles.menuSubtitle}>防止打扰过多（0-8 条）</Text>
              </View>
              <TextInput
                style={styles.numberInput}
                value={String(proactiveSettings.dailyCap ?? '')}
                onChangeText={(v) => setProactiveSettings((s) => ({ ...s, dailyCap: v.replace(/\D/g, '') }))}
                onEndEditing={() => patchProactive({ dailyCap: Number(proactiveSettings.dailyCap) ?? 3 })}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.unit}>条</Text>
            </View>
          </View>

          {/* ─── D. 名字唤醒与插话 ─── */}
          <Text style={styles.sectionLabel}>主聊天唤醒 (D)</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.menuIcon}><Ionicons name="at-outline" size={19} color={colors.primary} /></View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>名字唤醒</Text>
                <Text style={styles.menuSubtitle}>情侣聊天提到“momi”时由发送端触发插话</Text>
              </View>
              <Switch
                value={Boolean(proactiveSettings.nameWakeEnabled)}
                onValueChange={(v) => patchProactive({ nameWakeEnabled: v })}
                trackColor={{ false: colors.border, true: colors.primarySoft }}
                thumbColor={proactiveSettings.nameWakeEnabled ? colors.primary : colors.textMuted}
              />
            </View>
            <Text style={styles.cardFootnote}>* 频率上限：每 2 分钟最多触发 1 次，避免打扰正常情侣交谈。</Text>
          </View>

          {/* ─── C. 天气与位置 ─── */}
          <Text style={styles.sectionLabel}>天气与位置关心 (C)</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.menuIcon}><Ionicons name="rainy-outline" size={19} color={colors.primary} /></View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>天气关心开关</Text>
                <Text style={styles.menuSubtitle}>下雨概率 ≥60% 或降温 ≥6℃ 时关照</Text>
              </View>
              <Switch
                value={Boolean(proactiveSettings.weatherEnabled)}
                onValueChange={(v) => patchProactive({ weatherEnabled: v })}
                trackColor={{ false: colors.border, true: colors.primarySoft }}
                thumbColor={proactiveSettings.weatherEnabled ? colors.primary : colors.textMuted}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.cityRow}>
              <Ionicons name="location-outline" size={20} color={colors.primary} />
              <TextInput
                style={styles.cityInput}
                value={proactiveSettings.city || ''}
                onChangeText={(v) => setProactiveSettings((s) => ({ ...s, city: v }))}
                onEndEditing={() => patchProactive({ city: proactiveSettings.city?.trim() || '' })}
                placeholder="手动城市，例如：上海"
                placeholderTextColor={colors.textMuted}
              />
              <TouchableOpacity
                style={styles.smallOutlineBtn}
                onPress={handleTestWeather}
                disabled={anyBusy}
              >
                {testingWeather ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallBtnText}>测试</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.smallOutlineBtn}
                onPress={handleRelocalize}
                disabled={anyBusy}
              >
                {relocalizing ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallBtnText}>重新定位</Text>}
              </TouchableOpacity>
            </View>
            <View style={styles.permStatusRow}>
              <Text style={styles.permLabel}>系统定位权限：</Text>
              <Text style={[styles.permValue, locationPermStatus === '已授权' ? { color: colors.success } : { color: colors.textSecondary }]}>
                {locationPermStatus}
              </Text>
            </View>
          </View>

          {/* ─── F. 主动消息运行诊断与立即触发 ─── */}
          <Text style={styles.sectionLabel}>主动调度诊断 (F)</Text>
          <View style={styles.card}>
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>调度开关：</Text>
              <Text style={styles.diagVal}>{proactiveSettings.proactiveEnabled ? '🟢 已启用' : '⚪ 已关闭'}</Text>
            </View>
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>免扰状态：</Text>
              <Text style={styles.diagVal}>{inQuiet ? '🌙 免扰时段中' : '☀️ 正常互动时段'}</Text>
            </View>
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>今日已发 / 上限：</Text>
              <Text style={styles.diagVal}>{momiState?.proactive_count_today || 0} / {proactiveSettings.dailyCap ?? 3} 条</Text>
            </View>
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>上次检查时间：</Text>
              <Text style={styles.diagVal}>{lastDebug?.at ? formatLocalTime(lastDebug.at) : '尚未执行'}</Text>
            </View>
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>上次判定结果：</Text>
              <Text style={[styles.diagVal, lastDebug?.sent && { color: colors.success }]}>
                {lastDebug?.sent ? `已发送 [${lastDebug.type}]` : `未发送 (${lastDebug?.reason || '无触发'})`}
              </Text>
            </View>
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>下次检查预计：</Text>
              <Text style={styles.diagVal}>前台 5 分钟轮询或切回应用时</Text>
            </View>
            <View style={styles.diagActionRow}>
              <Button
                variant="outline"
                size="medium"
                loading={forcingProactive}
                disabled={anyBusy}
                onPress={handleForceProactive}
                iconLeft="send-outline"
              >
                立即让 momi 发一条
              </Button>
            </View>
          </View>

          {/* 底部保存按钮 */}
          <View style={styles.actions}>
            <Button
              variant="primary"
              size="large"
              fullWidth
              loading={saving}
              disabled={anyBusy}
              onPress={handleSave}
              iconLeft="checkmark-circle-outline"
            >
              保存全部配置
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
  notebookCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: radius.lg,
    padding: spacing[4], borderWidth: 1.5, borderColor: c.primarySoft, marginBottom: spacing[3],
    shadowColor: c.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  tipCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.successSoft,
    padding: spacing[3], borderRadius: radius.md, marginBottom: spacing[4],
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.success,
  },
  tipText: { ...typography.caption, color: c.text, marginLeft: spacing[2], flex: 1, lineHeight: 19 },
  sectionLabel: { ...typography.caption, color: c.textMuted, fontWeight: '700', marginTop: spacing[3], marginBottom: spacing[2], textTransform: 'uppercase' },
  card: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: 'hidden', marginBottom: spacing[4] },
  cardPad: { padding: spacing[4] },
  providerRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[4] },
  providerTab: {
    flex: 1, minHeight: 60, backgroundColor: c.surfaceSoft, paddingVertical: spacing[2], paddingHorizontal: 4,
    borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: c.border,
  },
  providerTabActive: { borderColor: c.primary, backgroundColor: c.primarySoft },
  providerTabText: { fontSize: 11, color: c.textSecondary, fontWeight: '500' },
  providerTabTextActive: { color: c.primary, fontWeight: '700' },
  badgeRow: { flexDirection: 'row', gap: 3, marginTop: 4, minHeight: 14 },
  recommendedBadge: { fontSize: 9, color: c.textOnPrimary, backgroundColor: c.primary, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  configuredBadge: { fontSize: 9, color: c.success, backgroundColor: c.successSoft, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  fieldSection: { marginBottom: spacing[4] },
  fieldTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[1] },
  fieldLabel: { ...typography.label, color: c.text, fontWeight: '700', marginBottom: spacing[1] },
  keyInputWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceSoft, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing[3], minHeight: 46,
  },
  keyInput: { flex: 1, paddingVertical: spacing[2], color: c.text, ...typography.body },
  eyeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  fieldHint: { ...typography.caption, color: c.textMuted, marginTop: 4, lineHeight: 18 },
  visionBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  visionBadgeYes: { backgroundColor: c.successSoft },
  visionBadgeNo: { backgroundColor: c.warningSoft },
  visionBadgeText: { fontSize: 10, fontWeight: '700' },
  warningCard: {
    flexDirection: 'row', gap: 7, backgroundColor: c.warningSoft, borderRadius: radius.sm,
    padding: spacing[2], marginBottom: spacing[2], borderWidth: StyleSheet.hairlineWidth, borderColor: c.warning,
  },
  warningText: { flex: 1, fontSize: 11, lineHeight: 17, color: c.text },
  suggestedModelsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[1] },
  modelChip: { backgroundColor: c.surfaceSoft, borderWidth: 1, borderColor: c.border, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill },
  modelChipActive: { backgroundColor: c.primarySoft, borderColor: c.primary },
  modelChipText: { fontSize: 11, color: c.textSecondary },
  modelChipTextActive: { color: c.primary, fontWeight: '700' },
  visionTestCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceSoft, borderRadius: radius.md,
    padding: spacing[3], borderWidth: 1, borderColor: c.border, marginBottom: spacing[3],
  },
  testImage: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: c.surfaceSoft },
  visionTestInfo: { flex: 1, marginLeft: spacing[3] },
  visionTestTitle: { ...typography.cardTitle, color: c.text, fontSize: 13 },
  visionResult: { ...typography.caption, color: c.success, marginTop: 4, fontWeight: '600' },
  secondaryActions: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[1] },
  actionButton: {
    flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.card, borderWidth: 1.5, borderColor: c.primary, borderRadius: radius.md,
  },
  actionButtonText: { ...typography.caption, color: c.primary, fontWeight: '700' },
  actionDisabled: { opacity: 0.5 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: spacing[4] },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  menuIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: spacing[3] },
  menuText: { flex: 1 },
  menuTitle: { ...typography.body, fontWeight: '600', color: c.text },
  menuSubtitle: { ...typography.caption, color: c.textMuted, marginTop: 2 },
  inlineSetting: { flexDirection: 'row', alignItems: 'center', padding: spacing[4] },
  timeInput: { width: 55, height: 38, borderRadius: radius.sm, backgroundColor: c.surfaceSoft, color: c.text, textAlign: 'center', borderWidth: 1, borderColor: c.border },
  dash: { color: c.textMuted, marginHorizontal: 4 },
  numberInput: { width: 50, height: 38, borderRadius: radius.sm, backgroundColor: c.surfaceSoft, color: c.text, textAlign: 'center', borderWidth: 1, borderColor: c.border },
  unit: { ...typography.caption, color: c.textSecondary, marginLeft: 5 },
  cardFootnote: { ...typography.caption, color: c.textMuted, paddingHorizontal: spacing[4], paddingBottom: spacing[3], paddingTop: 2 },
  cityRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], gap: spacing[2] },
  cityInput: { flex: 1, minHeight: 40, borderRadius: radius.md, backgroundColor: c.surfaceSoft, color: c.text, paddingHorizontal: spacing[3], borderWidth: 1, borderColor: c.border },
  smallOutlineBtn: { minWidth: 54, height: 38, borderRadius: radius.md, borderWidth: 1, borderColor: c.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[2] },
  smallBtnText: { ...typography.caption, color: c.primary, fontWeight: '700' },
  permStatusRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
  permLabel: { ...typography.caption, color: c.textMuted },
  permValue: { ...typography.caption, fontWeight: '700' },
  diagRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[2] + 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  diagLabel: { ...typography.caption, color: c.textSecondary },
  diagVal: { ...typography.caption, color: c.text, fontWeight: '600' },
  diagActionRow: { padding: spacing[4], alignItems: 'center' },
  actions: { marginTop: spacing[2], marginBottom: spacing[4] },
});
