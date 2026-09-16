// 设置与专属资料 V2：头像 / AI / 主题 / momi 主动行为与天气 / 退出
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius, useTheme } from '../theme';
import { AppHeader, Avatar, Button, CenterToast } from '../components/ui';
import { fetchAllAvatars, uploadUserAvatar, uploadMomiAvatar } from '../lib/avatarService';
import { pickSingleImageUri } from '../lib/imagePicker';
import { getProactiveSettings, saveProactiveSettings } from '../lib/momiProactiveSettings';
import { getWeather } from '../lib/weatherService';

export default function SettingsScreen({ userId, onBack, onNavigateAISettings, onNavigateThemeSelector, onLogout }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [avatars, setAvatars] = useState({ momo: '', '苞米': '', momi: '' });
  const [settings, setSettings] = useState(null);
  const [uploadingUser, setUploadingUser] = useState(false);
  const [uploadingMomi, setUploadingMomi] = useState(false);
  const [testingWeather, setTestingWeather] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    const [a, s] = await Promise.all([fetchAllAvatars(), getProactiveSettings(userId)]);
    setAvatars(a); setSettings(s);
  }, [userId]);
  useEffect(() => { load().catch((e) => setToast(e.message)); }, [load]);

  const patchSettings = async (patch) => {
    const optimistic = { ...(settings || {}), ...patch };
    setSettings(optimistic);
    try { setSettings(await saveProactiveSettings(userId, patch)); }
    catch (err) { setToast(`保存失败：${err.message}`); await load(); }
  };

  const changeAvatar = async (kind) => {
    const uri = await pickSingleImageUri({ allowsEditing: true, quality: 0.8 });
    if (!uri) return;
    const isMomi = kind === 'momi';
    (isMomi ? setUploadingMomi : setUploadingUser)(true);
    try {
      const url = isMomi ? await uploadMomiAvatar(uri) : await uploadUserAvatar(userId, uri);
      setAvatars((p) => ({ ...p, [isMomi ? 'momi' : userId]: url }));
      setToast(isMomi ? 'momi 的新头像已更新 🐾' : '头像更新成功 ✨');
    } catch (err) { Alert.alert('上传失败', err.message); }
    finally { (isMomi ? setUploadingMomi : setUploadingUser)(false); }
  };

  const testWeather = async () => {
    setTestingWeather(true);
    try {
      const w = await getWeather(settings || {}, { forceRefresh: true });
      setToast(`${w.location}：${w.current.description} ${w.current.temperature}℃，体感 ${w.current.apparentTemperature}℃`);
    } catch (err) { Alert.alert('天气测试失败', err.message); }
    finally { setTestingWeather(false); }
  };

  const menuItem = (icon, title, subtitle, onPress, danger = false) => (
    <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={onPress}>
      <View style={[styles.menuIcon, { backgroundColor: danger ? colors.errorSoft : colors.primarySoft }]}><Ionicons name={icon} size={20} color={danger ? colors.error : colors.primary} /></View>
      <View style={styles.menuText}><Text style={[styles.menuTitle, danger && { color: colors.error }]}>{title}</Text><Text style={styles.menuSubtitle}>{subtitle}</Text></View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );

  const toggleRow = (icon, title, subtitle, key) => (
    <View style={styles.settingRow}>
      <View style={styles.menuIcon}><Ionicons name={icon} size={19} color={colors.primary} /></View>
      <View style={styles.menuText}><Text style={styles.menuTitle}>{title}</Text><Text style={styles.menuSubtitle}>{subtitle}</Text></View>
      <Switch value={Boolean(settings?.[key])} onValueChange={(v) => patchSettings({ [key]: v })} trackColor={{ false: colors.border, true: colors.primarySoft }} thumbColor={settings?.[key] ? colors.primary : colors.textMuted} />
    </View>
  );

  return <View style={styles.container}>
    <AppHeader title="设置与专属资料" subtitle="账号、momi 与应用偏好" showBack onBack={onBack} />
    <CenterToast visible={Boolean(toast)} message={toast} duration={2800} onDismiss={() => setToast('')} />
    <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing[8] }]}>
      <Text style={styles.sectionLabel}>专属头像</Text>
      <View style={styles.card}>
        <View style={styles.avatarRow}>
          <Avatar uri={avatars[userId]} fallback={userId === 'momo' ? 'M' : '苞'} size={60} />
          <View style={styles.avatarInfo}><Text style={styles.userName}>{userId}</Text><Text style={styles.menuSubtitle}>情侣专属账号</Text></View>
          <Button variant="outline" size="small" loading={uploadingUser} onPress={() => changeAvatar('user')}>更换</Button>
        </View>
        <View style={styles.divider} />
        <View style={styles.avatarRow}>
          <Avatar uri={avatars.momi} fallback="🐾" size={60} />
          <View style={styles.avatarInfo}><Text style={styles.userName}>momi 🐾</Text><Text style={styles.menuSubtitle}>双方都可以换</Text></View>
          <Button variant="outline" size="small" loading={uploadingMomi} onPress={() => changeAvatar('momi')}>换新装</Button>
        </View>
      </View>

      <Text style={styles.sectionLabel}>momi 主动行为</Text>
      <View style={styles.card}>
        {toggleRow('sparkles-outline', '主动来找你', '静默一段时间后自然关心，最多每天 3 条', 'proactiveEnabled')}
        <View style={styles.divider} />
        {toggleRow('at-outline', '名字唤醒', '情侣聊天提到“momi”时，由发送端触发插话', 'nameWakeEnabled')}
        <View style={styles.divider} />
        <View style={styles.inlineSetting}>
          <View style={styles.menuText}><Text style={styles.menuTitle}>免扰时段</Text><Text style={styles.menuSubtitle}>24 小时制 HH:mm，可跨午夜</Text></View>
          <TextInput style={styles.timeInput} value={settings?.quietStart || ''} onChangeText={(v) => setSettings((s) => ({ ...s, quietStart: v }))} onEndEditing={() => patchSettings({ quietStart: settings?.quietStart })} placeholder="22:30" placeholderTextColor={colors.textMuted} maxLength={5} />
          <Text style={styles.dash}>—</Text>
          <TextInput style={styles.timeInput} value={settings?.quietEnd || ''} onChangeText={(v) => setSettings((s) => ({ ...s, quietEnd: v }))} onEndEditing={() => patchSettings({ quietEnd: settings?.quietEnd })} placeholder="09:00" placeholderTextColor={colors.textMuted} maxLength={5} />
        </View>
        <View style={styles.divider} />
        <View style={styles.inlineSetting}>
          <View style={styles.menuText}><Text style={styles.menuTitle}>静默触发时长</Text><Text style={styles.menuSubtitle}>多久没有互动后才允许主动关心</Text></View>
          <TextInput style={styles.numberInput} value={String(settings?.silenceHours ?? '')} onChangeText={(v) => setSettings((s) => ({ ...s, silenceHours: v.replace(/\D/g, '') }))} onEndEditing={() => patchSettings({ silenceHours: Number(settings?.silenceHours) || 8 })} keyboardType="number-pad" maxLength={2} />
          <Text style={styles.unit}>小时</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>天气关心</Text>
      <View style={styles.card}>
        {toggleRow('rainy-outline', '天气提醒', '未来 3 小时降雨或明显降温时提醒', 'weatherEnabled')}
        <View style={styles.divider} />
        <View style={styles.cityRow}>
          <Ionicons name="location-outline" size={20} color={colors.primary} />
          <TextInput style={styles.cityInput} value={settings?.city || ''} onChangeText={(v) => setSettings((s) => ({ ...s, city: v }))} onEndEditing={() => patchSettings({ city: settings?.city?.trim() || '' })} placeholder="手动城市，例如：上海" placeholderTextColor={colors.textMuted} />
          <TouchableOpacity style={styles.testButton} onPress={testWeather} disabled={testingWeather}>{testingWeather ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testText}>测试</Text>}</TouchableOpacity>
        </View>
        <Text style={styles.note}>当前版本优先使用手动城市；安装 expo-location 后可接入自动定位回退。</Text>
      </View>

      <Text style={styles.sectionLabel}>应用</Text>
      <View style={styles.card}>
        {menuItem('hardware-chip-outline', 'momi AI 配置', 'DeepSeek / Qwen / 自定义模型', onNavigateAISettings)}
        <View style={styles.divider} />
        {onNavigateThemeSelector ? menuItem('color-palette-outline', '主题与配色', '7 套完整运行时主题', onNavigateThemeSelector) : null}
        {onNavigateThemeSelector ? <View style={styles.divider} /> : null}
        {menuItem('log-out-outline', '退出登录', '退出当前已登录账号', onLogout, true)}
      </View>
    </ScrollView>
  </View>;
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scroll: { padding: spacing[4] },
  sectionLabel: { ...typography.caption, color: c.textMuted, fontWeight: '700', marginTop: spacing[2], marginBottom: spacing[2], textTransform: 'uppercase' },
  card: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: 'hidden', marginBottom: spacing[4] },
  avatarRow: { flexDirection: 'row', alignItems: 'center', padding: spacing[4] },
  avatarInfo: { flex: 1, marginLeft: spacing[3] },
  userName: { ...typography.cardTitle, color: c.text },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: spacing[4] },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3] + 2 },
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
  cityRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], gap: spacing[2] },
  cityInput: { flex: 1, minHeight: 42, borderRadius: radius.md, backgroundColor: c.surfaceSoft, color: c.text, paddingHorizontal: spacing[3], borderWidth: 1, borderColor: c.border },
  testButton: { minWidth: 54, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  testText: { ...typography.caption, color: c.primary, fontWeight: '700' },
  note: { ...typography.caption, color: c.textMuted, paddingHorizontal: spacing[4], paddingBottom: spacing[3], lineHeight: 18 },
});
