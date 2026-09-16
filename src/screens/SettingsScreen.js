// 设置与专属资料 V2：头像 / momi 助手设置 / 主题 / 退出
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius, useTheme } from '../theme';
import { AppHeader, Avatar, Button, CenterToast } from '../components/ui';
import { fetchAllAvatars, uploadUserAvatar, uploadMomiAvatar } from '../lib/avatarService';
import { pickSingleImageUri } from '../lib/imagePicker';

export default function SettingsScreen({ userId, onBack, onNavigateAISettings, onNavigateThemeSelector, onLogout }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [avatars, setAvatars] = useState({ momo: '', '苞米': '', momi: '' });
  const [uploadingUser, setUploadingUser] = useState(false);
  const [uploadingMomi, setUploadingMomi] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    const a = await fetchAllAvatars();
    setAvatars(a);
  }, []);
  useEffect(() => { load().catch((e) => setToast(e.message)); }, [load]);

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

  const menuItem = (icon, title, subtitle, onPress, danger = false) => (
    <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={onPress}>
      <View style={[styles.menuIcon, { backgroundColor: danger ? colors.errorSoft : colors.primarySoft }]}><Ionicons name={icon} size={20} color={danger ? colors.error : colors.primary} /></View>
      <View style={styles.menuText}><Text style={[styles.menuTitle, danger && { color: colors.error }]}>{title}</Text><Text style={styles.menuSubtitle}>{subtitle}</Text></View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
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

      <Text style={styles.sectionLabel}>应用与专属助手</Text>
      <View style={styles.card}>
        {menuItem('paw-outline', 'momi 助手设置', 'AI 模型、主动消息、天气与插话', onNavigateAISettings)}
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
  menuIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: spacing[3] },
  menuText: { flex: 1 },
  menuTitle: { ...typography.body, fontWeight: '600', color: c.text },
  menuSubtitle: { ...typography.caption, color: c.textMuted, marginTop: 2 },
});
