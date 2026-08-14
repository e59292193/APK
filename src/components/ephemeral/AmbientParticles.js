import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors } from '../../theme';

// ─── 轻量环境粒子：缓慢漂浮的光点 / 纸屑 ───
// 仅动画 transform/opacity，使用 useNativeDriver，避免每帧 JS 更新。
// active=false 时停止动画，节省电量与内存。
export default function AmbientParticles({
  active = true,
  count = 14,
  colorPalette = [colors.primary[200], colors.mint[200], colors.primary[100]],
  reduceMotion = false,
}) {
  // 一次性生成粒子参数（避免每次渲染随机）
  const particles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        id: i,
        left: Math.random() * 100,
        top: 10 + Math.random() * 80,
        size: 4 + Math.random() * 8,
        duration: 6000 + Math.random() * 6000,
        delay: Math.random() * 4000,
        drift: (Math.random() - 0.5) * 30,
        color: colorPalette[i % colorPalette.length],
        opacity: 0.3 + Math.random() * 0.4,
      });
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  // 每个粒子一个 Animated.Value
  const anims = useRef(particles.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!active) {
      anims.forEach((a) => a.stopAnimation());
      return;
    }
    // Reduce Motion：不做持续漂浮，仅静态淡入
    const subs = anims.map((a, i) => {
      if (reduceMotion) {
        Animated.timing(a, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
        return null;
      }
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(a, { toValue: 1, duration: particles[i].duration, useNativeDriver: true }),
          Animated.timing(a, { toValue: 0, duration: particles[i].duration, useNativeDriver: true }),
        ])
      );
      const timer = setTimeout(() => loop.start(), particles[i].delay);
      return () => { clearTimeout(timer); loop.stop(); };
    });
    return () => {
      subs.forEach((s) => s && s());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduceMotion]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((p, i) => {
        const a = anims[i];
        const translateY = a.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -28 - (p.size % 10)],
        });
        const translateX = a.interpolate({
          inputRange: [0, 1],
          outputRange: [0, p.drift],
        });
        const opacity = a.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, p.opacity, 0],
        });
        return (
          <Animated.View
            key={p.id}
            style={[
              styles.particle,
              {
                left: `${p.left}%`,
                top: `${p.top}%`,
                width: p.size,
                height: p.size,
                borderRadius: p.size / 2,
                backgroundColor: p.color,
                opacity: reduceMotion ? p.opacity : opacity,
                transform: reduceMotion ? [] : [{ translateY }, { translateX }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  particle: {
    position: 'absolute',
  },
});
