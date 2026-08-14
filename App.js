import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import React, { useState, useEffect, memo, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Platform,
  StatusBar,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useKeyboardHeight } from './src/hooks/useKeyboardHeight';
import TimeCapsuleScreen from './src/screens/TimeCapsuleScreen';
import TravelDiaryScreen from './src/screens/TravelDiaryScreen';
import ChatScreen from './src/screens/ChatScreen';
import CheckinListScreen from './src/screens/CheckinListScreen';
import CheckinDetailScreen from './src/screens/CheckinDetailScreen';
import CheckinCalendarScreen from './src/screens/CheckinCalendarScreen';
import AnniversaryScreen from './src/screens/AnniversaryScreen';
import WishlistScreen from './src/screens/WishlistScreen';
import GomokuGameScreen from './src/screens/GomokuGameScreen';
import DrawGuessGameScreen from './src/screens/DrawGuessGameScreen';
import EphemeralNoteScreen from './src/screens/EphemeralNoteScreen';
import VoiceMailboxScreen from './src/screens/VoiceMailboxScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { wakeUpSupabase } from './src/lib/wakeUpSupabase';
import { initSignal, disconnectSignal } from './src/lib/realtimeSignal';
import { TIM_SDKAPPID } from './src/lib/timConfig';
import { colors, typography, spacing, radius } from './src/theme';
import { Button, AppInput } from './src/components/ui';

// ─── Valid Users ───
const VALID_USERS = {
  momo: '20260225',
  '苞米': '20260225',
};

