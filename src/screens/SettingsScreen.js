// ═══════════════════════════════════════════════════════
// SettingsScreen —— 个人设置与管理中心 (功能4、功能10入口)
// 包含个人头像与 momi 头像更换、AI 配置入口、主题入口与退出登录
// ═══════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, radius, shadows, useTheme } from '../theme';
import { AppHeader, Avatar, Button, CenterToast } from '../components/ui';
import {
  fetchAllAvatars,
  uploadUserAvatar,
  uploadMomiAvatar,
} from '../lib/avatarService';
import { pickSingleImageUri } from '../lib/imagePicker';

export default function SettingsScreen({
  userId,
  onBack,
  onNavigateAISettings,
  onNavigateThemeSelector,
  onLogout,
}) {
  const insets = useSafeAreaInsets();
  const { colors: currentColors = colors } = useTheme();
  const primary = currentColors.primary || currentColors.primaryAction || '#FF6B35';
  const cardBg = currentColors.card || currentColors.surface || '#FFFFFF';
  const bg = currentColors.background || '#FFF8F5';
  const textMain = currentColors.text || currentColors.textPrimary || '#111111';
  const textSub = currentColors.textSecondary || currentColors.textMuted || '#888888';
  const border = currentColors.border || '#E5E5E5';

  const [avatars, setAvatars] = useState({ momo: '', '苞米': '', momi: '' });
  const [uploadingUser, setUploadingUser] = useState(false);
  const [uploadingMomi, setUploadingMomi] = useState(false);

  // Toast
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setToastVisible(true);
  };

  const loadAvatars = useCallback(async () => {
    try {
      const data = await fetchAllAvatars();
      setAvatars(data);
    } catch (err) {
      console.warn('[Settings] 加载头像失败:', err.message);
    }
  }, []);

  useEffect(() => {
    loadAvatars();
  }, [loadAvatars]);

  // 更换个人头像 (支持自由裁剪)
  const handleChangeUserAvatar = async () => {
    try {
      const uri = await pickSingleImageUri({ allowsEditing: true, quality: 0.8 });
      if (!uri) return;

      setUploadingUser(true);
      const publicUrl = await uploadUserAvatar(userId, uri);
      setAvatars((prev) => ({ ...prev, [userId]: publicUrl }));
      showToast('头像更新成功 ✨');
    } catch (err) {
      console.error('[Settings] 上传头像失败:', err);
      Alert.alert('上传失败', err.message || '请检查网络重试');
    } finally {
      setUploadingUser(false);
    }
  };

  // 更换 momi 头像 (双方均可操作)
  const handleChangeMomiAvatar = async () => {
    try {
      const uri = await pickSingleImageUri({ allowsEditing: true, quality: 0.8 });
      if (!uri) return;

      setUploadingMomi(true);
      const publicUrl = await uploadMomiAvatar(uri);
      setAvatars((prev) => ({ ...prev, momi: publicUrl }));
      showToast('momi 的新头像已更新 🐾');
    } catch (err) {
      console.error('[Settings] 上传 momi 头像失败:', err);
      Alert.alert('上传失败', err.message || '请检查网络重试');
    } finally {
      setUploadingMomi(false);
    }
  };

  const myAvatarUrl = avatars[userId] || '';
  const momiAvatarUrl = avatars.momi || '';

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <AppHeader
        title="设置与专属资料"
        subtitle="管理您的账号、宠物与应用偏好"
        showBack
        onBack={onBack}
      />

      <CenterToast
        visible={toastVisible}
        message={toastMessage}
        duration={2200}
        onDismiss={() => setToastVisible(false)}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing[8] },
        ]}
      >
        {/* 我的头像卡片 */}
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: border, borderWidth: 1 }]}>
          <Text style={[styles.cardSectionTitle, { color: textSub }]}>我的资料</Text>
          <View style={styles.avatarRow}>
            <Avatar
              uri={myAvatarUrl}
              fallback={userId === 'momo' ? 'M' : '苞'}
              size={64}
              style={styles.avatarShadow}
            />
            <View style={styles.avatarInfo}>
              <Text style={[styles.userName, { color: textMain }]}>{userId}</Text>
              <Text style={[styles.userRole, { color: textSub }]}>情侣专属账号</Text>
            </View>
            <Button
              variant="outline"
              size="small"
              loading={uploadingUser}
              disabled={uploadingUser}
              onPress={handleChangeUserAvatar}
              iconLeft="camera-outline"
            >
              更换头像
            </Button>
          </View>
        </View>

        {/* momi 宠物头像卡片 */}
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: border, borderWidth: 1 }]}>
          <Text style={[styles.cardSectionTitle, { color: textSub }]}>momi 伴侣形象</Text>
          <View style={styles.avatarRow}>
            <Avatar
              uri={momiAvatarUrl}
              fallback="🐾"
              size={64}
              style={[styles.avatarShadow, { backgroundColor: currentColors.primarySoft || bg }]}
            />
            <View style={styles.avatarInfo}>
              <Text style={[styles.userName, { color: textMain }]}>momi 🐾</Text>
              <Text style={[styles.userRole, { color: textSub }]}>双方均可为它更换新头像</Text>
            </View>
            <Button
              variant="outline"
              size="small"
              loading={uploadingMomi}
              disabled={uploadingMomi}
              onPress={handleChangeMomiAvatar}
              iconLeft="sparkles-outline"
            >
              换新装
            </Button>
          </View>
        </View>

        {/* 功能菜单区 */}
        <View style={[styles.menuCard, { backgroundColor: cardBg, borderColor: border, borderWidth: 1 }]}>
          {/* momi AI 配置 */}
          <TouchableOpacity
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={onNavigateAISettings}
          >
            <View style={[styles.menuIconWrap, { backgroundColor: currentColors.primarySoft || bg }]}>
              <Ionicons name="hardware-chip-outline" size={20} color={primary} />
            </View>
            <View style={styles.menuContent}>
              <Text style={[styles.menuTitle, { color: textMain }]}>momi AI 配置</Text>
              <Text style={[styles.menuSubtitle, { color: textSub }]}>自主配置 MiniMax / DeepSeek / GLM</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={textSub} />
          </TouchableOpacity>

          <View style={[styles.menuDivider, { backgroundColor: border }]} />

          {/* 主题配色 */}
          {onNavigateThemeSelector && (
            <>
              <TouchableOpacity
                style={styles.menuItem}
                activeOpacity={0.7}
                onPress={onNavigateThemeSelector}
              >
                <View style={[styles.menuIconWrap, { backgroundColor: currentColors.primarySoft || bg }]}>
                  <Ionicons name="color-palette-outline" size={20} color={primary} />
                </View>
                <View style={styles.menuContent}>
                  <Text style={[styles.menuTitle, { color: textMain }]}>主题与配色</Text>
                  <Text style={[styles.menuSubtitle, { color: textSub }]}>自由切换视觉风格</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={textSub} />
              </TouchableOpacity>
              <View style={[styles.menuDivider, { backgroundColor: border }]} />
            </>
          )}

          {/* 退出登录 */}
          <TouchableOpacity
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={onLogout}
          >
            <View style={[styles.menuIconWrap, { backgroundColor: currentColors.errorSoft || '#FFF1F0' }]}>
              <Ionicons name="log-out-outline" size={20} color={currentColors.error || '#FF4D4F'} />
            </View>
            <View style={styles.menuContent}>
              <Text style={[styles.menuTitle, { color: currentColors.error || '#FF4D4F' }]}>退出登录</Text>
              <Text style={[styles.menuSubtitle, { color: textSub }]}>退出当前已登录账号</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={textSub} />
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing[4],
    marginBottom: spacing[4],
    ...shadows.soft,
  },
  cardSectionTitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing[3],
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarShadow: {
    ...shadows.soft,
  },
  avatarInfo: {
    flex: 1,
    marginLeft: spacing[3],
  },
  userName: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  userRole: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  menuCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.soft,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3] + 2,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  menuContent: {
    flex: 1,
  },
  menuTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  menuSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 56,
  },
});
