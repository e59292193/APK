import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  useAudioPlayerStatus,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
} from 'expo-audio';
import { AppHeader, Button, EmptyState } from '../components/ui';
import AmbientParticles from '../components/ephemeral/AmbientParticles';
import VoiceLetterScene from '../components/ephemeral/VoiceLetterScene';
import VoiceWaveform from '../components/ephemeral/VoiceWaveform';
import {
  sendVoice,
  claimVoice,
  consumeVoice,
  releaseVoiceClaim,
  createSignedVoiceUrl,
  countPendingVoice,
  normalizeWaveform,
  newClientRequestId,
} from '../lib/ephemeralService';
import { onSignal } from '../lib/realtimeSignal';
import { getPartnerAppId } from '../lib/timConfig';
import { colors, typography, spacing, radius, shadows } from '../theme';

const { width: SCREEN_W } = Dimensions.get('window');
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 120000;

// 状态机：idle | loading | empty | revealing | consuming | error
export default function VoiceMailboxScreen({ userId, onBack }) {
  const partnerId = getPartnerAppId(userId);
  const [mode, setMode] = useState('draw'); // draw | record

  const [drawState, setDrawState] = useState('idle');
  const [claimedVoice, setClaimedVoice] = useState(null);
  const [signedUrl, setSignedUrl] = useState(null);
  const [signedUrlError, setSignedUrlError] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [toast, setToast] = useState('');
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
      const c = await countPendingVoice(userId);
      if (mountedRef.current) setPendingCount(c);
    } catch (e) {}
  }, [userId]);
  useEffect(() => { refreshCount(); }, [refreshCount]);

  // ─── 实时信号 ───
  useEffect(() => {
    const unsub = onSignal('ephemeral:voice:changed', () => refreshCount());
    return unsub;
  }, [refreshCount]);
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
    setSignedUrl(null);
    setSignedUrlError(false);
    try {
      const voice = await claimVoice(userId);
      if (!mountedRef.current) return;
      if (!voice) {
        setDrawState('empty');
      } else {
        setClaimedVoice(voice);
        setDrawState('revealing');
        // 并行拉取短时 signed URL
        try {
          const url = await createSignedVoiceUrl(voice.storage_path);
          if (mountedRef.current) setSignedUrl(url);
        } catch (e) {
          if (mountedRef.current) setSignedUrlError(true);
        }
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

  // ─── 消费（消散开始）───
  const handleConsumeStart = useCallback(async () => {
    if (!claimedVoice) return;
    setDrawState('consuming');
    try {
      await consumeVoice(claimedVoice.id, claimedVoice.claim_token, claimedVoice.storage_path);
    } catch (e) {
      // 本地仍视为消失
    }
  }, [claimedVoice]);

  // ─── 消散完成 ───
  const handleConsumed = useCallback(() => {
    if (!mountedRef.current) return;
    setClaimedVoice(null);
    setSignedUrl(null);
    setSignedUrlError(false);
    setDrawState('idle');
    refreshCount();
  }, [refreshCount]);

  // ─── 释放 claim（加载失败 / 未播放返回）───
  const handleRelease = useCallback(async () => {
    if (!claimedVoice) return;
    try {
      await releaseVoiceClaim(claimedVoice.id, claimedVoice.claim_token);
    } catch (e) {}
    if (!mountedRef.current) return;
    setClaimedVoice(null);
    setSignedUrl(null);
    setSignedUrlError(false);
    setDrawState('idle');
    setToast('声音没有准备好，已放回信箱');
    setTimeout(() => { if (mountedRef.current) setToast(''); }, 2200);
    refreshCount();
  }, [claimedVoice, refreshCount]);

  // ─── Android 返回键 ───
  useEffect(() => {
    const handler = () => {
      if (mode === 'record') { setMode('draw'); return true; }
      if (drawState === 'revealing' && sceneRef.current) { sceneRef.flyAway(); return true; }
      if (drawState === 'loading' || drawState === 'consuming') return true;
      onBack && onBack();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [mode, drawState, onBack]);

  return (
    <View style={styles.container}>
      <AppHeader
        title="语音信箱"
        subtitle="听见 ta 的声音，然后让它飘走"
        showBack
        onBack={() => {
          if (mode === 'record') { setMode('draw'); return; }
          if (drawState === 'revealing' && sceneRef.current) { sceneRef.flyAway(); return; }
          if (drawState === 'loading' || drawState === 'consuming') return;
          onBack && onBack();
        }}
        rightAction={
          <TouchableOpacity
            style={styles.modeToggle}
            onPress={() => setMode(mode === 'draw' ? 'record' : 'draw')}
            accessibilityRole="button"
            accessibilityLabel={mode === 'draw' ? '录制语音' : '返回抽取'}
          >
            <Ionicons
              name={mode === 'draw' ? 'mic-outline' : 'mail-open-outline'}
              size={22}
              color={colors.primaryAction}
            />
            <Text style={styles.modeToggleText}>{mode === 'draw' ? '录一段' : '收信箱'}</Text>
          </TouchableOpacity>
        }
      />

      <View style={styles.body}>
        <AmbientParticles active={drawState !== 'revealing'} reduceMotion={reduceMotion} count={12} />

        {mode === 'draw' && drawState !== 'revealing' && (
          <VoiceIdleScene
            drawState={drawState}
            pendingCount={pendingCount}
            errorMsg={errorMsg}
            onDraw={handleDraw}
            reduceMotion={reduceMotion}
          />
        )}

        {mode === 'draw' && drawState === 'revealing' && claimedVoice && (
          <VoiceLetterScene
            ref={sceneRef}
            voice={claimedVoice}
            signedUrl={signedUrl}
            signedUrlError={signedUrlError}
            reduceMotion={reduceMotion}
            onConsumeStart={handleConsumeStart}
            onConsumed={handleConsumed}
            onRelease={handleRelease}
          />
        )}

        {mode === 'record' && (
          <RecordScene
            userId={userId}
            partnerId={partnerId}
            reduceMotion={reduceMotion}
            onSent={() => {
              setMode('draw');
              refreshCount();
              setToast('声音信封已经出发');
              setTimeout(() => { if (mountedRef.current) setToast(''); }, 2200);
            }}
            onError={(msg) => {
              setToast(msg || '操作失败，请重试');
              setTimeout(() => { if (mountedRef.current) setToast(''); }, 2200);
            }}
          />
        )}
      </View>

      {toast ? (
        <View style={styles.toastWrap} pointerEvents="none">
          <View style={styles.toast}>
            <Ionicons name="volume-medium-outline" size={16} color={colors.primaryAction} />
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// 抽取空闲场景
// ═══════════════════════════════════════════════════════
function VoiceIdleScene({ drawState, pendingCount, errorMsg, onDraw, reduceMotion }) {
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
  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  if (drawState === 'loading') {
    return (
      <View style={idleStyles.wrap}>
        <Animated.View style={{ transform: [{ scale: breathScale }] }}>
          <Ionicons name="mail-outline" size={96} color={colors.primary[300]} />
        </Animated.View>
        <Text style={idleStyles.hint}>声音信封正在赶来…</Text>
      </View>
    );
  }
  if (drawState === 'empty') {
    return (
      <View style={idleStyles.wrap}>
        <EmptyState icon="leaf-outline" title="信箱里还没有声音" description="等一阵风，也等一句想说的话" />
        <Button variant="secondary" size="medium" onPress={onDraw} style={{ marginTop: spacing[4] }}>
          再抽一次
        </Button>
      </View>
    );
  }
  if (drawState === 'error') {
    return (
      <View style={idleStyles.wrap}>
        <EmptyState icon="cloud-offline-outline" title="网络有点开小差" description={errorMsg || '请稍后再试'} />
        <Button variant="secondary" size="medium" onPress={onDraw} style={{ marginTop: spacing[4] }}>
          重试
        </Button>
      </View>
    );
  }
  return (
    <View style={idleStyles.wrap}>
      <Animated.View style={{ transform: [{ scale: breathScale }] }}>
        <Ionicons name="mail-outline" size={120} color={colors.primary[300]} />
      </Animated.View>
      <Text style={idleStyles.title}>声音信箱</Text>
      <Text style={idleStyles.count}>
        {pendingCount > 0 ? `有 ${pendingCount} 段声音正等你打开` : '信箱静悄悄，等 ta 录一段给你'}
      </Text>
      <Button
        variant="primary"
        size="large"
        onPress={onDraw}
        disabled={pendingCount === 0}
        iconLeft="volume-medium-outline"
        style={{ marginTop: spacing[6] }}
      >
        抽取一段语音
      </Button>
      {pendingCount === 0 && (
        <Text style={idleStyles.tip}>切换到「录一段」，给 ta 留下声音</Text>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// 录音场景
// ═══════════════════════════════════════════════════════
function RecordScene({ userId, partnerId, reduceMotion, onSent, onError }) {
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  const [permissionGranted, setPermissionGranted] = useState(null); // null=未请求
  const [recordedUri, setRecordedUri] = useState(null);
  const [durationMs, setDurationMs] = useState(0);
  const [waveform, setWaveform] = useState([]);
  const [sending, setSending] = useState(false);
  const [sendAnimRunning, setSendAnimRunning] = useState(false);
  const [sendAnim] = useState(() => new Animated.Value(0));
  const [liveSamples, setLiveSamples] = useState([]);

  const meteringRef = useRef(-160);
  const samplesRef = useRef([]);
  const sampleTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const durationRef = useRef(0);      // 录音期间累计的最大时长（stop 后 recorderState 会归零）
  const isRecordingRef = useRef(false); // 供卸载 cleanup 使用，避免闭包陈旧
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // 同步 metering 到 ref
  useEffect(() => {
    meteringRef.current = recorderState.metering ?? -160;
  }, [recorderState.metering]);

  // 同步录音状态与时长到 ref
  useEffect(() => {
    isRecordingRef.current = !!recorderState.isRecording;
    if (recorderState.isRecording) {
      durationRef.current = Math.max(durationRef.current, recorderState.durationMs || 0);
    }
  }, [recorderState.isRecording, recorderState.durationMs]);

  // 录音时长
  useEffect(() => {
    if (recorderState.isRecording) {
      setDurationMs(recorderState.durationMs || 0);
      // 超过最大时长自动停止
      if ((recorderState.durationMs || 0) >= MAX_DURATION_MS) {
        stopRecording();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState.isRecording, recorderState.durationMs]);

  // 卸载时清理
  useEffect(() => {
    return () => {
      if (sampleTimerRef.current) clearInterval(sampleTimerRef.current);
      try {
        if (audioRecorder && isRecordingRef.current) audioRecorder.stop();
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 请求权限 ───
  const ensurePermission = useCallback(async () => {
    if (permissionGranted === true) return true;
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!mountedRef.current) return false;
      setPermissionGranted(status.granted);
      return status.granted;
    } catch (e) {
      setPermissionGranted(false);
      return false;
    }
  }, [permissionGranted]);

  // ─── 开始录音 ───
  const startRecording = useCallback(async () => {
    const ok = await ensurePermission();
    if (!ok) {
      onError('需要麦克风权限才能录音，请在系统设置中开启');
      return;
    }
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      samplesRef.current = [];
      durationRef.current = 0;
      isRecordingRef.current = false;
      setLiveSamples([]);
      setRecordedUri(null);
      setDurationMs(0);
      await audioRecorder.prepareToRecordAsync();
      // record() 在 expo-audio 中返回 Promise，必须 await：
      // 否则启动失败（如 AudioSession 冲突）时异常被静默吞掉，
      // 表现为“点击后没反应、不计时、录音未开始”
      await audioRecorder.record();
      // 每 100ms 采样 metering
      sampleTimerRef.current = setInterval(() => {
        samplesRef.current.push(meteringRef.current);
        if (samplesRef.current.length % 3 === 0) {
          setLiveSamples([...samplesRef.current]);
        }
      }, 100);
    } catch (e) {
      console.warn('[voice] 录音启动失败:', e && (e.message || e));
      if (sampleTimerRef.current) {
        clearInterval(sampleTimerRef.current);
        sampleTimerRef.current = null;
      }
      onError('录音启动失败，请重试');
    }
  }, [audioRecorder, ensurePermission, onError]);

  // ─── 停止录音 ───
  const stopRecording = useCallback(async () => {
    if (sampleTimerRef.current) {
      clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }
    try {
      await audioRecorder.stop();
    } catch (e) {}
    if (!mountedRef.current) return;
    const uri = audioRecorder.uri;
    // recorderState.durationMs 是闭包快照，stop 后可能已归零，用 ref 里的累计值
    const dur = durationRef.current;
    if (dur < MIN_DURATION_MS) {
      setRecordedUri(null);
      setDurationMs(0);
      samplesRef.current = [];
      setLiveSamples([]);
      onError('录音太短了，至少 1 秒');
      return;
    }
    setRecordedUri(uri);
    setDurationMs(dur);
    setWaveform(normalizeWaveform(samplesRef.current, 40));
    setLiveSamples(normalizeWaveform(samplesRef.current, 40));
  }, [audioRecorder, onError]);

  // ─── 试听与重录（拆到 PreviewPanel 子组件中，仅在有录音时才创建
  //     AudioPlayer，避免空 Player 常驻抢占 AudioSession 导致录音无法启动）───
  const reRecord = useCallback(() => {
    setRecordedUri(null);
    setDurationMs(0);
    setWaveform([]);
    setLiveSamples([]);
    samplesRef.current = [];
  }, []);

  // ─── 发送 ───
  const handleSend = useCallback(async () => {
    if (!recordedUri || sending) return;
    setSending(true);
    try {
      const clientRequestId = newClientRequestId();
      await sendVoice({
        senderId: userId,
        receiverId: partnerId,
        localUri: recordedUri,
        durationMs,
        waveform,
        mimeType: 'audio/m4a',
        clientRequestId,
      });
      if (!mountedRef.current) return;
      // 发送动画：信封封口飞走
      setSending(false);
      setSendAnimRunning(true);
      setRecordedUri(null);
      sendAnim.setValue(0);
      Animated.timing(sendAnim, {
        toValue: 1,
        duration: reduceMotion ? 250 : 1000,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        if (!mountedRef.current) return;
        setSendAnimRunning(false);
        onSent();
      });
    } catch (e) {
      if (mountedRef.current) {
        setSending(false);
        onError('发送失败，录音已保留，可重试');
      }
    }
  }, [recordedUri, sending, userId, partnerId, durationMs, waveform, reduceMotion, sendAnim, onSent, onError]);

  const sendY = sendAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -SCREEN_W * 0.8] });
  const sendOpacity = sendAnim.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] });
  const sendScale = sendAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });

  const fmt = (ms) => {
    const sec = Math.max(0, Math.floor((ms || 0) / 1000));
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  };

  // ─── 权限被拒 ───
  if (permissionGranted === false) {
    return (
      <View style={recStyles.wrap}>
        <EmptyState
          icon="mic-off-outline"
          title="麦克风权限未开启"
          description="请在系统设置 → 应用 → MOMO Corn 中开启麦克风权限后重试"
        />
        <Button variant="secondary" size="medium" onPress={() => setPermissionGranted(null)} style={{ marginTop: spacing[4] }}>
          重新尝试
        </Button>
      </View>
    );
  }

  return (
    <View style={recStyles.wrap}>
      {!recordedUri && !sendAnimRunning && (
        <>
          <Text style={recStyles.title}>{recorderState.isRecording ? '正在录音…' : '录一段声音'}</Text>
          <Text style={recStyles.sub}>
            {recorderState.isRecording ? '轻点停止，可试听后发送' : '最长 120 秒，发送后阅后即逝'}
          </Text>

          <View style={recStyles.waveBox}>
            <VoiceWaveform
              points={liveSamples}
              recording={recorderState.isRecording}
              height={80}
            />
          </View>

          <Text style={recStyles.timer}>{fmt(recorderState.isRecording ? recorderState.durationMs : 0)}</Text>

          <TouchableOpacity
            style={[recStyles.recordBtn, recorderState.isRecording && recStyles.recordBtnActive]}
            onPress={recorderState.isRecording ? stopRecording : startRecording}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={recorderState.isRecording ? '停止录音' : '开始录音'}
          >
            <Ionicons name={recorderState.isRecording ? 'stop' : 'mic'} size={30} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={recStyles.recordHint}>
            {recorderState.isRecording ? '点击停止' : '点击开始录音'}
          </Text>
        </>
      )}

      {recordedUri && !sendAnimRunning && (
        <PreviewPanel
          recordedUri={recordedUri}
          durationMs={durationMs}
          waveform={waveform}
          sending={sending}
          onReRecord={reRecord}
          onSend={handleSend}
        />
      )}

      {sendAnimRunning && (
        <View style={recStyles.sendOverlay} pointerEvents="none">
          <Animated.View
            style={{
              transform: [{ translateY: sendY }, { scale: sendScale }],
              opacity: sendOpacity,
            }}
          >
            <View style={recStyles.flyEnvelope}>
              <Ionicons name="mail" size={64} color={colors.primaryAction} />
            </View>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// 试听面板（独立子组件：仅在录制完成后挂载，
// 此时才创建 AudioPlayer，录音阶段不再有 Player 抢占 AudioSession）
// ═══════════════════════════════════════════════════════
function PreviewPanel({ recordedUri, durationMs, waveform, sending, onReRecord, onSend }) {
  const previewPlayer = useAudioPlayer({ uri: recordedUri }, { updateInterval: 100 });
  const previewStatus = useAudioPlayerStatus(previewPlayer);
  const previewPlaying = !!(previewStatus?.playing ?? previewStatus?.isPlaying);
  const previewDur = (previewStatus?.duration && previewStatus.duration > 0)
    ? previewStatus.duration
    : durationMs / 1000;
  const previewCur = previewStatus?.currentTime || 0;
  const previewProgress = previewDur > 0 ? Math.min(1, previewCur / previewDur) : 0;

  const togglePreview = useCallback(() => {
    if (!previewPlayer) return;
    if (previewPlaying) previewPlayer.pause();
    else { previewPlayer.seekTo(0); previewPlayer.play(); }
  }, [previewPlayer, previewPlaying]);

  const fmt = (ms) => {
    const sec = Math.max(0, Math.floor((ms || 0) / 1000));
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  };

  return (
    <View style={recStyles.previewWrap}>
      <Text style={recStyles.title}>试听这段声音</Text>
      <Text style={recStyles.sub}>满意就发送，不满意可以重录</Text>

      <View style={recStyles.envelope}>
        <View style={recStyles.flap} />
        <View style={recStyles.seal}>
          <Ionicons name="volume-medium-outline" size={24} color="#FFFFFF" />
        </View>
        <View style={recStyles.previewBody}>
          <VoiceWaveform
            points={waveform}
            progress={previewProgress}
            playing={previewPlaying}
            height={56}
          />
          <View style={recStyles.progressTrack}>
            <View style={[recStyles.progressFill, { width: `${previewProgress * 100}%` }]} />
          </View>
          <View style={recStyles.timeRow}>
            <Text style={recStyles.timeText}>{fmt(previewCur * 1000)}</Text>
            <Text style={recStyles.timeText}>{fmt(durationMs)}</Text>
          </View>
          <TouchableOpacity
            style={recStyles.playBtn}
            onPress={togglePreview}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={previewPlaying ? '暂停试听' : '播放试听'}
          >
            <Ionicons name={previewPlaying ? 'pause' : 'play'} size={20} color="#FFFFFF" />
            <Text style={recStyles.playBtnText}>{previewPlaying ? '暂停' : '试听'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={recStyles.actionRow}>
        <Button variant="secondary" size="medium" onPress={onReRecord} iconLeft="refresh-outline">
          重录
        </Button>
        <Button
          variant="primary"
          size="medium"
          onPress={onSend}
          loading={sending}
          disabled={sending}
          iconRight="send-outline"
          style={{ flex: 1, marginLeft: spacing[2] }}
        >
          {sending ? '发送中…' : '发送'}
        </Button>
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// 样式
// ═══════════════════════════════════════════════════════
const idleStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[6] },
  title: { ...typography.sectionTitle, color: colors.textPrimary, marginTop: spacing[5] },
  count: { ...typography.body, color: colors.textSecondary, marginTop: spacing[2], textAlign: 'center' },
  hint: { ...typography.body, color: colors.textSecondary, marginTop: spacing[4] },
  tip: { ...typography.caption, color: colors.textMuted, marginTop: spacing[4] },
});

const recStyles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: spacing[5], paddingTop: spacing[6], alignItems: 'center' },
  title: { ...typography.sectionTitle, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textMuted, marginTop: spacing[1], textAlign: 'center' },
  waveBox: {
    width: '100%',
    marginTop: spacing[6],
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.soft,
  },
  timer: {
    ...typography.pageTitle,
    color: colors.primaryAction,
    marginTop: spacing[4],
    fontVariant: ['tabular-nums'],
  },
  recordBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primaryAction,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[6],
    ...shadows.floating,
  },
  recordBtnActive: { backgroundColor: colors.error },
  recordHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing[3] },

  previewWrap: { width: '100%', alignItems: 'center', paddingTop: spacing[4] },
  envelope: {
    width: '100%',
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary[200],
    overflow: 'hidden',
    marginTop: spacing[5],
    ...shadows.medium,
  },
  flap: { height: 40, backgroundColor: colors.primary[100], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.primary[200] },
  seal: {
    position: 'absolute', top: 20, alignSelf: 'center',
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primaryAction,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.surface,
  },
  previewBody: { paddingHorizontal: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[4] },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.primary[100], overflow: 'hidden', marginTop: spacing[2] },
  progressFill: { height: '100%', backgroundColor: colors.primaryAction, borderRadius: 2 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing[1] },
  timeText: { ...typography.caption, color: colors.textMuted },
  playBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center',
    paddingVertical: spacing[2] + 2, paddingHorizontal: spacing[5],
    borderRadius: radius.pill, backgroundColor: colors.primaryAction, marginTop: spacing[3],
  },
  playBtnText: { ...typography.bodyMedium, color: '#FFFFFF', marginLeft: spacing[2], fontWeight: '600' },
  actionRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing[6], width: '100%' },
  sendOverlay: { position: 'absolute', top: '35%', left: 0, right: 0, alignItems: 'center' },
  flyEnvelope: { alignItems: 'center', justifyContent: 'center' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLavender },
  body: { flex: 1, position: 'relative' },
  modeToggle: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[1] },
  modeToggleText: { ...typography.caption, color: colors.primaryAction, fontWeight: '600' },
  toastWrap: { position: 'absolute', bottom: spacing[10], left: 0, right: 0, alignItems: 'center' },
  toast: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing[2] + 2, paddingHorizontal: spacing[4],
    borderRadius: radius.pill, ...shadows.medium,
  },
  toastText: { ...typography.bodyMedium, color: colors.primaryAction, marginLeft: spacing[2], fontWeight: '600' },
});