// ─── Login Screen ───
function LoginScreen({ onLogin }) {
  const insets = useSafeAreaInsets();
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async () => {
    if (!nickname.trim() || !password.trim()) {
      setErrorMsg('请输入昵称和密码');
      return;
    }
    setErrorMsg('');
    setLoading(true);

    const expectedPassword = VALID_USERS[nickname.trim()];
    if (expectedPassword && expectedPassword === password) {
      const userId = nickname.trim();
      await AsyncStorage.setItem('user_id', userId);
      onLogin(userId);
    } else {
      setErrorMsg('昵称或密码错误，请重新输入');
    }
    setLoading(false);
  };

  return (
    <View style={loginStyles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.backgroundLavender} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: spacing[5],
          paddingTop: insets.top,
          paddingBottom: insets.bottom + spacing[6],
        }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        {/* Decorative circles */}
        <View style={loginStyles.decor1} />
        <View style={loginStyles.decor2} />
        <View style={loginStyles.decor3} />

        {/* Brand */}
        <View style={loginStyles.brandSection}>
          <View style={loginStyles.logoWrap}>
            <Ionicons name="heart" size={36} color={colors.primaryAction} />
          </View>
          <Text style={loginStyles.brandTitle}>MOMO Corn</Text>
          <Text style={loginStyles.brandSubtitle}>momo和苞米的小世界</Text>
        </View>

        {/* Form Card */}
        <View style={loginStyles.formCard}>
          <Text style={loginStyles.formTitle}>欢迎回来</Text>

          <AppInput
            label="昵称"
            placeholder="输入你的昵称"
            value={nickname}
            onChangeText={(v) => { setNickname(v); setErrorMsg(''); }}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <AppInput
            label="密码"
            placeholder="输入密码"
            value={password}
            onChangeText={(v) => { setPassword(v); setErrorMsg(''); }}
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

// ─── Bottom Tab Bar ───
const TAB_CONFIG = [
  { key: 'Capsule', label: '时光胶囊', icon: 'mail-outline', iconActive: 'mail' },
  { key: 'Wishlist', label: '愿望清单', icon: 'sparkles-outline', iconActive: 'sparkles' },
  { key: 'Diary', label: '恋爱足迹', icon: 'map-outline', iconActive: 'map' },
  { key: 'Anniversary', label: '纪念日', icon: 'calendar-outline', iconActive: 'calendar' },
  { key: 'Chat', label: '聊天', icon: 'chatbubble-ellipses-outline', iconActive: 'chatbubble-ellipses' },
];

const BottomTabBar = memo(function BottomTabBar({ currentTab, onTabChange, unreadCount }) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  if (keyboardHeight > 0) return null;

  return (
    <View style={[tabStyles.container, { paddingBottom: insets.bottom + 4 }]}>
      {TAB_CONFIG.map((tab) => {
        const active = currentTab === tab.key;
        const showBadge = tab.key === 'Chat' && unreadCount > 0 && !active;
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
                name={active ? tab.iconActive : tab.icon}
                size={22}
                color={active ? colors.primaryAction : colors.textMuted}
              />
              {showBadge && (
                <View style={tabStyles.badge}>
                  {unreadCount <= 99 ? (
                    <Text style={tabStyles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                  ) : (
                    <Text style={tabStyles.badgeText}>99+</Text>
                  )}
                </View>
              )}
            </View>
            <Text style={[tabStyles.label, active && tabStyles.labelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

// ─── Main App ───
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState('');
  const [currentTab, setCurrentTab] = useState('Capsule');
  const [initializing, setInitializing] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const [mountedTabs, setMountedTabs] = useState(new Set(['Capsule']));

  const handleTabChange = (tab) => {
    setCurrentTab(tab);
    if (tab === 'Chat') setUnreadCount(0);
    setMountedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  };

  const [fullscreenPage, setFullscreenPage] = useState(null);
  const [chatRefreshTrigger, setChatRefreshTrigger] = useState(0);

  useEffect(() => {
    checkLogin();
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    wakeUpSupabase().catch((err) => {
      console.warn('[App] 后台唤醒失败（不影响使用，各页面会自动重试）:', err.message);
    });
    if (TIM_SDKAPPID) {
      initSignal(userId).catch((err) => {
        console.warn('[App] IM 信号层初始化失败（聊天/五子棋实时功能将不可用）:', err.message);
      });
    } else {
      console.warn('[App] 腾讯 IM 未配置，请在 src/lib/timConfig.js 填入 SDKAppID 与 SecretKey');
    }
  }, [isLoggedIn, userId]);

  const checkLogin = async () => {
    try {
      const storedId = await AsyncStorage.getItem('user_id');
      if (storedId && VALID_USERS[storedId]) {
        setUserId(storedId);
        setIsLoggedIn(true);
      }
    } catch (error) {
      console.error('Error checking login:', error);
    } finally {
      setInitializing(false);
    }
  };

  const handleLogin = (id) => {
    setUserId(id);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    Alert.alert('退出登录', '确定要退出当前账号吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          await disconnectSignal().catch(() => {});
          await AsyncStorage.removeItem('user_id');
          setUserId('');
          setIsLoggedIn(false);
          setCurrentTab('Capsule');
          setMountedTabs(new Set(['Capsule']));
        },
      },
    ]);
  };

  const handleNavigateCheckinList = useCallback(() => {
    setFullscreenPage({ screen: 'CheckinList' });
  }, []);

  const handleNavigateGomokuGame = useCallback((gameId) => {
    setFullscreenPage({ screen: 'GomokuGame', params: { gameId } });
  }, []);

  const handleNavigateDrawGuessGame = useCallback((gameId) => {
    setFullscreenPage({ screen: 'DrawGuessGame', params: { gameId } });
  }, []);

  const handleNavigateEphemeralNote = useCallback(() => {
    setFullscreenPage({ screen: 'EphemeralNote' });
  }, []);

  const handleNavigateVoiceMailbox = useCallback(() => {
    setFullscreenPage({ screen: 'VoiceMailbox' });
  }, []);

  const handleNavigateDetail = useCallback((theme) => {
    setFullscreenPage({ screen: 'CheckinDetail', params: { theme } });
  }, []);

  const handleBackToList = useCallback(() => {
    setFullscreenPage({ screen: 'CheckinList' });
  }, []);

  const handleBackToDetail = useCallback((theme) => {
    setFullscreenPage({ screen: 'CheckinDetail', params: { theme } });
  }, []);

  const handleNavigateCalendar = useCallback((theme) => {
    setFullscreenPage({ screen: 'CheckinCalendar', params: { theme } });
  }, []);

  const handleCloseFullscreen = useCallback(() => {
    setFullscreenPage(null);
    setChatRefreshTrigger((n) => n + 1);
  }, []);

  const handleNavigateNewGame = useCallback((newGameId) => {
    setFullscreenPage({ screen: 'GomokuGame', params: { gameId: newGameId } });
  }, []);

  if (initializing) {
    return (
      <SafeAreaProvider>
        <View style={appStyles.initContainer}>
          <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
          <ActivityIndicator size="large" color={colors.primaryAction} />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!isLoggedIn) {
    return (
      <SafeAreaProvider>
        <LoginScreen onLogin={handleLogin} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={appStyles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.backgroundLavender} />

        {/* Screen Content — lazy mount */}
        <View style={appStyles.screenContainer}>
          <View
            style={[appStyles.screenPage, currentTab === 'Capsule' ? appStyles.screenVisible : appStyles.screenHidden]}
            pointerEvents={currentTab === 'Capsule' ? 'auto' : 'none'}
          >
            {mountedTabs.has('Capsule') && <TimeCapsuleScreen userId={userId} onLogout={handleLogout} />}
          </View>
          <View
            style={[appStyles.screenPage, currentTab === 'Wishlist' ? appStyles.screenVisible : appStyles.screenHidden]}
            pointerEvents={currentTab === 'Wishlist' ? 'auto' : 'none'}
          >
            {mountedTabs.has('Wishlist') && <WishlistScreen userId={userId} isActive={currentTab === 'Wishlist'} />}
          </View>
          <View
            style={[appStyles.screenPage, currentTab === 'Diary' ? appStyles.screenVisible : appStyles.screenHidden]}
            pointerEvents={currentTab === 'Diary' ? 'auto' : 'none'}
          >
            {mountedTabs.has('Diary') && <TravelDiaryScreen userId={userId} />}
          </View>
          <View
            style={[appStyles.screenPage, currentTab === 'Anniversary' ? appStyles.screenVisible : appStyles.screenHidden]}
            pointerEvents={currentTab === 'Anniversary' ? 'auto' : 'none'}
          >
            {mountedTabs.has('Anniversary') && <AnniversaryScreen userId={userId} />}
          </View>
          <View
            style={[appStyles.screenPage, currentTab === 'Chat' ? appStyles.screenVisible : appStyles.screenHidden]}
            pointerEvents={currentTab === 'Chat' ? 'auto' : 'none'}
          >
            {mountedTabs.has('Chat') && (
              <ChatScreen
                userId={userId}
                isActive={currentTab === 'Chat'}
                onNavigateCheckinList={handleNavigateCheckinList}
                onNavigateGomokuGame={handleNavigateGomokuGame}
                onNavigateDrawGuessGame={handleNavigateDrawGuessGame}
                onNavigateEphemeralNote={handleNavigateEphemeralNote}
                onNavigateVoiceMailbox={handleNavigateVoiceMailbox}
                onUnreadChange={setUnreadCount}
                refreshTrigger={chatRefreshTrigger}
              />
            )}
          </View>
        </View>

        {/* Fullscreen Page Overlay */}
        {fullscreenPage && (
          <View style={appStyles.fullscreenOverlay}>
            <ErrorBoundary sessionId={`fullscreen-${fullscreenPage.screen}`}>
              {fullscreenPage.screen === 'CheckinList' && (
                <CheckinListScreen
                  userId={userId}
                  onNavigateDetail={handleNavigateDetail}
                  onBack={handleCloseFullscreen}
                />
              )}
              {fullscreenPage.screen === 'CheckinDetail' && (
                <CheckinDetailScreen
                  theme={fullscreenPage.params.theme}
                  userId={userId}
                  onBack={handleBackToList}
                  onNavigateCalendar={handleNavigateCalendar}
                />
              )}
              {fullscreenPage.screen === 'CheckinCalendar' && (
                <CheckinCalendarScreen
                  theme={fullscreenPage.params.theme}
                  userId={userId}
                  onBack={() => handleBackToDetail(fullscreenPage.params.theme)}
                />
              )}
              {fullscreenPage.screen === 'GomokuGame' && (
                <GomokuGameScreen
                  gameId={fullscreenPage.params.gameId}
                  userId={userId}
                  onBack={handleCloseFullscreen}
                  onNavigateGame={handleNavigateNewGame}
                />
              )}
              {fullscreenPage.screen === 'DrawGuessGame' && (
                <DrawGuessGameScreen
                  gameId={fullscreenPage.params.gameId}
                  userId={userId}
                  onBack={handleCloseFullscreen}
                />
              )}
              {fullscreenPage.screen === 'EphemeralNote' && (
                <EphemeralNoteScreen userId={userId} onBack={handleCloseFullscreen} />
              )}
              {fullscreenPage.screen === 'VoiceMailbox' && (
                <VoiceMailboxScreen userId={userId} onBack={handleCloseFullscreen} />
              )}
            </ErrorBoundary>
          </View>
        )}

        {/* Bottom Tab Bar */}
        <BottomTabBar
          currentTab={currentTab}
          onTabChange={handleTabChange}
          unreadCount={unreadCount}
        />
      </View>
    </SafeAreaProvider>
  );
}

// ─── Login Styles ───
const loginStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLavender,
    overflow: 'hidden',
  },
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
  brandSection: {
    alignItems: 'center',
    marginBottom: spacing[8],
  },
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
  brandTitle: {
    ...typography.display,
    color: colors.textPrimary,
  },
  brandSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing[1],
  },
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
  errorText: {
    ...typography.caption,
    color: colors.error,
    marginLeft: spacing[2],
  },
  hintText: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing[4],
    color: colors.textMuted,
  },
});

// ─── Tab Bar Styles ───
const tabStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 6,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  iconWrap: {
    width: 44,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    position: 'relative',
  },
  iconWrapActive: {
    backgroundColor: colors.primary[100],
  },
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
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  label: {
    ...typography.tabLabel,
    color: colors.textMuted,
    marginTop: 3,
  },
  labelActive: {
    color: colors.primaryAction,
    fontWeight: '600',
  },
});

// ─── App Styles ───
const appStyles = StyleSheet.create({
  initContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContainer: {
    flex: 1,
  },
  screenPage: {
    flex: 1,
  },
  screenVisible: {
    opacity: 1,
  },
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
    backgroundColor: colors.background,
    zIndex: 100,
  },
});
