// ErrorBoundary：捕获渲染错误，展示用户友好的恢复界面。
//
// - release：显示错误编号 + 重试按钮，不暴露堆栈与内部实现。
// - dev：本地显示堆栈，便于排查。
// - 远程上报：仅当通过 EXPO_PUBLIC_ERROR_REPORT_URL 显式配置了
//   HTTPS 地址时才启用；上报内容经过截断与脱敏，绝不包含
//   堆栈（release）、Token、签名或用户私密内容。
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { colors, typography, radius, spacing } from '../theme';

const REPORT_URL = process.env.EXPO_PUBLIC_ERROR_REPORT_URL || '';
const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

// 脱敏：去掉长随机串（token/签名）、URL 中的 query、文件路径
function sanitizeText(text, maxLength) {
  return String(text || '')
    .replace(/[?&](sig|token|apikey|api_key|userSig|access_token)=[^&\s]+/gi, '$1=<redacted>')
    .replace(/https?:\/\/\S{40,}/g, '<url>')
    .replace(/[A-Za-z0-9+/=_-]{64,}/g, '<redacted>')
    .slice(0, maxLength);
}

function makeErrorId() {
  return `ERR-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function reportRemotely(errorId, error, sessionId) {
  if (!REPORT_URL || !/^https:\/\//i.test(REPORT_URL)) return;
  try {
    fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        errorId,
        sessionId: sanitizeText(sessionId, 60),
        message: sanitizeText(error?.message, 200),
        stack: IS_DEV ? sanitizeText(error?.stack, 1500) : undefined,
        platform: Platform.OS,
        osVersion: String(Platform.Version || ''),
        ts: Date.now(),
      }),
    }).catch(() => {});
  } catch (e) {
    // 上报失败静默——不能因上报引入二次崩溃
  }
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null, errorId: null, sessionId: props.sessionId || 'root' };
  }

  static getDerivedStateFromError(error) {
    return { error, errorId: makeErrorId() };
  }

  componentDidCatch(error, errorInfo) {
    if (this.state.errorId) {
      reportRemotely(this.state.errorId, error, this.state.sessionId);
    }
    this.setState({ errorInfo });
    if (IS_DEV) {
      console.error('[ErrorBoundary]', error, errorInfo);
    }
  }

  reset = () => this.setState({ error: null, errorInfo: null, errorId: null });

  render() {
    if (this.state.error) {
      if (IS_DEV) {
        return (
          <View style={styles.container}>
            <Text style={styles.title}>页面出错了（开发模式）</Text>
            <Text style={styles.session}>Boundary: {this.state.sessionId}</Text>
            <ScrollView style={styles.scroll}>
              <Text style={styles.errorMsg}>{String(this.state.error?.message || this.state.error)}</Text>
              <Text style={styles.stack}>{String(this.state.error?.stack || '')}</Text>
              {this.state.errorInfo?.componentStack ? (
                <Text style={styles.stack}>{'\n— Component Stack —\n'}{this.state.errorInfo.componentStack}</Text>
              ) : null}
            </ScrollView>
            <TouchableOpacity style={styles.btn} onPress={this.reset}>
              <Text style={styles.btnText}>尝试恢复</Text>
            </TouchableOpacity>
          </View>
        );
      }

      return (
        <View style={styles.container}>
          <Text style={styles.emoji}>🌸</Text>
          <Text style={styles.title}>页面开小差了</Text>
          <Text style={styles.desc}>这个页面遇到一点问题，可以重试或返回其他页面。</Text>
          <Text style={styles.code}>错误编号：{this.state.errorId}</Text>
          <TouchableOpacity style={styles.btn} onPress={this.reset} accessibilityRole="button" accessibilityLabel="重试">
            <Text style={styles.btnText}>重试</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing[4], paddingTop: spacing[10], justifyContent: 'center' },
  emoji: { fontSize: 44, textAlign: 'center', marginBottom: spacing[3] },
  title: { ...typography.sectionTitle, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing[2] },
  desc: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing[3] },
  code: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginBottom: spacing[5] },
  session: { ...typography.caption, color: colors.textMuted, marginBottom: spacing[3] },
  scroll: { flex: 1, backgroundColor: colors.neutral[100], borderRadius: radius.md, padding: spacing[3], marginBottom: spacing[3] },
  errorMsg: { ...typography.bodyMedium, color: colors.error, marginBottom: spacing[2] },
  stack: { ...typography.label, color: colors.textSecondary, fontFamily: 'monospace' },
  btn: { backgroundColor: colors.primaryAction, paddingVertical: spacing[3], borderRadius: radius.md, alignItems: 'center' },
  btnText: { ...typography.bodyMedium, color: '#FFFFFF' },
});
