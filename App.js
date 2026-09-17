import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, InteractionManager, KeyboardAvoidingView, Platform,
  ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRawKeyboardHeight } from './src/hooks/useKeyboardHeight';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { Button, AppInput } from './src/components/ui';
import { typography, spacing, radius, ThemeProvider, useTheme, prefetchThemeId } from './src/theme';
import { lazyScreen } from './src/lib/lazyScreen';
import { signIn, restoreSession, signOutSupabase } from './src/lib/auth';
import { createNotificationAdapter, requestNotificationPermission } from './src/lib/notificationAdapter';
import { createWeatherLocationProvider } from './src/lib/weatherLocationProvider';
import { setNotificationAdapter } from './src/lib/proactiveScheduler';
import { setWeatherLocationProvider } from './src/lib/weatherService';

const notificationAdapter = createNotificationAdapter();
const weatherLocationProvider = createWeatherLocationProvider();
setNotificationAdapter(notificationAdapter);
setWeatherLocationProvider(weatherLocationProvider);

// 未访问的重页面不参与冷启动求值
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
const MomiKitchenScreen = lazyScreen(() => require('./src/screens/MomiKitchenScreen'));
const MomiAssistantScreen = lazyScreen(() => require('./src/screens/MomiAssistantScreen'));
const MomiNotebookScreen = lazyScreen(() => require('./src/screens/MomiNotebookScreen'));
const MomiAISettingsScreen = lazyScreen(() => require('./src/screens/MomiAISettingsScreen'));
const SettingsScreen = lazyScreen(() => require('./src/screens/SettingsScreen'));
const ThemeSelectorScreen = lazyScreen(() => require('./src/screens/ThemeSelectorScreen'));

function ThemedStatusBar() {
  const { theme, colors } = useTheme();
  return <StatusBar barStyle={theme.statusBarStyle || 'dark-content'} backgroundColor={colors.background} />;
}

function LoginScreen({ onLogin }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createLoginStyles(colors), [colors]);
  // 用原始键盘高度做「是否弹起」的布局判断（resize 模式下自适应补偿值约为 0，不能用于判断）
  const keyboardHeight = useRawKeyboardHeight();
  const isKeyboardVisible = keyboardHeight > 0;
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async () => {
    if (loading) return;
    setErrorMsg('');
    setLoading(true);
    try {
      const { username } = await signIn(nickname, password);
      onLogin(username);
    } catch (error) {
      setErrorMsg(error.message || '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const formScroll = (
    <ScrollView
      style={staticStyles.flex}
      contentContainerStyle={[styles.scroll, {
        paddingTop: insets.top + (isKeyboardVisible ? spacing[2] : spacing[6]),
        paddingBottom: insets.bottom + spacing[8],
        justifyContent: isKeyboardVisible ? 'flex-start' : 'center',
      }]}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false} bounces={false}
    >
      <View style={styles.decor1} /><View style={styles.decor2} /><View style={styles.decor3} />
      <View style={[styles.brandSection, isKeyboardVisible && { marginBottom: spacing[3] }]}>
        {!isKeyboardVisible ? <View style={styles.logoWrap}><Ionicons name="heart" size={36} color={colors.primary} /></View> : null}
        <Text style={[styles.brandTitle, isKeyboardVisible && { fontSize: 24, lineHeight: 28 }]}>MOMO Corn</Text>
        <Text style={styles.brandSubtitle}>momo和苞米的小世界</Text>
      </View>
      <View style={styles.formCard}>
        <Text style={styles.formTitle}>欢迎回来</Text>
        <AppInput label="昵称" placeholder="输入你的昵称" value={nickname} onChangeText={(v) => { setNickname(v); setErrorMsg(''); }} autoCapitalize="none" autoCorrect={false} />
        <AppInput label="密码" placeholder="输入密码" value={password} onChangeText={(v) => { setPassword(v); setErrorMsg(''); }} secureTextEntry returnKeyType="go" onSubmitEditing={handleLogin} />
        {errorMsg ? <View style={styles.errorRow}><Ionicons name="alert-circle-outline" size={16} color={colors.error || '#F05A4F'} /><Text style={styles.errorText}>{errorMsg}</Text></View> : null}
        <Button
          variant="primary"
          size="large"
          fullWidth
          loading={loading}
          disabled={loading}
          onPress={handleLogin}
          style={{
            marginTop: spacing[3],
            height: 52,
            borderRadius: 14,
            backgroundColor: colors.primaryAction || colors.primary || '#8B5FC7',
          }}
          textStyle={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}
        >
          登录
        </Button>
        <Text style={styles.hintText}>专属账号，仅限两人使用</Text>
      </View>
    </ScrollView>
  );

  return <View style={styles.container}>
    {Platform.OS === 'ios' ? (
      <KeyboardAvoidingView style={staticStyles.flex} behavior="padding" keyboardVerticalOffset={0}>
        {formScroll}
      </KeyboardAvoidingView>
    ) : (
      // Android 使用 app.json 的 softwareKeyboardLayoutMode: "resize"，系统压缩窗口即可；
      // 再叠加 KeyboardAvoidingView 会二次补偿，产生键盘与内容之间的空白区。
      <View style={staticStyles.flex}>{formScroll}</View>
    )}
  </View>;
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
  const { colors } = useTheme();
  const styles = useMemo(() => createTabStyles(colors), [colors]);
  // 用原始键盘高度：无论 pan/resize 模式，键盘弹起时都隐藏底部 Tab
  const keyboardHeight = useRawKeyboardHeight();
  if (keyboardHeight > 0) return null;
  return <View style={[styles.container, { paddingBottom: insets.bottom + 4 }]}>
    {TAB_CONFIG.map((tab) => {
      const active = currentTab === tab.key;
      const count = Math.min(99, Number(unreadCount) || 0);
      return <TouchableOpacity key={tab.key} style={styles.item} onPress={() => onTabChange(tab.key)} activeOpacity={0.7} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={tab.label}>
        <View style={[styles.iconWrap, active && { backgroundColor: colors.primarySoft }]}>
          <Ionicons name={active ? tab.activeIcon : tab.icon} size={22} color={active ? colors.primary : colors.textMuted} />
          {tab.key === 'Chat' && count > 0 && !active ? <View style={styles.badge}><Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : count}</Text></View> : null}
        </View>
        <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
      </TouchableOpacity>;
    })}
  </View>;
});

