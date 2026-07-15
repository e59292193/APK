// ═══════════════════════════════════════════════════════
// 弹幕层组件：弹幕从右向左飘过屏幕
// 通过 Supabase Realtime broadcast 同步，无需数据库表
// ═══════════════════════════════════════════════════════

import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { typography, radius } from '../theme';

const DANMAKU_DURATION = 6000; // 弹幕飘过时间（毫秒）
const MAX_VISIBLE = 5; // 最多同时显示条数

/**
 * 单条弹幕
 */
function DanmakuItem({ dm, screenWidth, onEnd }) {
  // 初始位置在屏幕右侧外
  const translateX = useRef(new Animated.Value(screenWidth)).current;

  useEffect(() => {
    // 从右飘到左（屏幕宽度 + 弹幕宽度 ≈ 400）
    const anim = Animated.timing(translateX, {
      toValue: -400,
      duration: DANMAKU_DURATION,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) onEnd(dm.id);
    });
    return () => anim.stop();
  }, []);

  // 颜色：自己发的偏紫，对方发的偏白
  const isSelf = dm.from === 'me';
  return (
    <Animated.View
      style={[
        styles.item,
        { top: dm.topOffset, transform: [{ translateX }] },
      ]}
    >
      <View style={[styles.bubble, isSelf ? styles.bubbleSelf : styles.bubbleOther]}>
        <Text style={styles.text}>{dm.text}</Text>
      </View>
    </Animated.View>
  );
}

/**
 * 弹幕层容器
 * @param {Array} danmakuList - [{ id, text, from, topOffset }]
 * @param {number} screenWidth - 屏幕宽度
 * @param {Function} onDanmakuEnd - 弹幕动画结束回调(id)
 */
export default function DanmakuLayer({ danmakuList, screenWidth, onDanmakuEnd }) {
  // 限制最多显示 MAX_VISIBLE 条，按时间顺序
  const visible = danmakuList.slice(-MAX_VISIBLE);

  return (
    <View style={styles.container} pointerEvents="none">
      {visible.map((dm) => (
        <DanmakuItem
          key={dm.id}
          dm={dm}
          screenWidth={screenWidth}
          onEnd={onDanmakuEnd}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    overflow: 'hidden',
  },
  item: {
    position: 'absolute',
    left: 0,
    flexDirection: 'row',
  },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  bubbleSelf: {
    backgroundColor: 'rgba(140, 105, 202, 0.85)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  bubbleOther: {
    backgroundColor: 'rgba(49, 37, 69, 0.85)',
    borderColor: 'rgba(208, 190, 245, 0.5)',
  },
  text: {
    ...typography.bodyMedium,
    color: '#FFFFFF',
  },
});
