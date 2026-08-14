import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useMemo, useCallback } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import VoiceWaveform from './VoiceWaveform';
import { colors, typography, spacing, radius, shadows } from '../../theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── VoiceLetterScene ───
// 接收一段已 claim 的语音 + 短时 signed URL，内部驱动：
// 飞入 → 就绪 → 播放/暂停 → 播放完成 → 漂浮消散
// ref.flyAway(): 返回键 / 关闭页统一处理
//   - 已开始播放 → 消费（onConsumed）
//   - 未开始播放 → 释放 claim（onRelease）
const VoiceLetterScene = forwardRef(function VoiceLetterScene(
  { voice, signedUrl, signedUrlError, reduceMotion = false, onConsumed, onConsumeStart, onRelease },
  ref
) {
  const [phase, setPhase] = useState('arriving'); // arriving|ready|playing|paused|completed|flying
  const mountedRef = useRef(true);
  const hasStartedRef = useRef(false);   // 是否真的开始播放过
  const handledFinishRef = useRef(false);
  const handledErrorRef = useRef(false);

  const arrive = useRef(new Animated.Value(0)).current;
  const fly = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;
  const arrivalDoneRef = useRef(false);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // 音频源（仅在 signedUrl 就绪后创建播放器）
  const source = useMemo(() => (signedUrl ? { uri: signedUrl } : null), [signedUrl]);
  const player = useAudioPlayer(source, { updateInterval: 100, downloadFirst: true });
  const status = useAudioPlayerStatus(player);

  const isLoaded = !!status?.isLoaded;
  const isPlaying = !!(status?.playing ?? status?.isPlaying);
  const isBuffering = !!status?.isBuffering;
  const audioError = status?.error;
  const didJustFinish = !!status?.didJustFinish;
  // 时间（秒）。duration 未就绪时用 DB 里的 duration_ms 兜底
  const durationSec = status?.duration && status.duration > 0
    ? status.duration
    : (voice?.duration_ms || 0) / 1000;
  const currentSec = status?.currentTime || 0;
  const progress = durationSec > 0 ? Math.min(1, currentSec / durationSec) : 0;
  const waveformPts = Array.isArray(voice?.waveform) && voice.waveform.length
    ? voice.waveform
    : null;

  // ─── 飞入动画 ───
  useEffect(() => {
    Animated.timing(arrive, {
      toValue: 1,
      duration: reduceMotion ? 200 : 950,
      easing: Easing.bezier(0.22, 0.61, 0.36, 1),
      useNativeDriver: true,
    }).start(() => {
      if (!mountedRef.current) return;
      Animated.spring(arrive, { toValue: 1.03, friction: 8, tension: 60, useNativeDriver: true }).start(() => {
        if (!mountedRef.current) return;
        arrive.setValue(1);
        arrivalDoneRef.current = true;
        if (isLoaded && mountedRef.current) setPhase('ready');
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 涟漪：就绪前持续扩散 ───
  useEffect(() => {
    if (phase === 'playing' || phase === 'completed' || phase === 'flying') return;
    const loop = Animated.loop(
      Animated.timing(ripple, { toValue: 1, duration: 2200, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [phase, ripple]);

  // ─── 加载就绪 → ready ───
  useEffect(() => {
    if (isLoaded && arrivalDoneRef.current && phase === 'arriving' && mountedRef.current) {
      setPhase('ready');
    }
  }, [isLoaded, phase]);

  // ─── signedUrl 加载失败 → 释放 claim（不消费）───
  useEffect(() => {
    if (signedUrlError && !handledErrorRef.current) {
      handledErrorRef.current = true;
      onRelease && onRelease();
    }
  }, [signedUrlError, onRelease]);

  // ─── 音频加载/播放错误 → 释放 claim（不消费）───
  useEffect(() => {
    if (audioError && !handledErrorRef.current) {
      handledErrorRef.current = true;
      onRelease && onRelease();
    }
  }, [audioError, onRelease]);

  // ─── 播放完成 → 消散 ───
  useEffect(() => {
    if (didJustFinish && !handledFinishRef.current) {
      handledFinishRef.current = true;
      if (mountedRef.current) setPhase('completed');
      startFlyAway();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didJustFinish]);

  // ─── 播放控制 ───
  const handlePlay = useCallback(() => {
    if (!isLoaded || phase === 'flying' || phase === 'completed') return;
    hasStartedRef.current = true;
    setPhase('playing');
    player.play();
  }, [isLoaded, phase, player]);

  const handlePause = useCallback(() => {
    if (phase !== 'playing') return;
    player.pause();
    if (mountedRef.current) setPhase('paused');
  }, [phase, player]);

  // ─── 消散动画 ───
  const startFlyAway = useCallback(() => {
    if (!mountedRef.current) return;
    try { player.pause(); } catch (e) {}
    setPhase('flying');
    // 消散开始即触发 DB 消费（含 Storage 删除），避免动画中断导致未消费
    onConsumeStart && onConsumeStart();
    Animated.timing(fly, {
      toValue: 1,
      duration: reduceMotion ? 200 : 900,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (mountedRef.current) onConsumed && onConsumed();
    });
  }, [fly, onConsumed, onConsumeStart, player, reduceMotion]);

  // ─── 暴露给父级 ───
  useImperativeHandle(ref, () => ({
    flyAway: () => {
      if (phase === 'flying' || phase === 'completed') return;
      if (hasStartedRef.current) {
        // 已开始播放 → 阅后即逝，消费
        startFlyAway();
      } else {
        // 未开始播放 → 释放 claim，回到待抽取池
        onRelease && onRelease();
      }
    },
    hasStarted: () => hasStartedRef.current,
  }), [phase, startFlyAway, onRelease]);

  // ─── 插值 ───
  const envX = arrive.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-SCREEN_W * 0.5, SCREEN_W * 0.1, 0] });
  const envY = arrive.interpolate({ inputRange: [0, 0.5, 1], outputRange: [SCREEN_H * 0.35, -60, 0] });
  const envRotate = arrive.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['14deg', '-5deg', '0deg'] });
  const envScale = arrive.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.6, 1.03, 1] });
  const envOpacity = arrive.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] });

  const flyY = fly.interpolate({ inputRange: [0, 1], outputRange: [0, -170] });
  const flyScale = fly.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });
  const flyOpacity = fly.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.8, 0] });

  const ripple1 = ripple.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.6] });
  const ripple1Op = ripple.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] });
  const ripple2 = ripple.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.2] });
  const ripple2Op = ripple.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] });

  const canPlay = phase === 'ready' || phase === 'paused';
  const isFlying = phase === 'flying';

  // 时间格式 m:ss
  const fmt = (s) => {
    const sec = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.stage} accessibilityLabel="语音信箱展示区">
      <Animated.View
        style={[
          styles.envelopeWrap,
          {
            transform: [
              { translateX: envX },
              { translateY: envY },
              { rotate: envRotate },
              { scale: envScale },
              { translateY: flyY },
              { scale: flyScale },
            ],
            opacity: Animated.multiply(envOpacity, flyOpacity),
          },
        ]}
      >
        {/* 涟漪 */}
        {(phase === 'arriving' || phase === 'ready' || phase === 'paused') && (
          <View style={styles.rippleLayer} pointerEvents="none">
            <Animated.View style={[styles.ripple, { transform: [{ scale: ripple1 }], opacity: ripple1Op }]} />
            <Animated.View style={[styles.ripple, { transform: [{ scale: ripple2 }], opacity: ripple2Op }]} />
          </View>
        )}

        <View style={styles.envelope}>
          {/* 信封盖 */}
          <View style={styles.flap} />
          {/* 蜡封 + 声音图标 */}
          <View style={styles.seal}>
            <Ionicons name="volume-medium-outline" size={26} color="#FFFFFF" />
          </View>

          {/* 播放区 */}
          <View style={styles.playerArea}>
            <Text style={styles.fromText}>来自 {voice?.sender_id} 的声音信封</Text>

            {waveformPts ? (
              <VoiceWaveform
                points={waveformPts}
                progress={progress}
                playing={isPlaying}
                height={56}
                style={styles.wave}
              />
            ) : (
              <VoiceWaveform points={[]} progress={progress} playing={isPlaying} height={56} style={styles.wave} />
            )}

            {/* 进度条 */}
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>

            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{fmt(currentSec)}</Text>
              <Text style={styles.timeText}>{fmt(durationSec)}</Text>
            </View>

            {/* 播放/暂停 按钮 */}
            <View style={styles.controlRow}>
              {phase === 'arriving' && !isLoaded && (
                <Text style={styles.hintText}>声音正在赶来…</Text>
              )}
              {isBuffering && phase === 'playing' && (
                <Text style={styles.hintText}>缓冲中…</Text>
              )}
              {canPlay && (
                <TouchableOpacity
                  style={styles.playBtn}
                  onPress={handlePlay}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="播放语音"
                >
                  <Ionicons name="play" size={22} color="#FFFFFF" />
                  <Text style={styles.playBtnText}>点击播放</Text>
                </TouchableOpacity>
              )}
              {phase === 'playing' && (
                <TouchableOpacity
                  style={styles.playBtn}
                  onPress={handlePause}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="暂停语音"
                >
                  <Ionicons name="pause" size={22} color="#FFFFFF" />
                  <Text style={styles.playBtnText}>暂停</Text>
                </TouchableOpacity>
              )}
              {phase === 'completed' && (
                <Text style={styles.hintText}>声音已飘远…</Text>
              )}
            </View>

            <Text style={styles.noteText}>播放结束后将自动飘走，无法重播</Text>
          </View>
        </View>
      </Animated.View>

      {/* 消散光点 */}
      {isFlying && <ScatterLights reduceMotion={reduceMotion} />}
    </View>
  );
});

