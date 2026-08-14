// ═══════════════════════════════════════════════════════
// drawGuessSync —— 你画我猜「实时同步协议 v2」纯逻辑层（无 React / 无网络依赖）
//
// 解决三个老问题：
//   1. IM 与 DB 队列双通道会把同一条信号投递两次
//      → 所有信号统一携带 uid（发送方生成一次，两条通道共用），
//        接收方用 createDedupe() 全局去重，undo/clear/弹幕/猜词不再双影。
//   2. stroke_pts 早于 stroke_begin 到达时被直接丢弃，笔画永久缺段
//      → createStrokeAssembler() 内置乱序缓冲：begin 未到先暂存 pts/end，
//        begin 到达后按序重放；end 丢包时下一笔 begin 会先给上一笔收尾。
//   3. 坐标用绝对像素传输，双方画布尺寸不同就会偏移
//      → 统一用「相对画布比例（千分位）」编解码。
//
// 坐标约定：传输值恒为 0~1 之间的比例，解码时乘以本机画布宽高。
// ═══════════════════════════════════════════════════════

const REL_PRECISION = 1000;
const DEFAULT_COLOR = [33, 33, 33];
const DEFAULT_WIDTH = 3;

// ─── uid：一条业务信号的唯一标识（IM 与 DB 队列共用同一个值）───
let uidCounter = 0;
export function makeUid(senderId = 'u') {
  uidCounter = (uidCounter + 1) % 1000000;
  return `${senderId}:${Date.now().toString(36)}:${uidCounter.toString(36)}`;
}

// ─── 笔画序号：区分同一局中的不同笔画 ───
let strokeCounter = 0;
export function makeStrokeId(senderId = 'u') {
  strokeCounter = (strokeCounter + 1) % 1000000;
  return `${senderId}:s${Date.now().toString(36)}:${strokeCounter.toString(36)}`;
}

// ─── 坐标编解码（相对比例）───
export function toRel(value, size) {
  if (!size) return 0;
  return Math.round((value / size) * REL_PRECISION) / REL_PRECISION;
}

export function fromRel(value, size) {
  return (Number(value) || 0) * size;
}

export function encodePoints(points, width, height) {
  const list = points || [];
  const out = new Array(list.length * 2);
  for (let i = 0; i < list.length; i++) {
    out[i * 2] = toRel(list[i].x, width);
    out[i * 2 + 1] = toRel(list[i].y, height);
  }
  return out;
}

export function decodePoints(flat, width, height) {
  const pts = [];
  if (!Array.isArray(flat)) return pts;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    pts.push({ x: fromRel(flat[i], width), y: fromRel(flat[i + 1], height) });
  }
  return pts;
}

// 把一个扁平坐标数组切成小段，避免单条 IM 自定义消息超过 12KB
export function chunkFlatPoints(flat, maxPoints = 120) {
  const chunks = [];
  const step = Math.max(2, maxPoints * 2);
  for (let i = 0; i < flat.length; i += step) {
    chunks.push(flat.slice(i, i + step));
  }
  return chunks;
}

// ─── 路径预计算：笔画完成时算一次 d，渲染阶段不再重复拼字符串 ───
export function strokeToPath(points) {
  const pts = points || [];
  if (pts.length === 0) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }
  return d;
}

/**
 * 给笔画附加渲染所需的派生字段：
 *   d     预计算好的 SVG path
 *   isDot 单点笔画（必须画成圆点，否则 fill="none" 的 Path 完全看不见，
 *         而 PNG 光栅化又会画出圆点，造成画布与存图不一致）
 */
export function withPath(stroke) {
  const pts = (stroke && stroke.points) || [];
  return {
    points: pts,
    color: (stroke && stroke.color) || DEFAULT_COLOR,
    width: (stroke && stroke.width) || DEFAULT_WIDTH,
    isEraser: !!(stroke && stroke.isEraser),
    isDot: pts.length === 1,
    d: strokeToPath(pts),
  };
}

// ─── 点抽稀：手指移动事件频率远高于渲染需求，近距离点直接丢弃 ───
export function shouldAppendPoint(lastPoint, x, y, minDistance = 2) {
  if (!lastPoint) return true;
  const dx = x - lastPoint.x;
  const dy = y - lastPoint.y;
  return dx * dx + dy * dy >= minDistance * minDistance;
}

// ─── 全局信号去重（uid）───
export function createDedupe(limit = 1200) {
  const seen = new Set();
  const order = [];
  return {
    has(uid) {
      return !!uid && seen.has(uid);
    },
    // 返回 true 表示这是第一次见到，可以处理；false 表示重复，应忽略
    accept(uid) {
      if (!uid) return true; // 兼容旧版本无 uid 的信号：不去重，交给上层语义判断
      if (seen.has(uid)) return false;
      seen.add(uid);
      order.push(uid);
      if (order.length > limit) {
        const dropped = order.splice(0, Math.floor(limit / 2));
        for (const item of dropped) seen.delete(item);
      }
      return true;
    },
    clear() {
      seen.clear();
      order.length = 0;
    },
  };
}

