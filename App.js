import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Platform,
  StatusBar,
  Alert,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import TimeCapsuleScreen from './src/screens/TimeCapsuleScreen';
import TravelDiaryScreen from './src/screens/TravelDiaryScreen';

// ─── Valid Users ───
const VALID_USERS = {
  momo: '20260225',
  '苞米': '20260225',
};

// ─── Login Screen ───
function LoginScreen({ onLogin }) {
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!nickname.trim() || !password.trim()) {
      Alert.alert('提示', '请输入昵称和密码');
      return;
    }

    setLoading(true);

    // Simulate brief delay for UX
    await new Promise((resolve) => setTimeout(resolve, 300));

    const expectedPassword = VALID_USERS[nickname.trim()];
    if (expectedPassword && expectedPassword === password) {
      const userId = nickname.trim();
      await AsyncStorage.setItem('user_id', userId);
      onLogin(userId);
    } else {
      Alert.alert('登录失败', '昵称或密码错误，请重新输入');
    }

    setLoading(false);
  };

  return (
    <SafeAreaView style={loginStyles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#2D3436" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={loginStyles.inner}
      >
        {/* Decorative Header */}
        <View style={loginStyles.topSection}>
          <Text style={loginStyles.heartIcon}>💕</Text>
          <Text style={loginStyles.mainTitle}>momo和苞米的小世界</Text>
        </View>

        {/* Login Form */}
        <View style={loginStyles.formCard}>
          <Text style={loginStyles.formTitle}>欢迎回来</Text>

          <Text style={loginStyles.inputLabel}>昵称</Text>
          <TextInput
            style={loginStyles.input}
            value={nickname}
            onChangeText={setNickname}
            placeholder="输入你的昵称"
            placeholderTextColor="#B2BEC3"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={loginStyles.inputLabel}>密码</Text>
          <TextInput
            style={loginStyles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="输入密码"
            placeholderTextColor="#B2BEC3"
            secureTextEntry={true}
          />

          <TouchableOpacity
            style={[loginStyles.loginButton, loading && loginStyles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={loginStyles.loginButtonText}>💕 登录</Text>
            )}
          </TouchableOpacity>

          <Text style={loginStyles.hintText}>专属账号，仅限两人使用</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Main App ───
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState('');
  const [currentTab, setCurrentTab] = useState('Capsule');
  const [initializing, setInitializing] = useState(true);

  // Check stored login on app start
  useEffect(() => {
    checkLogin();
  }, []);

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
          await AsyncStorage.removeItem('user_id');
          setUserId('');
          setIsLoggedIn(false);
          setCurrentTab('Capsule');
        },
      },
    ]);
  };

  // ─── Initializing Screen ───
  if (initializing) {
    return (
      <View style={appStyles.initContainer}>
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }

  // ─── Login Screen ───
  if (!isLoggedIn) {
    return (
      <SafeAreaProvider>
        <LoginScreen onLogin={handleLogin} />
      </SafeAreaProvider>
    );
  }

  // ─── Main App ───
  return (
    <SafeAreaProvider>
      <SafeAreaView style={appStyles.container} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor="#2D3436" />

        {/* Top User Bar */}
        <View style={appStyles.topBar}>
          <Text style={appStyles.topBarText}>Hi, {userId} 💕</Text>
          <TouchableOpacity onPress={handleLogout} style={appStyles.logoutButton}>
            <Text style={appStyles.logoutText}>退出</Text>
          </TouchableOpacity>
        </View>

        {/* Screen Content — both tabs rendered, visibility toggled for state preservation */}
        <View style={appStyles.screenContainer}>
          <View style={[appStyles.screenPage, currentTab === 'Capsule' ? appStyles.screenVisible : appStyles.screenHidden]}>
            <TimeCapsuleScreen userId={userId} onLogout={handleLogout} />
          </View>
          <View style={[appStyles.screenPage, currentTab === 'Diary' ? appStyles.screenVisible : appStyles.screenHidden]}>
            <TravelDiaryScreen userId={userId} />
          </View>
        </View>

        {/* Bottom Tab Bar */}
        <View style={appStyles.tabBar}>
          <TouchableOpacity
            style={[appStyles.tabItem, currentTab === 'Capsule' && appStyles.tabItemActive]}
            onPress={() => setCurrentTab('Capsule')}
            activeOpacity={0.7}
          >
            <Text style={appStyles.tabIcon}>💌</Text>
            <Text style={[appStyles.tabLabel, currentTab === 'Capsule' && appStyles.tabLabelActive]}>
              时光胶囊
            </Text>
          </TouchableOpacity>

          <View style={appStyles.tabDivider} />

          <TouchableOpacity
            style={[appStyles.tabItem, currentTab === 'Diary' && appStyles.tabItemActive]}
            onPress={() => setCurrentTab('Diary')}
            activeOpacity={0.7}
          >
            <Text style={appStyles.tabIcon}>✈️</Text>
            <Text style={[appStyles.tabLabel, currentTab === 'Diary' && appStyles.tabLabelActive]}>
              恋爱足迹
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ─── Login Styles ───
const loginStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2D3436',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  topSection: {
    alignItems: 'center',
    marginBottom: 36,
  },
  heartIcon: {
    fontSize: 56,
    marginBottom: 12,
  },
  mainTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2D3436',
    textAlign: 'center',
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#636E72',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#2D3436',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EEE',
  },
  loginButton: {
    backgroundColor: '#6C5CE7',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  loginButtonDisabled: {
    backgroundColor: '#A29BFE',
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
  },
  hintText: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 12,
    color: '#B2BEC3',
  },
});

// ─── App Styles ───
const appStyles = StyleSheet.create({
  initContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
  },
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2D3436',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  topBarText: {
    color: '#DFE6E9',
    fontSize: 13,
    fontWeight: '500',
  },
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  logoutText: {
    color: '#E17055',
    fontSize: 12,
    fontWeight: '600',
  },
  screenContainer: {
    flex: 1,
  },
  screenPage: {
    flex: 1,
  },
  screenVisible: {
    display: 'flex',
  },
  screenHidden: {
    display: 'none',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E8E8E8',
    paddingBottom: Platform.OS === 'ios' ? 24 : 6,
    paddingTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 10,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 12,
    marginHorizontal: 12,
  },
  tabItemActive: {
    backgroundColor: '#F0EDFF',
  },
  tabDivider: {
    width: 1,
    backgroundColor: '#E8E8E8',
    marginVertical: 4,
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#B2BEC3',
  },
  tabLabelActive: {
    color: '#6C5CE7',
    fontWeight: '700',
  },
});