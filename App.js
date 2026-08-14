import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import React, { memo, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useKeyboardHeight } from './src/hooks/useKeyboardHeight';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { Button, AppInput } from './src/components/ui';
import { colors, typography, spacing, radius } from './src/theme';
import { lazyScreen } from './src/lib/lazyScreen';

// loader 仅在页面第一次实际渲染时执行；未访问页面不会参与冷启动模块求值。
const TimeCapsuleScreen = lazyScreen(() => require('./src/screens/TimeCapsuleScreen'));
const WishlistScreen = lazyScreen(() => require('./src/screens/WishlistScreen'));
const TravelDiaryScreen = lazyScreen(() => require('./src/screens/TravelDiaryScreen'));
const AnniversaryScreen = lazyScreen(() => require('./src/screens/AnniversaryScreen'));
const ChatScreen = lazyScreen(() => require('./src/screens/ChatScreen'));
const CheckinListScreen = lazyScreen(() => require('./src/screens/CheckinListScreen'));
const CheckinDetailScreen = lazyScreen(() => require('./src/screens/CheckinDetailScreen'));
const CheckinCalendarScreen = lazyScreen(() => require('./src/screens/CheckinCalendarScreen'));
const GomokuGameScreen = lazyScreen(() => require('./src/screens/GomokuGameScreen'));
const DrawGuessGameScreen = lazyScreen(() => require('./src/screens/DrawGuessGameScreen'));
const EphemeralNoteScreen = lazyScreen(() => require('./src/screens/EphemeralNoteScreen'));
const VoiceMailboxScreen = lazyScreen(() => require('./src/screens/VoiceMailboxScreen'));

const VALID_USERS = { momo: '20260225', '苞米': '20260225' };

