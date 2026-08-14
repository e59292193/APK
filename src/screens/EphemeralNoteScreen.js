import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader, Button, EmptyState } from '../components/ui';
import AmbientParticles from '../components/ephemeral/AmbientParticles';
import NoteRevealScene from '../components/ephemeral/NoteRevealScene';
import PaperPlane from '../components/ephemeral/PaperPlane';
import {
  sendNote,
  claimNote,
  consumeNote,
  countPendingNotes,
  newClientRequestId,
} from '../lib/ephemeralService';
import { onSignal } from '../lib/realtimeSignal';
import { getPartnerAppId } from '../lib/timConfig';
import { colors, typography, spacing, radius, shadows } from '../theme';

const { width: SCREEN_W } = Dimensions.get('window');

// 信纸样式选项
const PAPER_OPTIONS = [
  { id: 'lavender', label: '薰衣草', bg: colors.surface, edge: colors.primary[200] },
  { id: 'mint', label: '薄荷', bg: '#F6FBF8', edge: colors.mint[200] },
  { id: 'cream', label: '暖白', bg: '#FFFCF6', edge: colors.amber[100] },
  { id: 'rose', label: '蔷薇', bg: '#FFFBFC', edge: colors.coral[400] },
];

const MAX_LEN = 300;

// 状态机：idle | loading | empty | revealing | consuming | error
export default function EphemeralNoteScreen({ userId, onBack }) {
  const partnerId = getPartnerAppId(userId);
  const [mode, setMode] = useState('draw'); // draw | write

  const [drawState, setDrawState] = useState('idle');
  const [claimedNote, setClaimedNote] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  // 写纸条
  const [content, setContent] = useState('');
  const [paperStyle, setPaperStyle] = useState('lavender');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');

  // 发送动画
  const sendAnim = useRef(new Animated.Value(0)).current;
  const [sendAnimRunning, setSendAnimRunning] = useState(false);

  // reduce motion
  const [reduceMotion, setReduceMotion] = useState(false);

  const sceneRef = useRef(null);
  const mountedRef = useRef(true);
  const claimInFlightRef = useRef(false);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ─── Reduce Motion ───
  useEffect(() => {
    let unsub;
    AccessibilityInfo?.isReduceMotionEnabled?.().then(setReduceMotion).catch(() => {});
    if (AccessibilityInfo?.addEventListener) {
      unsub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    }
    return () => { if (unsub && unsub.remove) unsub.remove(); };
  }, []);

  // ─── 待抽取数量 ───
  const refreshCount = useCallback(async () => {
    try {
      const c = await countPendingNotes(userId);
      if (mountedRef.current) setPendingCount(c);
    } catch (e) {
      // 静默
    }
  }, [userId]);

  useEffect(() => { refreshCount(); }, [refreshCount]);

  // ─── 实时信号：仅刷新数量 ───
  useEffect(() => {
    const unsub = onSignal('ephemeral:note:changed', () => {
      refreshCount();
    });
    return unsub;
  }, [refreshCount]);

  // ─── 低频轮询兜底（信号丢失时）───
  useEffect(() => {
    const t = setInterval(refreshCount, 12000);
    return () => clearInterval(t);
  }, [refreshCount]);

  // ─── 抽取 ───
  const handleDraw = useCallback(async () => {
    if (claimInFlightRef.current) return;
    if (drawState === 'revealing' || drawState === 'loading') return;
    claimInFlightRef.current = true;
    setDrawState('loading');
    setErrorMsg('');
    try {
      const note = await claimNote(userId);
      if (!mountedRef.current) return;
      if (!note) {
        setDrawState('empty');
      } else {
        setClaimedNote(note);
        setDrawState('revealing');
      }
    } catch (e) {
      if (mountedRef.current) {
        setErrorMsg('网络开小差了，稍后再试');
        setDrawState('error');
      }
    } finally {
      claimInFlightRef.current = false;
    }
  }, [drawState, userId]);

  // ─── 消费（飞走开始时触发 DB 消费）───
  const handleFlyAwayStart = useCallback(async () => {
    if (!claimedNote) return;
    setDrawState('consuming');
    try {
      await consumeNote(claimedNote.id, claimedNote.claim_token);
    } catch (e) {
      // 即使消费失败，本地也视为消失（at-most-once）
    }
  }, [claimedNote]);

  // ─── 飞走动画完成后清空状态 ───
  const handleConsumed = useCallback(() => {
    if (!mountedRef.current) return;
    setClaimedNote(null);
    setDrawState('idle');
    refreshCount();
  }, [refreshCount]);

  // ─── 发送 ───
  const handleSend = useCallback(async () => {
    if (!content.trim() || sending) return;
    setSending(true);
    setErrorMsg('');
    try {
      const clientRequestId = newClientRequestId();
      await sendNote({
        senderId: userId,
        receiverId: partnerId,
        content,
        paperStyle,
        clientRequestId,
      });
      if (!mountedRef.current) return;
      // 发送成功 → 播放发送动画
      setContent('');
      setSendAnimRunning(true);
      sendAnim.setValue(0);
      Animated.timing(sendAnim, {
        toValue: 1,
        duration: reduceMotion ? 250 : 1100,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        if (!mountedRef.current) return;
        setSendAnimRunning(false);
        setToast('纸飞机已经出发');
        setTimeout(() => { if (mountedRef.current) setToast(''); }, 2200);
        setMode('draw');
        refreshCount();
      });
    } catch (e) {
      if (mountedRef.current) {
        setErrorMsg('发送失败，请重试');
        setSending(false);
      }
    }
  }, [content, sending, userId, partnerId, paperStyle, reduceMotion, sendAnim, refreshCount]);

  // ─── Android 返回键 ───
  useEffect(() => {
    const handler = () => {
      if (sendAnimRunning) return true; // 动画中拦截
      if (mode === 'write') {
        if (content.trim() && !sending) {
          // 写到一半返回，提示
          // 简单处理：直接返回抽取页
        }
        setMode('draw');
        return true;
      }
      if (drawState === 'revealing' && sceneRef.current) {
        sceneRef.current.flyAway();
        return true;
      }
      if (drawState === 'loading' || drawState === 'consuming') return true;
      onBack && onBack();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [mode, drawState, content, sending, sendAnimRunning, onBack]);

  // 发送动画插值
  const sendX = sendAnim.interpolate({ inputRange: [0, 1], outputRange: [0, SCREEN_W * 0.5] });
  const sendY = sendAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -SCREEN_W * 0.7] });
  const sendRotate = sendAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '20deg'] });
  const sendScale = sendAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.5, 1, 0.3] });
  const sendOpacity = sendAnim.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] });

  return (
    <View style={styles.container}>
      <AppHeader
        title="小纸条"
        subtitle="阅后即逝的悄悄话"
        showBack
        onBack={() => {
          if (sendAnimRunning) return;
          if (mode === 'write') { setMode('draw'); return; }
          if (drawState === 'revealing' && sceneRef.current) { sceneRef.current.flyAway(); return; }
          if (drawState === 'loading' || drawState === 'consuming') return;
          onBack && onBack();
        }}
        rightAction={
          <TouchableOpacity
            style={styles.modeToggle}
            onPress={() => setMode(mode === 'draw' ? 'write' : 'draw')}
            accessibilityRole="button"
            accessibilityLabel={mode === 'draw' ? '写一张纸条' : '返回抽取'}
          >
            <Ionicons
              name={mode === 'draw' ? 'create-outline' : 'mail-outline'}
              size={22}
              color={colors.primaryAction}
            />
            <Text style={styles.modeToggleText}>{mode === 'draw' ? '写一张' : '收信箱'}</Text>
          </TouchableOpacity>
        }
      />

      <View style={styles.body}>
        <AmbientParticles active={drawState !== 'revealing'} reduceMotion={reduceMotion} count={12} />

        {/* ─── 抽取模式 ─── */}
        {mode === 'draw' && drawState !== 'revealing' && (
          <DrawIdleScene
            drawState={drawState}
            pendingCount={pendingCount}
            errorMsg={errorMsg}
            onDraw={handleDraw}
            reduceMotion={reduceMotion}
          />
        )}

        {/* ─── 揭示模式 ─── */}
        {mode === 'draw' && drawState === 'revealing' && claimedNote && (
          <NoteRevealScene
            ref={sceneRef}
            note={claimedNote}
            reduceMotion={reduceMotion}
            onFlyAwayStart={handleFlyAwayStart}
            onConsumed={handleConsumed}
          />
        )}

        {/* ─── 写纸条模式 ─── */}
        {mode === 'write' && !sendAnimRunning && (
          <WriteScene
            content={content}
            setContent={setContent}
            paperStyle={paperStyle}
            setPaperStyle={setPaperStyle}
            sending={sending}
            errorMsg={errorMsg}
            onSend={handleSend}
          />
        )}
      </View>

      {/* 发送动画覆盖层 */}
      {sendAnimRunning && (
        <View style={styles.sendOverlay} pointerEvents="none">
          <Animated.View
            style={{
              transform: [
                { translateX: sendX },
                { translateY: sendY },
                { rotate: sendRotate },
                { scale: sendScale },
              ],
              opacity: sendOpacity,
            }}
          >
            <PaperPlane size={110} />
          </Animated.View>
        </View>
      )}

      {/* Toast */}
      {toast ? (
        <View style={styles.toastWrap} pointerEvents="none">
          <View style={styles.toast}>
            <Ionicons name="paper-plane" size={16} color={colors.primaryAction} />
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ─── 抽取空闲场景 ───
function DrawIdleScene({ drawState, pendingCount, errorMsg, onDraw, reduceMotion }) {
  // 呼吸信箱
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 2600, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 2600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breath, reduceMotion]);
  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  const breathOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.8] });

  if (drawState === 'loading') {
    return (
      <View style={idleStyles.wrap}>
        <Animated.View style={{ transform: [{ scale: breathScale }], opacity: breathOpacity }}>
          <MailboxIcon size={96} />
        </Animated.View>
        <Text style={idleStyles.hint}>纸飞机正在赶来…</Text>
      </View>
    );
  }

  if (drawState === 'empty') {
    return (
      <View style={idleStyles.wrap}>
        <EmptyState
          icon="leaf-outline"
          title="今天还没有纸飞机落下"
          description="等一阵风，也等一句想说的话"
        />
        <Button variant="secondary" size="medium" onPress={onDraw} style={{ marginTop: spacing[4] }}>
          再抽一次
        </Button>
      </View>
    );
  }

  if (drawState === 'error') {
    return (
      <View style={idleStyles.wrap}>
        <EmptyState
          icon="cloud-offline-outline"
          title="网络有点开小差"
          description={errorMsg || '请稍后再试'}
        />
        <Button variant="secondary" size="medium" onPress={onDraw} style={{ marginTop: spacing[4] }}>
          重试
        </Button>
      </View>
    );
  }

  // idle
  return (
    <View style={idleStyles.wrap}>
      <Animated.View style={{ transform: [{ scale: breathScale }] }}>
        <MailboxIcon size={120} />
      </Animated.View>
      <Text style={idleStyles.title}>小纸条信箱</Text>
      <Text style={idleStyles.count}>
        {pendingCount > 0 ? `有 ${pendingCount} 张纸条正等你打开` : '信箱静悄悄，等对方写一张给你'}
      </Text>
      <Button
        variant="primary"
        size="large"
        onPress={onDraw}
        disabled={pendingCount === 0}
        iconLeft="paper-plane-outline"
        style={{ marginTop: spacing[6] }}
      >
        抽取一张小纸条
      </Button>
      {pendingCount === 0 && (
        <Text style={idleStyles.tip}>切换到「写一张」，给 ta 送去悄悄话</Text>
      )}
    </View>
  );
}

