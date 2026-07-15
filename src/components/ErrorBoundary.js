// ErrorBoundary: catches render errors, posts stack to Debug Server, displays fallback UI.
// Useful for both dev and release builds — surfaces silent crashes instead of crashing the app.
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { colors, typography, radius, spacing } from '../theme';

const DEBUG_URL = 'http://192.168.95.167:7777/event';
const DEBUG_SESSION = 'checkin-all-crash';

function postEvent(hypothesisId, msg, data) {
  try {
    fetch(DEBUG_URL, {
      method: 'POST',
      body: JSON.stringify({
        sessionId: DEBUG_SESSION,
        runId: 'pre',
        hypothesisId,
        msg: `[DEBUG] ${msg}`,
        data: data || {},
        ts: Date.now(),
      }),
    }).catch(() => {});
  } catch (e) { /* ignore */ }
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null, sessionId: props.sessionId || 'root' };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    const stack = errorInfo?.componentStack || '';
    const msg = error?.message || String(error);
    postEvent('ERR', `ErrorBoundary caught: ${msg}`, {
      message: msg,
      stack: String(error?.stack || '').slice(0, 4000),
      componentStack: String(stack).slice(0, 4000),
      sessionId: this.state.sessionId,
    });
    this.setState({ errorInfo });
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  reset = () => this.setState({ error: null, errorInfo: null });

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>页面出错了</Text>
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
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing[4], paddingTop: spacing[10] },
  title: { ...typography.sectionTitle, color: colors.error, marginBottom: spacing[2] },
  session: { ...typography.caption, color: colors.textMuted, marginBottom: spacing[3] },
  scroll: { flex: 1, backgroundColor: colors.neutral[100], borderRadius: radius.md, padding: spacing[3], marginBottom: spacing[3] },
  errorMsg: { ...typography.bodyMedium, color: colors.error, marginBottom: spacing[2] },
  stack: { ...typography.label, color: colors.textSecondary, fontFamily: 'monospace' },
  btn: { backgroundColor: colors.primaryAction, paddingVertical: spacing[3], borderRadius: radius.md, alignItems: 'center' },
  btnText: { ...typography.bodyMedium, color: '#FFFFFF' },
});
