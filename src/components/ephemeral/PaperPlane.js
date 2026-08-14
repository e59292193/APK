import React from 'react';
import Svg, { Path, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors } from '../../theme';

// ─── 纸飞机（纯 SVG 绘制，无图片资源）───
// 仅做呈现；位移/旋转/缩放由父级 Animated.View 控制。
export default function PaperPlane({ size = 120, style }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={style}>
      <Defs>
        <LinearGradient id="ppBody" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.surface} />
          <Stop offset="1" stopColor={colors.primary[100]} />
        </LinearGradient>
        <LinearGradient id="ppWing" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.primary[200]} />
          <Stop offset="1" stopColor={colors.primary[300]} />
        </LinearGradient>
      </Defs>

      {/* 右翼（亮） */}
      <Path d="M50 6 L90 78 L50 62 Z" fill="url(#ppBody)" />
      {/* 左翼（暗，模拟折叠立体感） */}
      <Path d="M50 6 L10 78 L50 62 Z" fill="url(#ppWing)" />
      {/* 中线折痕 */}
      <Line
        x1="50"
        y1="6"
        x2="50"
        y2="62"
        stroke={colors.primary[400]}
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      {/* 尾部细节 */}
      <Path d="M50 62 L40 74 L50 70 L60 74 Z" fill={colors.primary[200]} opacity="0.7" />
    </Svg>
  );
}
