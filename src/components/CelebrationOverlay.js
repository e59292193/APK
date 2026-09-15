import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, Easing, Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, useTheme } from '../theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const EMOJIS = ['✨', '⭐'];
const COUNT = 24;

export default function CelebrationOverlay({ visible, onClose }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const palette = useMemo(() => [colors.primary, colors.accent, colors.success, colors.warning, colors.info, colors.partner], [colors]);
  const particleData = useRef(null);
  if (!particleData.current) {
    particleData.current = Array.from({ length: COUNT }, (_, index) => ({
      index, colorIndex: index % 6, emoji: EMOJIS[index % EMOJIS.length], isEmoji: index % 6 === 0,
      fontSize: 16 + Math.random() * 20, startX: Math.random() * SCREEN_WIDTH,
      endY: SCREEN_HEIGHT + 60, duration: 1200 + Math.random() * 800, delay: Math.random() * 300,
      rotation: (Math.random() - 0.5) * 720, translateY: new Animated.Value(-50), translateX: new Animated.Value(0), rotate: new Animated.Value(0), opacity: new Animated.Value(0), scale: new Animated.Value(0.3),
    }));
    particleData.current.forEach((p) => { p.endX = p.startX + (Math.random() - 0.5) * 200; p.translateX.setValue(p.startX); });
  }
  const particles = particleData.current;
  const textScale = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return undefined;
    particles.forEach((p) => { p.translateY.setValue(-50); p.translateX.setValue(p.startX); p.rotate.setValue(0); p.opacity.setValue(0); p.scale.setValue(0.3); });
    textScale.setValue(0); textOpacity.setValue(0);
    const animations = particles.map((p) => Animated.parallel([
      Animated.timing(p.translateY, { toValue: p.endY, duration: p.duration, delay: p.delay, easing: Easing.bezier(0.25, 0.46, 0.45, 0.94), useNativeDriver: true }),
      Animated.timing(p.translateX, { toValue: p.endX, duration: p.duration, delay: p.delay, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(p.rotate, { toValue: p.rotation, duration: p.duration, delay: p.delay, easing: Easing.linear, useNativeDriver: true }),
      Animated.sequence([Animated.timing(p.opacity, { toValue: 1, duration: 200, delay: p.delay, useNativeDriver: true }), Animated.timing(p.opacity, { toValue: 0, duration: Math.max(p.duration - 400, 200), delay: 200, useNativeDriver: true })]),
      Animated.sequence([Animated.timing(p.scale, { toValue: 1, duration: 250, delay: p.delay, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true }), Animated.timing(p.scale, { toValue: 0.5, duration: Math.max(p.duration - 300, 200), delay: 100, useNativeDriver: true })]),
    ]));
    const textAnimation = Animated.parallel([Animated.spring(textScale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }), Animated.timing(textOpacity, { toValue: 1, duration: 300, useNativeDriver: true })]);
    Animated.parallel([...animations, textAnimation]).start();
    const timer = setTimeout(() => Animated.timing(textOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => onClose?.()), 1500);
    return () => clearTimeout(timer);
  }, [visible, onClose, particles, textOpacity, textScale]);
  if (!visible) return null;

  return <Modal visible transparent animationType="none" statusBarTranslucent>
    <View style={styles.container}>
      {particles.map((p) => {
        const rotate = p.rotate.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });
        const transform = [{ translateX: p.translateX }, { translateY: p.translateY }, { scale: p.scale }, { rotate }];
        return p.isEmoji ? <Animated.Text key={p.index} style={[styles.particle, { fontSize: p.fontSize, transform, opacity: p.opacity }]}>{p.emoji}</Animated.Text> : <Animated.View key={p.index} style={[styles.confetti, { width: p.fontSize, height: p.fontSize * 0.6, backgroundColor: palette[p.colorIndex], transform, opacity: p.opacity }]} />;
      })}
      <Animated.View style={[styles.text, { transform: [{ scale: textScale }], opacity: textOpacity }]}><Ionicons name="sparkles" size={44} color={colors.accent} /><Text style={styles.title}>点亮了一颗星星！</Text><Text style={styles.subtitle}>又一个愿望变成了现实</Text></Animated.View>
    </View>
  </Modal>;
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.overlay, justifyContent: 'center', alignItems: 'center' }, particle: { position: 'absolute', top: -50 }, confetti: { position: 'absolute', top: -50, borderRadius: 2 }, text: { alignItems: 'center' },
  title: { ...typography.sectionTitle, color: c.textOnPrimary, marginTop: spacing[2], marginBottom: spacing[1], textShadowColor: c.shadow, textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 }, subtitle: { ...typography.body, color: c.textOnPrimary },
});