// ─── 写纸条场景 ───
function WriteScene({ content, setContent, paperStyle, setPaperStyle, sending, errorMsg, onSend }) {
  const selected = PAPER_OPTIONS.find((p) => p.id === paperStyle) || PAPER_OPTIONS[0];
  return (
    <View style={writeStyles.wrap}>
      <View style={[writeStyles.paper, { backgroundColor: selected.bg, borderColor: selected.edge }]}>
        <View style={[writeStyles.paperTop, { backgroundColor: selected.edge, opacity: 0.5 }]} />
        <Text style={writeStyles.paperHint}>写下想说的话…</Text>
        <TextInput
          style={writeStyles.textInput}
          value={content}
          onChangeText={setContent}
          placeholder="只在 ta 抽到时才会出现，看完即逝…"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={MAX_LEN}
          textAlignVertical="top"
          autoFocus
        />
        <View style={writeStyles.counterRow}>
          <Text style={writeStyles.counter}>{content.length}/{MAX_LEN}</Text>
        </View>
      </View>

      {/* 信纸样式 */}
      <Text style={writeStyles.sectionLabel}>信纸样式</Text>
      <View style={writeStyles.styleRow}>
        {PAPER_OPTIONS.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={[
              writeStyles.styleChip,
              { backgroundColor: p.bg, borderColor: p.id === paperStyle ? colors.primaryAction : p.edge },
              p.id === paperStyle && writeStyles.styleChipActive,
            ]}
            onPress={() => setPaperStyle(p.id)}
            accessibilityRole="button"
            accessibilityLabel={`选择${p.label}信纸`}
          >
            <View style={[writeStyles.styleDot, { backgroundColor: p.edge }]} />
            <Text style={writeStyles.styleLabel}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {errorMsg ? <Text style={writeStyles.error}>{errorMsg}</Text> : null}

      <Button
        variant="primary"
        size="large"
        fullWidth
        loading={sending}
        disabled={!content.trim() || sending}
        onPress={onSend}
        iconRight="send-outline"
        style={{ marginTop: spacing[4] }}
      >
        {sending ? '正在折叠纸飞机…' : '折成纸飞机送出'}
      </Button>
    </View>
  );
}

// ─── 信箱图标（纯 SVG / View 绘制）───
function MailboxIcon({ size = 100 }) {
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }]}>
      <Ionicons name="mail-outline" size={size} color={colors.primary[300]} />
    </View>
  );
}

const idleStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[6] },
  title: { ...typography.sectionTitle, color: colors.textPrimary, marginTop: spacing[5] },
  count: { ...typography.body, color: colors.textSecondary, marginTop: spacing[2], textAlign: 'center' },
  hint: { ...typography.body, color: colors.textSecondary, marginTop: spacing[4] },
  tip: { ...typography.caption, color: colors.textMuted, marginTop: spacing[4] },
});

const writeStyles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  paper: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    minHeight: 260,
    ...shadows.soft,
  },
  paperTop: { height: 10, width: '100%' },
  paperHint: { ...typography.caption, color: colors.textMuted, padding: spacing[4], paddingBottom: 0 },
  textInput: {
    ...typography.body,
    color: colors.textPrimary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    flex: 1,
    minHeight: 160,
    lineHeight: 24,
  },
  counterRow: { alignItems: 'flex-end', paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
  counter: { ...typography.caption, color: colors.textMuted },
  sectionLabel: { ...typography.label, color: colors.textSecondary, marginTop: spacing[4], marginBottom: spacing[2], fontWeight: '600' },
  styleRow: { flexDirection: 'row', gap: spacing[2] },
  styleChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  styleChipActive: { borderWidth: 2 },
  styleDot: { width: 12, height: 12, borderRadius: 6, marginRight: spacing[1] },
  styleLabel: { ...typography.caption, color: colors.textSecondary },
  error: { ...typography.caption, color: colors.error, marginTop: spacing[3] },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLavender },
  body: { flex: 1, position: 'relative' },
  modeToggle: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[1] },
  modeToggleText: { ...typography.caption, color: colors.primaryAction, fontWeight: '600' },
  sendOverlay: {
    position: 'absolute',
    top: '40%',
    left: '50%',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastWrap: { position: 'absolute', bottom: spacing[10], left: 0, right: 0, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing[2] + 2,
    paddingHorizontal: spacing[4],
    borderRadius: radius.pill,
    ...shadows.medium,
  },
  toastText: { ...typography.bodyMedium, color: colors.primaryAction, marginLeft: spacing[2], fontWeight: '600' },
});
