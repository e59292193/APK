import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../../theme';

// ─── 声音波形 ───
// points: number[]  归一化 [0..1] 波形点
// progress: 0..1    播放进度（按真实播放位置着色）
// recording: bool   录音时整体轻微脉动
export default function VoiceWaveform({
  points = [],
  progress = 0,
  recording = false,
  playing = false,
  height = 64,
  activeColor = colors.primaryAction,
  mutedColor = colors.primary[200],
  style,
}) {
  const bars = useMemo(() => {
    const len = points.length || 40;
    const src = points.length ? points : new Array(len).fill(0.08);
    // 补齐到固定长度，避免数据过短时跳动
    const out = [];
    for (let i = 0; i < len; i++) {
      out.push(src[i % src.length] || 0.08);
    }
    return out;
  }, [points]);

  const playIdx = Math.floor(progress * bars.length);

  return (
    <View style={[styles.container, { height }, style]}>
      {bars.map((v, i) => {
        const isActive = playing && i <= playIdx;
        const barH = Math.max(4, v * height);
        return (
          <View
            key={i}
            style={[
              styles.bar,
              {
                height: barH,
                backgroundColor: isActive ? activeColor : mutedColor,
                opacity: recording ? 0.85 : isActive ? 1 : 0.7,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    width: '100%',
  },
  bar: {
    flex: 1,
    maxWidth: 6,
    borderRadius: 3,
  },
});