/**
 * 乱序容错的笔画重组器。
 *
 * @param {object}   opts
 * @param {number}   opts.width       本机画布宽（解码相对坐标用）
 * @param {number}   opts.height      本机画布高
 * @param {Function} opts.onLive      (strokeOrNull) => void  对方正在画的那一笔（含 null 表示清除）
 * @param {Function} opts.onComplete  (stroke) => void        一笔画完，追加到历史笔画
 * @param {number}   [opts.pendingTtlMs=15000]  孤儿缓冲的存活时间
 */
export function createStrokeAssembler({
  width,
  height,
  onLive,
  onComplete,
  pendingTtlMs = 15000,
}) {
  let activeSi = null;
  let activeStroke = null;

  // si -> { chunks: number[][], ended: boolean, at: number }
  const pending = new Map();
  // 已完成的 si（防止 IM + DB 双通道把同一笔加两次）
  const done = new Set();
  const doneOrder = [];

  function markDone(si) {
    if (!si || done.has(si)) return;
    done.add(si);
    doneOrder.push(si);
    if (doneOrder.length > 400) {
      const dropped = doneOrder.splice(0, 200);
      for (const item of dropped) done.delete(item);
    }
  }

  function prunePending() {
    const now = Date.now();
    for (const [si, entry] of pending) {
      if (now - entry.at > pendingTtlMs) pending.delete(si);
    }
  }

  function completeActive() {
    const si = activeSi;
    const stroke = activeStroke;
    activeSi = null;
    activeStroke = null;
    markDone(si);
    if (onLive) onLive(null);
    if (stroke && stroke.points.length > 0 && onComplete) {
      onComplete(withPath(stroke));
    }
  }

  return {
    begin(si, meta) {
      if (!si || done.has(si)) return;
      prunePending();
      // 上一笔的 stroke_end 丢包：先把它收尾，避免整笔丢失
      if (activeSi && activeSi !== si) completeActive();
      if (activeSi === si) return; // 重复 begin

      const stroke = {
        points: decodePoints(meta && meta.p, width, height),
        color: (meta && meta.c) || DEFAULT_COLOR,
        width: (meta && meta.w) || DEFAULT_WIDTH,
        isEraser: !!(meta && meta.e),
      };

      // 合并 begin 之前就到达的乱序点
      const buffered = pending.get(si);
      if (buffered) {
        pending.delete(si);
        for (const chunk of buffered.chunks) {
          const add = decodePoints(chunk, width, height);
          for (const p of add) stroke.points.push(p);
        }
      }

      activeSi = si;
      activeStroke = stroke;

      if (buffered && buffered.ended) {
        completeActive();
        return;
      }
      if (onLive) onLive(stroke);
    },

    points(si, flat) {
      if (!si || done.has(si)) return;
      if (activeSi === si && activeStroke) {
        const add = decodePoints(flat, width, height);
        if (add.length === 0) return;
        activeStroke = {
          ...activeStroke,
          points: [...activeStroke.points, ...add],
        };
        if (onLive) onLive(activeStroke);
        return;
      }
      // begin 还没到（乱序）：暂存，等 begin 到达后按序重放
      prunePending();
      const entry = pending.get(si) || { chunks: [], ended: false, at: Date.now() };
      entry.chunks.push(Array.isArray(flat) ? flat : []);
      entry.at = Date.now();
      pending.set(si, entry);
    },

    end(si) {
      if (!si || done.has(si)) return;
      if (activeSi === si) {
        completeActive();
        return;
      }
      prunePending();
      const entry = pending.get(si) || { chunks: [], ended: false, at: Date.now() };
      entry.ended = true;
      entry.at = Date.now();
      pending.set(si, entry);
    },

    // 新一轮 / 清空画布 / 切换对局时调用
    reset() {
      activeSi = null;
      activeStroke = null;
      pending.clear();
      done.clear();
      doneOrder.length = 0;
      if (onLive) onLive(null);
    },

    hasActive() {
      return !!activeStroke;
    },
  };
}

// ─── 整幅画快照（中途加入时一次性同步；走 DB jsonb，无 12KB 限制）───
export function encodeStrokes(strokes, width, height) {
  return (strokes || []).map((s) => ({
    c: s.color || DEFAULT_COLOR,
    w: s.width || DEFAULT_WIDTH,
    e: s.isEraser ? 1 : 0,
    p: encodePoints(s.points, width, height),
  }));
}

export function decodeStrokes(list, width, height) {
  return (list || []).map((s) =>
    withPath({
      points: decodePoints(s && s.p, width, height),
      color: (s && s.c) || DEFAULT_COLOR,
      width: (s && s.w) || DEFAULT_WIDTH,
      isEraser: !!(s && s.e),
    })
  );
}