function TabPage({ name, current, mounted, children }) {
  const visible = current === name;
  return <View style={[appStaticStyles.screenPage, visible ? appStaticStyles.screenVisible : appStaticStyles.screenHidden]} pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>
    {mounted ? children : null}
  </View>;
}

function MainApp() {
  const { colors } = useTheme();
  const styles = useMemo(() => createAppStyles(colors), [colors]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState('');
  const [currentTab, setCurrentTab] = useState('Capsule');
  const [initializing, setInitializing] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [mountedTabs, setMountedTabs] = useState(() => new Set(['Capsule']));
  const [fullscreenPage, setFullscreenPage] = useState(null);
  const [chatRefreshTrigger, setChatRefreshTrigger] = useState(0);

  useEffect(() => {
    try { require('./src/lib/wakeUpSupabase').wakeUpSupabase().catch(() => {}); } catch {}
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [session] = await Promise.all([restoreSession(), prefetchThemeId()]);
        if (alive && session) { setUserId(session.username); setIsLoggedIn(true); }
      } catch (error) {
        console.warn('[App] 读取登录状态失败:', error.message);
      } finally {
        if (alive) {
          setInitializing(false);
          if (typeof global !== 'undefined' && global.__APP_START_TIME__) {
            const duration = Date.now() - global.__APP_START_TIME__;
            global.__APP_INTERACTIVE_TIME__ = Date.now();
            global.__APP_STARTUP_DURATION__ = duration;
            console.log(`[StartupTelemetry] App Interactive in ${duration}ms`);
          }
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !userId) return undefined;
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      requestNotificationPermission().catch((e) => console.warn('[App] 通知权限申请失败:', e.message));
      require('./src/lib/wakeUpSupabase').wakeUpSupabase().catch((e) => console.warn('[App] 后台唤醒失败:', e.message));
      const { TIM_SDKAPPID } = require('./src/lib/timConfig');
      if (TIM_SDKAPPID) require('./src/lib/realtimeSignal').initSignal(userId).catch((e) => console.warn('[App] IM 初始化失败:', e.message));
    });
    return () => { cancelled = true; task?.cancel?.(); };
  }, [isLoggedIn, userId]);

  // A 方案：App 在前台时每 15 分钟检查提醒/天气/静默关心；组件卸载或退出时清理。
  useEffect(() => {
    if (!isLoggedIn || !userId) return undefined;
    const { startForegroundProactiveScheduler } = require('./src/lib/proactiveScheduler');
    return startForegroundProactiveScheduler({ userId });
  }, [isLoggedIn, userId]);

  const handleTabChange = useCallback((tab) => {
    setCurrentTab(tab);
    if (tab === 'Chat') setUnreadCount(0);
    setMountedTabs((previous) => previous.has(tab) ? previous : new Set([...previous, tab]));
  }, []);
  const handleLogin = useCallback((id) => { setUserId(id); setIsLoggedIn(true); }, []);
  const handleLogout = useCallback(() => {
    Alert.alert('退出登录', '确定要退出当前账号吗？', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: async () => {
        try { await require('./src/lib/realtimeSignal').disconnectSignal(); } catch {}
        try { await notificationAdapter.cancelAll(); } catch {}
        await signOutSupabase();
        setFullscreenPage(null); setUserId(''); setIsLoggedIn(false); setUnreadCount(0); setCurrentTab('Capsule'); setMountedTabs(new Set(['Capsule']));
      } },
    ]);
  }, []);
  const openFullscreen = useCallback((screen, params) => setFullscreenPage({ screen, params: params || {} }), []);
  const closeFullscreen = useCallback(() => { setFullscreenPage(null); setChatRefreshTrigger((v) => v + 1); }, []);
  const backToList = useCallback(() => openFullscreen('CheckinList'), [openFullscreen]);
  const backToDetail = useCallback((theme) => openFullscreen('CheckinDetail', { theme }), [openFullscreen]);

  if (initializing) return <View style={styles.initContainer}><ActivityIndicator size="large" color={colors.primary} /></View>;
  if (!isLoggedIn) return <LoginScreen onLogin={handleLogin} />;

  const full = fullscreenPage;
  const params = full?.params || {};
  const fullKey = full ? `${full.screen}:${params.gameId || params.theme?.id || 'root'}` : 'none';
  return <View style={styles.container}>
    <View style={appStaticStyles.screenContainer}>
      <TabPage name="Capsule" current={currentTab} mounted={mountedTabs.has('Capsule')}><TimeCapsuleScreen userId={userId} onLogout={handleLogout} onNavigateMomiKitchen={() => openFullscreen('MomiKitchen')} onNavigateThemeSelector={() => openFullscreen('ThemeSelector')} onNavigateSettings={() => openFullscreen('Settings')} /></TabPage>
      <TabPage name="Wishlist" current={currentTab} mounted={mountedTabs.has('Wishlist')}><WishlistScreen userId={userId} isActive={currentTab === 'Wishlist'} /></TabPage>
      <TabPage name="Diary" current={currentTab} mounted={mountedTabs.has('Diary')}><TravelDiaryScreen userId={userId} /></TabPage>
      <TabPage name="Anniversary" current={currentTab} mounted={mountedTabs.has('Anniversary')}><AnniversaryScreen userId={userId} /></TabPage>
      <TabPage name="Chat" current={currentTab} mounted={mountedTabs.has('Chat')}><ChatScreen userId={userId} isActive={currentTab === 'Chat'} onNavigateCheckinList={() => openFullscreen('CheckinList')} onNavigateGomokuGame={(id) => openFullscreen('GomokuGame', { gameId: id })} onNavigateDrawGuessGame={(id) => openFullscreen('DrawGuessGame', { gameId: id })} onNavigateEphemeralNote={() => openFullscreen('EphemeralNote')} onNavigateVoiceMailbox={() => openFullscreen('VoiceMailbox')} onNavigateMomiKitchen={() => openFullscreen('MomiKitchen')} onNavigateMomiAssistant={() => openFullscreen('MomiAssistant')} onNavigateThemeSelector={() => openFullscreen('ThemeSelector')} onNavigateSettings={() => openFullscreen('Settings')} onUnreadChange={setUnreadCount} refreshTrigger={chatRefreshTrigger} /></TabPage>
    </View>
    {!full ? <BottomTabBar currentTab={currentTab} onTabChange={handleTabChange} unreadCount={unreadCount} /> : null}
    {full ? <View key={fullKey} style={styles.fullscreenOverlay} pointerEvents="auto" collapsable={false}>
      <ErrorBoundary key={fullKey} sessionId={`fullscreen-${full.screen}`}>
        {full.screen === 'CheckinList' ? <CheckinListScreen userId={userId} onNavigateDetail={(theme) => openFullscreen('CheckinDetail', { theme })} onBack={closeFullscreen} /> : null}
        {full.screen === 'CheckinDetail' ? <CheckinDetailScreen theme={params.theme} userId={userId} onBack={backToList} onNavigateCalendar={(theme) => openFullscreen('CheckinCalendar', { theme })} /> : null}
        {full.screen === 'CheckinCalendar' ? <CheckinCalendarScreen theme={params.theme} userId={userId} onBack={() => backToDetail(params.theme)} /> : null}
        {full.screen === 'GomokuGame' ? <GomokuGameScreen gameId={params.gameId} userId={userId} onBack={closeFullscreen} onNavigateGame={(id) => openFullscreen('GomokuGame', { gameId: id })} /> : null}
        {full.screen === 'DrawGuessGame' ? <DrawGuessGameScreen gameId={params.gameId} userId={userId} onBack={closeFullscreen} /> : null}
        {full.screen === 'EphemeralNote' ? <EphemeralNoteScreen userId={userId} onBack={closeFullscreen} /> : null}
        {full.screen === 'VoiceMailbox' ? <VoiceMailboxScreen userId={userId} onBack={closeFullscreen} /> : null}
        {full.screen === 'MomiKitchen' ? <MomiKitchenScreen userId={userId} onBack={closeFullscreen} onNavigateMomiAssistant={() => openFullscreen('MomiAssistant')} /> : null}
        {full.screen === 'MomiAssistant' ? <MomiAssistantScreen userId={userId} onBack={closeFullscreen} onOpenAISettings={() => openFullscreen('MomiAISettings', { from: 'MomiAssistant' })} /> : null}
        {full.screen === 'MomiNotebook' ? <MomiNotebookScreen userId={userId} onBack={() => openFullscreen('MomiAssistant')} /> : null}
        {(full.screen === 'MomiAISettings' || full.screen === 'MomiSettings') ? <MomiAISettingsScreen userId={userId} onBack={() => openFullscreen(params?.from === 'MomiAssistant' ? 'MomiAssistant' : 'Settings')} onOpenNotebook={() => openFullscreen('MomiNotebook')} /> : null}
        {full.screen === 'Settings' ? <SettingsScreen userId={userId} onBack={closeFullscreen} onLogout={handleLogout} onNavigateThemeSelector={() => openFullscreen('ThemeSelector')} onNavigateAISettings={() => openFullscreen('MomiAISettings', { from: 'Settings' })} /> : null}
        {full.screen === 'ThemeSelector' ? <ThemeSelectorScreen onBack={closeFullscreen} /> : null}
      </ErrorBoundary>
    </View> : null}
  </View>;
}

