import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PaperPlane from './PaperPlane';
import { colors, typography, spacing, radius, shadows } from '../../theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// 信纸样式（仅 ID + 颜色，不存 HTML）
const PAPER_STYLES = {
  lavender: { bg: colors.surface, accent: colors.primary[100], edge: colors.primary[200] },
  mint: { bg: '#F6FBF8', accent: colors.mint[100], edge: colors.mint[200] },
  cream: { bg: '#FFFCF6', accent: '#FFF6E2', edge: colors.amber[100] },
  rose: { bg: '#FFFBFC', accent: colors.coral[100], edge: colors.coral[400] },
};

function getPaperStyle(id) {
  return PAPER_STYLES[id] || PAPER_STYLES.lavender;
}

// ─── NoteRevealScene ───
// 接收一张已 claim 的纸条，内部驱动：飞入 → 落地 → 展开 → 阅读 → 飞走
// 通过 ref 暴露 flyAway()，供 Android 返回键 / 页面关闭统一调用。
const NoteRevealScene = forwardRef(function NoteRevealScene(
  { note, reduceMotion = false, onConsumed, onFlyAwayStart },
  ref
) {
  // 内部视觉相位
  const [phase, setPhase] = useState('arriving'); // arriving|landed|unfolding|reading|flying
  const mountedRef = useRef(true);

  const arrive = useRef(new Animated.Value(0)).current;
  const unfold = useRef(new Animated.Value(0)).current;
  const fly = useRef(new Animated.Value(0)).current;
  const pendingFlyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ─── 飞入动画 ───
  useEffect(() => {
    if (reduceMotion) {
      Animated.timing(arrive, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        if (mountedRef.current) {
          setPhase('landed');
          if (pendingFlyRef.current) startFlyAway();
        }
      });
      return;
    }
    Animated.timing(arrive, {
      toValue: 1,
      duration: 1050,
      easing: Easing.bezier(0.22, 0.61, 0.36, 1),
      useNativeDriver: true,
    }).start(() => {
      if (!mountedRef.current) return;
      // 轻微落地 spring（不剧烈）
      Animated.spring(arrive, {
        toValue: 1.02,
        friction: 8,
        tension: 60,
        useNativeDriver: true,
      }).start(() => {
        if (!mountedRef.current) return;
        arrive.setValue(1);
        setPhase('landed');
        if (pendingFlyRef.current) startFlyAway();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 点击纸飞机展开 ───
  const handleTapPlane = useCallback(() => {
    if (phase !== 'landed') return;
    setPhase('unfolding');
    Animated.timing(unfold, {
      toValue: 1,
      duration: reduceMotion ? 200 : 480,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (mountedRef.current) setPhase('reading');
    });
  }, [phase, reduceMotion, unfold]);

  // ─── 飞走动画 ───
  const startFlyAway = useCallback(() => {
    if (!mountedRef.current) return;
    setPhase('flying');
    // 飞走开始即通知父级触发消费（DB 标记），避免动画中断导致未消费
    onFlyAwayStart && onFlyAwayStart();
    Animated.timing(fly, {
      toValue: 1,
      duration: reduceMotion ? 200 : 850,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (mountedRef.current) onConsumed && onConsumed();
    });
  }, [fly, onConsumed, onFlyAwayStart, reduceMotion]);

  // 暴露给父级：返回键 / 关闭页 时统一“让它飞走”
  useImperativeHandle(ref, () => ({
    flyAway: () => {
      if (phase === 'arriving') {
        pendingFlyRef.current = true; // 等落地后立即飞走
        return;
      }
      if (phase === 'flying') return;
      startFlyAway();
    },
    hasShownContent: () => phase === 'reading' || phase === 'unfolding' || phase === 'flying',
  }), [phase, startFlyAway]);

  // ─── 插值 ───
  // 飞机飞入弧线
  const planeX = arrive.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [-SCREEN_W * 0.55, SCREEN_W * 0.12, 0],
  });
  const planeY = arrive.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [SCREEN_H * 0.4, -70, 0],
  });
  const planeRotate = arrive.interpolate({
    inputRange: [0, 0.4, 0.7, 1],
    outputRange: ['12deg', '-6deg', '2deg', '0deg'],
  });
  const planeScale = arrive.interpolate({
    inputRange: [0, 0.7, 0.9, 1],
    outputRange: [0.55, 1.03, 0.98, 1],
  });
  const arriveOpacity = arrive.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0, 1, 1],
  });
  // 展开后飞机淡出：到达透明度 × 展开淡出系数（不可把 Animated.Value 放进 outputRange）
  const unfoldFade = unfold.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [1, 1, 0],
  });
  const planeOpacity = Animated.multiply(arriveOpacity, unfoldFade);

  // 信纸展开
  const letterScaleY = unfold.interpolate({
    inputRange: [0, 1],
    outputRange: [0.08, 1],
  });
  const letterRotateX = unfold.interpolate({
    inputRange: [0, 1],
    outputRange: ['70deg', '0deg'],
  });
  const letterOpacity = unfold.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [0, 0.2, 1],
  });
  // 文字在展开完成后才淡入（折叠过程不暴露正文）
  const contentOpacity = unfold.interpolate({
    inputRange: [0, 0.6, 1],
    outputRange: [0, 0, 1],
  });

  // 飞走
  const flyY = fly.interpolate({ inputRange: [0, 1], outputRange: [0, -150] });
  const flyX = fly.interpolate({ inputRange: [0, 1], outputRange: [0, 90] });
  const flyRotate = fly.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '8deg'] });
  const flyScale = fly.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] });
  const flyOpacity = fly.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 0.9, 0] });
  const flyContentOpacity = fly.interpolate({
    inputRange: [0, 0.45],
    outputRange: [1, 0],
  });

  const paper = getPaperStyle(note?.paper_style);
  const isFlying = phase === 'flying';
  const canTapPlane = phase === 'landed';

  return (
    <View style={styles.stage} accessibilityLabel="小纸条展示区">
      {/* 纸飞机（飞入 + 落地） */}
      <Animated.View
        pointerEvents={canTapPlane ? 'auto' : 'none'}
        style={[
          styles.planeWrap,
          {
            transform: [
              { translateX: planeX },
              { translateY: planeY },
              { rotate: planeRotate },
              { scale: planeScale },
            ],
            opacity: planeOpacity,
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleTapPlane}
          disabled={!canTapPlane}
          accessibilityRole="button"
          accessibilityLabel={canTapPlane ? '纸飞机已送达，点击展开' : '纸飞机飞行中'}
          style={styles.planeHit}
        >
          <PaperPlane size={132} />
        </TouchableOpacity>
      </Animated.View>

      {/* 信纸（展开 + 阅读 + 飞走） */}
      <Animated.View
        pointerEvents={phase === 'reading' ? 'auto' : 'none'}
        style={[
          styles.letterWrap,
          {
            opacity: Animated.multiply(letterOpacity, flyOpacity),
            transform: [
              { perspective: 900 },
              { rotateX: letterRotateX },
              { scaleY: letterScaleY },
              { translateX: flyX },
              { translateY: flyY },
              { rotate: flyRotate },
              { scale: flyScale },
            ],
          },
        ]}
      >
        <View style={[styles.letter, { backgroundColor: paper.bg, borderColor: paper.edge }]}>
          {/* 信纸顶部装饰条 */}
          <View style={[styles.letterTop, { backgroundColor: paper.accent }]} />
          {/* 折痕细节 */}
          <FoldLines color={paper.edge} />

          <View style={styles.letterHeader}>
            <Ionicons name="mail-open-outline" size={18} color={colors.primary[400]} />
            <Text style={styles.letterFrom}>来自 {note?.sender_id} 的纸条</Text>
          </View>

          {/* 正文（滚动，避免长文本被遮挡） */}
          <Animated.View style={{ flex: 1, opacity: Animated.multiply(contentOpacity, flyContentOpacity) }}>
            <ScrollView
              style={styles.contentScroll}
              contentContainerStyle={styles.contentInner}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.contentText}>{note?.content}</Text>
            </ScrollView>
          </Animated.View>

          {/* 飞走按钮 */}
          {phase === 'reading' && (
            <TouchableOpacity
              style={styles.flyBtn}
              onPress={startFlyAway}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="看完了，让它飞走"
            >
              <Ionicons name="paper-plane-outline" size={16} color={colors.primaryAction} />
              <Text style={styles.flyBtnText}>看完了，让它飞走</Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {/* 飞走时的纸屑光点 */}
      {isFlying && <ScatterBits color={paper.edge} reduceMotion={reduceMotion} />}
    </View>
  );
});

// ─── 信纸折痕细节 ───
function FoldLines({ color }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.foldLine, { top: 38, backgroundColor: color }]} />
      <View style={[styles.foldLine, { bottom: 70, backgroundColor: color, opacity: 0.5 }]} />
    </View>
  );
}