function LoginScreen({ onLogin }) {
  const insets = useSafeAreaInsets();
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async () => {
    const name = nickname.trim();
    if (!name || !password.trim()) {
      setErrorMsg('请输入昵称和密码');
      return;
    }
    setErrorMsg('');
    setLoading(true);
    try {
      if (VALID_USERS[name] === password) {
        await AsyncStorage.setItem('user_id', name);
        onLogin(name);
      } else {
        setErrorMsg('昵称或密码错误，请重新输入');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={loginStyles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.backgroundLavender} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            loginStyles.scroll,
            { paddingTop: insets.top, paddingBottom: insets.bottom + spacing[6] },
          ]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <View style={loginStyles.decor1} />
          <View style={loginStyles.decor2} />
          <View style={loginStyles.decor3} />

          <View style={loginStyles.brandSection}>
            <View style={loginStyles.logoWrap}>
              <Ionicons name="heart" size={36} color={colors.primaryAction} />
            </View>
            <Text style={loginStyles.brandTitle}>MOMO Corn</Text>
            <Text style={loginStyles.brandSubtitle}>momo和苞米的小世界</Text>
          </View>

          <View style={loginStyles.formCard}>
            <Text style={loginStyles.formTitle}>欢迎回来</Text>
            <AppInput
              label="昵称"
              placeholder="输入你的昵称"
              value={nickname}
              onChangeText={(value) => {
                setNickname(value);
                setErrorMsg('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <AppInput
              label="密码"
              placeholder="输入密码"
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setErrorMsg('');
              }}
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={handleLogin}
            />
            {errorMsg ? (
              <View style={loginStyles.errorRow}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
                <Text style={loginStyles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}
            <Button
              variant="primary"
              size="large"
              fullWidth
              loading={loading}
              disabled={loading}
              onPress={handleLogin}
              style={{ marginTop: spacing[3] }}
            >
              登录
            </Button>
            <Text style={loginStyles.hintText}>专属账号，仅限两人使用</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const TAB_CONFIG = [
  { key: 'Capsule', label: '时光胶囊', icon: 'mail-outline', activeIcon: 'mail' },
  { key: 'Wishlist', label: '愿望清单', icon: 'sparkles-outline', activeIcon: 'sparkles' },
  { key: 'Diary', label: '恋爱足迹', icon: 'map-outline', activeIcon: 'map' },
  { key: 'Anniversary', label: '纪念日', icon: 'calendar-outline', activeIcon: 'calendar' },
  { key: 'Chat', label: '聊天', icon: 'chatbubble-ellipses-outline', activeIcon: 'chatbubble-ellipses' },
];

const BottomTabBar = memo(function BottomTabBar({ currentTab, onTabChange, unreadCount }) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  if (keyboardHeight > 0) return null;

  return (
    <View style={[tabStyles.container, { paddingBottom: insets.bottom + 4 }]}>
      {TAB_CONFIG.map((tab) => {
        const active = currentTab === tab.key;
        const count = Math.min(99, Number(unreadCount) || 0);
        return (
          <TouchableOpacity
            key={tab.key}
            style={tabStyles.item}
            onPress={() => onTabChange(tab.key)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
          >
            <View style={[tabStyles.iconWrap, active && tabStyles.iconWrapActive]}>
              <Ionicons
                name={active ? tab.activeIcon : tab.icon}
                size={22}
                color={active ? colors.primaryAction : colors.textMuted}
              />
              {tab.key === 'Chat' && count > 0 && !active ? (
                <View style={tabStyles.badge}>
                  <Text style={tabStyles.badgeText}>{unreadCount > 99 ? '99+' : count}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[tabStyles.label, active && tabStyles.labelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

function TabPage({ name, current, mounted, children }) {
  const visible = current === name;
  return (
    <View
      style={[appStyles.screenPage, visible ? appStyles.screenVisible : appStyles.screenHidden]}
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      {mounted ? children : null}
    </View>
  );
}

function MainApp() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState('');
  const [currentTab, setCurrentTab] = useState('Capsule');
  const [initializing, setInitializing] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [mountedTabs, setMountedTabs] = useState(() => new Set(['Capsule']));
  const [fullscreenPage, setFullscreenPage] = useState(null);
  const [chatRefreshTrigger, setChatRefreshTrigger] = useState(0);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem('user_id')
      .then((storedId) => {
        if (alive && storedId && VALID_USERS[storedId]) {
          setUserId(storedId);
          setIsLoggedIn(true);
        }
      })
      .catch((error) => console.warn('[App] 读取登录状态失败:', error.message))
      .finally(() => {
        if (alive) setInitializing(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 先完成首帧和主导航，随后再初始化网络重模块。
  useEffect(() => {
    if (!isLoggedIn || !userId) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const { wakeUpSupabase } = require('./src/lib/wakeUpSupabase');
      wakeUpSupabase().catch((error) => {
        console.warn('[App] 后台唤醒失败（页面会自动重试）:', error.message);
      });

      const { TIM_SDKAPPID } = require('./src/lib/timConfig');
      if (TIM_SDKAPPID) {
        const { initSignal } = require('./src/lib/realtimeSignal');
        initSignal(userId).catch((error) => {
          console.warn('[App] IM 信号层初始化失败（DB 兜底仍可用）:', error.message);
        });
      } else {
        console.warn('[App] 腾讯 IM 未配置，将使用数据库兜底通道');
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isLoggedIn, userId]);

  const handleTabChange = useCallback((tab) => {
    setCurrentTab(tab);
    if (tab === 'Chat') setUnreadCount(0);
    setMountedTabs((previous) => {
      if (previous.has(tab)) return previous;
      const next = new Set(previous);
      next.add(tab);
      return next;
    });
  }, []);

  const handleLogin = useCallback((id) => {
    setUserId(id);
    setIsLoggedIn(true);
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert('退出登录', '确定要退出当前账号吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          try {
            const { disconnectSignal } = require('./src/lib/realtimeSignal');
            await disconnectSignal();
          } catch (error) {
            // IM 可能尚未加载，不影响退出。
          }
          await AsyncStorage.removeItem('user_id');
          setFullscreenPage(null);
          setUserId('');
          setIsLoggedIn(false);
          setUnreadCount(0);
          setCurrentTab('Capsule');
          setMountedTabs(new Set(['Capsule']));
        },
      },
    ]);
  }, []);

  const openFullscreen = useCallback((screen, params) => {
    setFullscreenPage({ screen, params: params || {} });
  }, []);

  const closeFullscreen = useCallback(() => {
    setFullscreenPage(null);
    setChatRefreshTrigger((value) => value + 1);
  }, []);

  const backToList = useCallback(() => openFullscreen('CheckinList'), [openFullscreen]);
  const backToDetail = useCallback(
    (theme) => openFullscreen('CheckinDetail', { theme }),
    [openFullscreen]
  );

  if (initializing) {
    return (
      <View style={appStyles.initContainer}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
        <ActivityIndicator size="large" color={colors.primaryAction} />
      </View>
    );
  }

  if (!isLoggedIn) return <LoginScreen onLogin={handleLogin} />;

  const full = fullscreenPage;
  const params = (full && full.params) || {};
  const fullKey = full
    ? `${full.screen}:${params.gameId || (params.theme && params.theme.id) || 'root'}`
    : 'none';

  return (
    <View style={appStyles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.backgroundLavender} />

      <View style={appStyles.screenContainer}>
        <TabPage name="Capsule" current={currentTab} mounted={mountedTabs.has('Capsule')}>
          <TimeCapsuleScreen userId={userId} onLogout={handleLogout} />
        </TabPage>
        <TabPage name="Wishlist" current={currentTab} mounted={mountedTabs.has('Wishlist')}>
          <WishlistScreen userId={userId} isActive={currentTab === 'Wishlist'} />
        </TabPage>
        <TabPage name="Diary" current={currentTab} mounted={mountedTabs.has('Diary')}>
          <TravelDiaryScreen userId={userId} />
        </TabPage>
        <TabPage name="Anniversary" current={currentTab} mounted={mountedTabs.has('Anniversary')}>
          <AnniversaryScreen userId={userId} />
        </TabPage>
        <TabPage name="Chat" current={currentTab} mounted={mountedTabs.has('Chat')}>
          <ChatScreen
            userId={userId}
            isActive={currentTab === 'Chat'}
            onNavigateCheckinList={() => openFullscreen('CheckinList')}
            onNavigateGomokuGame={(id) => openFullscreen('GomokuGame', { gameId: id })}
            onNavigateDrawGuessGame={(id) => openFullscreen('DrawGuessGame', { gameId: id })}
            onNavigateEphemeralNote={() => openFullscreen('EphemeralNote')}
            onNavigateVoiceMailbox={() => openFullscreen('VoiceMailbox')}
            onUnreadChange={setUnreadCount}
            refreshTrigger={chatRefreshTrigger}
          />
        </TabPage>
      </View>

      {/* 全屏模块打开时完全卸载底部栏，避免 Android 原生层级穿透与误触。 */}
      {!full ? (
        <BottomTabBar
          currentTab={currentTab}
          onTabChange={handleTabChange}
          unreadCount={unreadCount}
        />
      ) : null}

      {/* 放在兄弟节点最后，并增加 elevation，确保 Android 上完整覆盖聊天页。 */}
      {full ? (
        <View
          key={fullKey}
          style={appStyles.fullscreenOverlay}
          pointerEvents="auto"
          collapsable={false}
        >
          <ErrorBoundary key={fullKey} sessionId={`fullscreen-${full.screen}`}>
            {full.screen === 'CheckinList' ? (
              <CheckinListScreen
                userId={userId}
                onNavigateDetail={(theme) => openFullscreen('CheckinDetail', { theme })}
                onBack={closeFullscreen}
              />
            ) : null}
            {full.screen === 'CheckinDetail' ? (
              <CheckinDetailScreen
                theme={params.theme}
                userId={userId}
                onBack={backToList}
                onNavigateCalendar={(theme) => openFullscreen('CheckinCalendar', { theme })}
              />
            ) : null}
            {full.screen === 'CheckinCalendar' ? (
              <CheckinCalendarScreen
                theme={params.theme}
                userId={userId}
                onBack={() => backToDetail(params.theme)}
              />
            ) : null}
            {full.screen === 'GomokuGame' ? (
              <GomokuGameScreen
                gameId={params.gameId}
                userId={userId}
                onBack={closeFullscreen}
                onNavigateGame={(id) => openFullscreen('GomokuGame', { gameId: id })}
              />
            ) : null}
            {full.screen === 'DrawGuessGame' ? (
              <DrawGuessGameScreen gameId={params.gameId} userId={userId} onBack={closeFullscreen} />
            ) : null}
            {full.screen === 'EphemeralNote' ? (
              <EphemeralNoteScreen userId={userId} onBack={closeFullscreen} />
            ) : null}
            {full.screen === 'VoiceMailbox' ? (
              <VoiceMailboxScreen userId={userId} onBack={closeFullscreen} />
            ) : null}
          </ErrorBoundary>
        </View>
      ) : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });

const loginStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLavender, overflow: 'hidden' },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing[5] },
  decor1: {
    position: 'absolute',
    top: -60,
    right: -40,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.primary[200],
    opacity: 0.25,
  },
  decor2: {
    position: 'absolute',
    top: 120,
    left: -50,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.mint[200],
    opacity: 0.2,
  },
  decor3: {
    position: 'absolute',
    bottom: -30,
    right: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primary[100],
    opacity: 0.4,
  },
  brandSection: { alignItems: 'center', marginBottom: spacing[8] },
  logoWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  brandTitle: { ...typography.display, color: colors.textPrimary },
  brandSubtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing[1] },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing[5],
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  formTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing[4],
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.errorSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginBottom: spacing[2],
  },
  errorText: { ...typography.caption, color: colors.error, marginLeft: spacing[2] },
  hintText: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing[4],
    color: colors.textMuted,
  },
});

const tabStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 6,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  iconWrap: {
    width: 44,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    position: 'relative',
  },
  iconWrapActive: { backgroundColor: colors.primary[100] },
  badge: {
    position: 'absolute',
    top: -2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  label: { ...typography.tabLabel, color: colors.textMuted, marginTop: 3 },
  labelActive: { color: colors.primaryAction, fontWeight: '600' },
});

const appStyles = StyleSheet.create({
  initContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  container: { flex: 1, backgroundColor: colors.background, position: 'relative' },
  screenContainer: { flex: 1, position: 'relative' },
  screenPage: { flex: 1 },
  screenVisible: { opacity: 1 },
  screenHidden: {
    position: 'absolute',
    top: 0,
    left: -10000,
    width: '100%',
    height: '100%',
    opacity: 0,
  },
  fullscreenOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    backgroundColor: colors.background,
    overflow: 'hidden',
    zIndex: 1000,
    elevation: 1000,
  },
});