export default function App() {
  return <SafeAreaProvider><ThemeProvider><ThemedStatusBar /><MainApp /></ThemeProvider></SafeAreaProvider>;
}

const staticStyles = StyleSheet.create({ flex: { flex: 1 } });
const appStaticStyles = StyleSheet.create({
  screenContainer: { flex: 1, position: 'relative' }, screenPage: { flex: 1 }, screenVisible: { opacity: 1 },
  screenHidden: { position: 'absolute', top: 0, left: -10000, width: '100%', height: '100%', opacity: 0 },
});
const createLoginStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background, overflow: 'hidden' },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing[5] },
  decor1: { position: 'absolute', top: -60, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: c.primarySoft, opacity: 0.6 },
  decor2: { position: 'absolute', top: 120, left: -50, width: 140, height: 140, borderRadius: 70, backgroundColor: c.accentSoft, opacity: 0.5 },
  decor3: { position: 'absolute', bottom: -30, right: -20, width: 120, height: 120, borderRadius: 60, backgroundColor: c.primarySoft, opacity: 0.7 },
  brandSection: { alignItems: 'center', marginBottom: spacing[8] },
  logoWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[4], shadowColor: c.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  brandTitle: { ...typography.display, color: c.text }, brandSubtitle: { ...typography.body, color: c.textSecondary, marginTop: spacing[1] },
  formCard: { backgroundColor: c.card, borderRadius: radius.xl, padding: spacing[5], shadowColor: c.shadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4 },
  formTitle: { ...typography.sectionTitle, color: c.text, textAlign: 'center', marginBottom: spacing[4] },
  errorRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.errorSoft, borderRadius: radius.sm, paddingHorizontal: spacing[3], paddingVertical: spacing[2], marginBottom: spacing[2] },
  errorText: { ...typography.caption, color: c.error, marginLeft: spacing[2] },
  hintText: { ...typography.caption, textAlign: 'center', marginTop: spacing[4], color: c.textMuted },
});
const createTabStyles = (c) => StyleSheet.create({
  container: { flexDirection: 'row', backgroundColor: c.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: 6 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  iconWrap: { width: 44, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, position: 'relative' },
  badge: { position: 'absolute', top: -2, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.error, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: c.card },
  badgeText: { color: c.textOnPrimary, fontSize: 10, fontWeight: '700' }, label: { ...typography.tabLabel, color: c.textMuted, marginTop: 3 }, labelActive: { color: c.primary, fontWeight: '600' },
});
const createAppStyles = (c) => StyleSheet.create({
  initContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },
  container: { flex: 1, backgroundColor: c.background, position: 'relative' },
  fullscreenOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', backgroundColor: c.background, overflow: 'hidden', zIndex: 1000, elevation: 1000 },
});