// ─── 飞走时的纸屑（自包含动画）───
function ScatterBits({ color, reduceMotion }) {
  const anims = useRef(Array.from({ length: 6 }, () => new Animated.Value(0))).current;
  useEffect(() => {
    anims.forEach((a, i) => {
      Animated.timing(a, {
        toValue: 1,
        duration: reduceMotion ? 200 : 800,
        delay: i * 40,
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
            styles.bit,
            {
              backgroundColor: color,
              left: `${20 + i * 12}%`,
              top: '45%',
              opacity: a.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.7, 0.5, 0] }),
              transform: [
                { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -120 - i * 10] }) },
                { translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, 60 + (i % 3) * 20] }) },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planeWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planeHit: {
    padding: spacing[3],
  },
  letterWrap: {
    width: '86%',
    maxHeight: '74%',
    ...shadows.floating,
  },
  letter: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  letterTop: {
    height: 10,
    width: '100%',
  },
  letterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  letterFrom: {
    ...typography.caption,
    color: colors.primary[600],
    marginLeft: spacing[2],
    fontWeight: '600',
  },
  contentScroll: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2],
    paddingBottom: spacing[5],
  },
  contentText: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 26,
  },
  flyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingVertical: spacing[2] + 2,
    paddingHorizontal: spacing[4],
    borderRadius: radius.pill,
    backgroundColor: colors.primary[50],
    marginVertical: spacing[3],
  },
  flyBtnText: {
    ...typography.bodyMedium,
    color: colors.primaryAction,
    marginLeft: spacing[2],
    fontWeight: '600',
  },
  foldLine: {
    position: 'absolute',
    left: spacing[4],
    right: spacing[4],
    height: StyleSheet.hairlineWidth,
    opacity: 0.6,
  },
  bit: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});

export default NoteRevealScene;