// ─── 消散光点 ───
function ScatterLights({ reduceMotion }) {
  const anims = useRef(Array.from({ length: 8 }, () => new Animated.Value(0))).current;
  useEffect(() => {
    anims.forEach((a, i) => {
      Animated.timing(a, {
        toValue: 1,
        duration: reduceMotion ? 200 : 850,
        delay: i * 35,
        useNativeDriver: true,
      }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={[
            styles.light,
            {
              left: `${30 + (i % 4) * 14}%`,
              top: '46%',
              opacity: a.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.8, 0.6, 0] }),
              transform: [
                { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -140 - (i % 3) * 20] }) },
                { translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, (i % 2 ? 1 : -1) * (30 + i * 8)] }) },
                { scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  envelopeWrap: { width: '88%', alignItems: 'center', justifyContent: 'center', ...shadows.floating },
  rippleLayer: { position: 'absolute', width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  ripple: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1.5,
    borderColor: colors.primary[300],
  },
  envelope: {
    width: '100%',
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary[200],
    overflow: 'hidden',
  },
  flap: {
    height: 46,
    backgroundColor: colors.primary[100],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.primary[200],
  },
  seal: {
    position: 'absolute',
    top: 24,
    alignSelf: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primaryAction,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
    ...shadows.medium,
  },
  playerArea: { paddingHorizontal: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[4] },
  fromText: {
    ...typography.caption,
    color: colors.primary[600],
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: spacing[3],
  },
  wave: { marginVertical: spacing[2] },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary[100],
    overflow: 'hidden',
    marginTop: spacing[2],
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primaryAction,
    borderRadius: 2,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing[1],
  },
  timeText: { ...typography.caption, color: colors.textMuted },
  controlRow: { alignItems: 'center', marginTop: spacing[3], minHeight: 48 },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2] + 2,
    paddingHorizontal: spacing[5],
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAction,
  },
  playBtnText: {
    ...typography.bodyMedium,
    color: '#FFFFFF',
    marginLeft: spacing[2],
    fontWeight: '600',
  },
  hintText: { ...typography.bodyMedium, color: colors.textSecondary },
  noteText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing[3],
  },
  light: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.amber[400],
  },
});

export default VoiceLetterScene;
