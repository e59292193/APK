/**
 * CelebrationOverlay — full-screen confetti animation when a wish is completed.
 * Pure RN Animated, no third-party dependencies.
 *
 * Renders themed confetti particles (lavender / mint / coral / amber) with a
 * few emoji sparks falling from the top with random positions, durations, and
 * rotations. Auto-dismisses after 1.5s.
 */
import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, Animated, StyleSheet, Dimensions, Easing, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Confetti palette — theme tokens (lavender, mint, coral, amber)
const PARTICLE_COLORS = [
  colors.primary[400],
  colors.primary[500],
  colors.mint[400],
  colors.mint[500],
  colors.coral[400],
  colors.coral[500],
  colors.amber[400],
  colors.amber[500],
];

// Minimal emoji sparks (kept small to reduce emoji usage)
const PARTICLE_EMOJIS = ['✨', '⭐'];
const PARTICLE_COUNT = 24;

export default function CelebrationOverlay({ visible, onClose }) {
  // Create all Animated.Value instances via useRef (hooks at top level — safe)
  const particleData = useRef(null);
  if (particleData.current === null) {
    particleData.current = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      index: i,
      emoji: PARTICLE_EMOJIS[i % PARTICLE_EMOJIS.length],
      color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
      // 4 emoji sparks out of 24; rest are colored confetti bits
      isEmoji: i % 6 === 0,
      fontSize: 16 + Math.random() * 20,
      startX: Math.random() * SCREEN_WIDTH,
      endX: 0, // set below
      endY: SCREEN_HEIGHT + 60,
      duration: 1200 + Math.random() * 800,
      delay: Math.random() * 300,
      rotation: (Math.random() - 0.5) * 720,
      translateY: new Animated.Value(-50),
      translateX: new Animated.Value(0),
      rotate: new Animated.Value(0),
      opacity: new Animated.Value(0),
      scale: new Animated.Value(0.3),
    }));
    // Compute endX relative to startX
    particleData.current.forEach(p => {
      p.endX = p.startX + (Math.random() - 0.5) * 200;
      p.translateX.setValue(p.startX);
    });
  }

  const particles = particleData.current;

  // Central text animation
  const textScale = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    // Reset all particle values
    particles.forEach(p => {
      p.translateY.setValue(-50);
      p.translateX.setValue(p.startX);
      p.rotate.setValue(0);
      p.opacity.setValue(0);
      p.scale.setValue(0.3);
    });
    textScale.setValue(0);
    textOpacity.setValue(0);

    // Animate each particle
    const animations = particles.map((p) => {
      return Animated.parallel([
        Animated.timing(p.translateY, {
          toValue: p.endY,
          duration: p.duration,
          delay: p.delay,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
          useNativeDriver: true,
        }),
        Animated.timing(p.translateX, {
          toValue: p.endX,
          duration: p.duration,
          delay: p.delay,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(p.rotate, {
          toValue: p.rotation,
          duration: p.duration,
          delay: p.delay,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(p.opacity, {
            toValue: 1,
            duration: 200,
            delay: p.delay,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(p.opacity, {
            toValue: 0,
            duration: Math.max(p.duration - 400, 200),
            delay: 200,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(p.scale, {
            toValue: 1,
            duration: 250,
            delay: p.delay,
            easing: Easing.out(Easing.back(1.5)),
            useNativeDriver: true,
          }),
          Animated.timing(p.scale, {
            toValue: 0.5,
            duration: Math.max(p.duration - 300, 200),
            delay: 100,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]);
    });

    // Central text: pop in
    const textAnim = Animated.parallel([
      Animated.spring(textScale, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]);

    Animated.parallel([...animations, textAnim]).start();

    // Auto-dismiss after 1.5s
    const timer = setTimeout(() => {
      Animated.timing(textOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        if (onClose) onClose();
      });
    }, 1500);

    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal visible={true} transparent={true} animationType="none" statusBarTranslucent={true}>
      <View style={styles.container}>
        {particles.map((p) => {
          const rotateInterpolate = p.rotate.interpolate({
            inputRange: [0, 360],
            outputRange: ['0deg', '360deg'],
          });
          const transform = [
            { translateX: p.translateX },
            { translateY: p.translateY },
            { scale: p.scale },
            { rotate: rotateInterpolate },
          ];
          if (p.isEmoji) {
            return (
              <Animated.Text
                key={p.index}
                style={[
                  styles.particle,
                  {
                    fontSize: p.fontSize,
                    transform,
                    opacity: p.opacity,
                  },
                ]}
              >
                {p.emoji}
              </Animated.Text>
            );
          }
          return (
            <Animated.View
              key={p.index}
              style={[
                styles.confetti,
                {
                  width: p.fontSize,
                  height: p.fontSize * 0.6,
                  backgroundColor: p.color,
                  transform,
                  opacity: p.opacity,
                },
              ]}
            />
          );
        })}

        <Animated.View
          style={[
            styles.textContainer,
            {
              transform: [{ scale: textScale }],
              opacity: textOpacity,
            },
          ]}
        >
          <View style={styles.iconWrap}>
            <Ionicons name="sparkles" size={44} color={colors.primary[200]} />
          </View>
          <Text style={styles.celebrationTitle}>点亮了一颗星星！</Text>
          <Text style={styles.celebrationSubText}>又一个愿望变成了现实</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  particle: {
    position: 'absolute',
    top: -50,
  },
  confetti: {
    position: 'absolute',
    top: -50,
    borderRadius: 2,
  },
  textContainer: {
    alignItems: 'center',
  },
  iconWrap: {
    marginBottom: spacing[3],
  },
  celebrationTitle: {
    ...typography.sectionTitle,
    color: colors.surface,
    marginBottom: spacing[1],
    textShadowColor: colors.shadow,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  celebrationSubText: {
    ...typography.body,
    color: colors.primary[200],
  },
});
