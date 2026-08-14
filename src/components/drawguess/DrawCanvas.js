// ═══════════════════════════════════════════════════════
// DrawCanvas —— 你画我猜画布
//
// 优化点：
//   1. 历史笔画单独放在 memo 层。手指每动一下只会重绘「正在画的那一笔」，
//      不再把已完成的几十条 Path 全部 diff 一遍（这是原来越画越卡的主因）。
//   2. 笔画完成时已预计算 d（withPath），渲染时不再拼字符串。
//   3. 单点笔画用 <Circle> 渲染。原来单点会生成 "M x y" 的 Path，
//      fill="none" 下完全不可见，但 PNG 光栅化又会画出圆点 → 画布与存图不一致。
//   4. 橡皮带用画板色覆盖（画板不透明，效果等同抹除），且与 PNG 导出一致。
// ═══════════════════════════════════════════════════════
import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { strokeToPath } from '../../lib/drawGuessSync';

export const BOARD_COLOR = '#FFFFFF';

function toRgb(color) {
  if (typeof color === 'string') return color;
  const c = color || [33, 33, 33];
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function StrokeShape({ stroke, boardColor }) {
  const points = stroke && stroke.points;
  if (!points || points.length === 0) return null;

  const color = stroke.isEraser ? boardColor : toRgb(stroke.color);
  const width = stroke.width || 3;

  // 单点（点一下）→ 圆点
  if (points.length === 1) {
    return (
      <Circle cx={points[0].x} cy={points[0].y} r={Math.max(width, 1) / 2} fill={color} />
    );
  }

  return (
    <Path
      d={stroke.d || strokeToPath(points)}
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}

// 已完成笔画层：只在 strokes 引用变化（新增/撤销/清空）时重绘
const CompletedLayer = memo(
  function CompletedLayer({ strokes, boardColor }) {
    const list = strokes || [];
    return (
      <>
        {list.map((stroke, index) => (
          <StrokeShape key={`s${index}`} stroke={stroke} boardColor={boardColor} />
        ))}
      </>
    );
  },
  (prev, next) => prev.strokes === next.strokes && prev.boardColor === next.boardColor
);

/**
 * @param {number}  width           画布宽
 * @param {number}  height          画布高
 * @param {Array}   strokes         已完成笔画（引用稳定，变了才重绘）
 * @param {object}  liveStroke      自己正在画的那一笔
 * @param {object}  remoteStroke    对方正在画的那一笔
 * @param {object}  responderProps  手势响应属性（由屏幕传入，只有画题人才给）
 */
function DrawCanvas({
  width,
  height,
  strokes,
  liveStroke,
  remoteStroke,
  boardColor = BOARD_COLOR,
  responderProps,
  style,
  children,
}) {
  return (
    <View
      style={[styles.board, { width, height }, style]}
      collapsable={false}
      {...(responderProps || {})}
    >
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill={boardColor} />
        <CompletedLayer strokes={strokes} boardColor={boardColor} />
        {liveStroke ? (
          <StrokeShape stroke={liveStroke} boardColor={boardColor} />
        ) : null}
        {remoteStroke ? (
          <StrokeShape stroke={remoteStroke} boardColor={boardColor} />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: BOARD_COLOR,
  },
});

export default memo(DrawCanvas);
