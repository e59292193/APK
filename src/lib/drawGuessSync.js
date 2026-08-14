// 你画我猜实时同步协议 v2：相对坐标、双通道 uid 去重、分段顺序号与乱序重组。
const REL_PRECISION = 1000;
const DEFAULT_COLOR = [33, 33, 33];
const DEFAULT_WIDTH = 3;

let uidCounter = 0;
export function makeUid(senderId = 'u') {
  uidCounter = (uidCounter + 1) % 1000000;
  return `${senderId}:${Date.now().toString(36)}:${uidCounter.toString(36)}`;
}

let strokeCounter = 0;
export function makeStrokeId(senderId = 'u') {
  strokeCounter = (strokeCounter + 1) % 1000000;
  return `${senderId}:s${Date.now().toString(36)}:${strokeCounter.toString(36)}`;
}

export function toRel(value, size) {
  if (!size) return 0;
  return Math.round((value / size) * REL_PRECISION) / REL_PRECISION;
}

export function fromRel(value, size) {
  return (Number(value) || 0) * size;
}

export function encodePoints(points, width, height) {
  const list = points || [];
  const result = new Array(list.length * 2);
  for (let index = 0; index < list.length; index += 1) {
    result[index * 2] = toRel(list[index].x, width);
    result[index * 2 + 1] = toRel(list[index].y, height);
  }
  return result;
}

export function decodePoints(flat, width, height) {
  const points = [];
  if (!Array.isArray(flat)) return points;
  for (let index = 0; index + 1 < flat.length; index += 2) {
    points.push({
      x: fromRel(flat[index], width),
      y: fromRel(flat[index + 1], height),
    });
  }
  return points;
}

export function chunkFlatPoints(flat, maxPoints = 120) {
  const chunks = [];
  const step = Math.max(2, maxPoints * 2);
  for (let index = 0; index < flat.length; index += step) {
    chunks.push(flat.slice(index, index + step));
  }
  return chunks;
}

export function strokeToPath(points) {
  const list = points || [];
  if (list.length === 0) return '';
  let path = `M ${list[0].x.toFixed(1)} ${list[0].y.toFixed(1)}`;
  for (let index = 1; index < list.length; index += 1) {
    path += ` L ${list[index].x.toFixed(1)} ${list[index].y.toFixed(1)}`;
  }
  return path;
}

export function withPath(stroke) {
  const points = (stroke && stroke.points) || [];
  return {
    points,
    color: (stroke && stroke.color) || DEFAULT_COLOR,
    width: (stroke && stroke.width) || DEFAULT_WIDTH,
    isEraser: !!(stroke && stroke.isEraser),
    isDot: points.length === 1,
    d: strokeToPath(points),
  };
}

export function shouldAppendPoint(lastPoint, x, y, minDistance = 2) {
  if (!lastPoint) return true;
  const dx = x - lastPoint.x;
  const dy = y - lastPoint.y;
  return dx * dx + dy * dy >= minDistance * minDistance;
}

export function createDedupe(limit = 1200) {
  const seen = new Set();
  const order = [];
  return {
    has(uid) {
      return !!uid && seen.has(uid);
    },
    accept(uid) {
      if (!uid) return true;
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

function validSequence(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * 将 stroke_begin / stroke_pts / stroke_end 重组为完整笔画。
 * points 带 q（从 1 开始），end 带最后一个 q；旧客户端无 q 时仍兼容到达顺序。
 */
export function createStrokeAssembler({
  width,
  height,
  onLive,
  onComplete,
  pendingTtlMs = 15000,
}) {
  const sessions = new Map();
  const beginOrder = [];
  const ready = new Map();
  const done = new Set();
  const doneOrder = [];
  let activeSi = null;

  function markDone(si) {
    if (!si || done.has(si)) return;
    done.add(si);
    doneOrder.push(si);
    if (doneOrder.length > 400) {
      const dropped = doneOrder.splice(0, 200);
      for (const item of dropped) done.delete(item);
    }
  }

  function makeSession(si) {
    return {
      si,
      stroke: null,
      chunks: new Map(),
      legacyChunks: [],
      nextQ: 1,
      ended: false,
      endQ: null,
      ready: false,
      at: Date.now(),
    };
  }

  function getSession(si) {
    let session = sessions.get(si);
    if (!session) {
      session = makeSession(si);
      sessions.set(si, session);
    }
    session.at = Date.now();
    return session;
  }

  function prunePending() {
    const now = Date.now();
    for (const [si, session] of sessions) {
      if (!session.stroke && now - session.at > pendingTtlMs) sessions.delete(si);
    }
  }

  function appendFlat(session, flat) {
    const points = decodePoints(flat, width, height);
    if (!session.stroke || points.length === 0) return;
    session.stroke = {
      ...session.stroke,
      points: session.stroke.points.concat(points),
    };
  }

  function drainChunks(session) {
    if (!session.stroke) return;
    while (session.chunks.has(session.nextQ)) {
      const flat = session.chunks.get(session.nextQ);
      session.chunks.delete(session.nextQ);
      appendFlat(session, flat);
      session.nextQ += 1;
    }
    while (session.legacyChunks.length > 0) {
      appendFlat(session, session.legacyChunks.shift());
    }
    if (activeSi === session.si && onLive) onLive(session.stroke);
  }

  function drainReady() {
    while (beginOrder.length > 0 && ready.has(beginOrder[0])) {
      const si = beginOrder.shift();
      const stroke = ready.get(si);
      ready.delete(si);
      sessions.delete(si);
      markDone(si);
      if (stroke && stroke.points.length > 0 && onComplete) onComplete(withPath(stroke));
    }
  }

  function markReady(session) {
    if (!session || !session.stroke || session.ready) return;
    drainChunks(session);
    session.ready = true;
    ready.set(session.si, session.stroke);
    if (activeSi === session.si) {
      activeSi = null;
      if (onLive) onLive(null);
    }
    drainReady();
  }

  function maybeReady(session) {
    if (!session || !session.stroke || !session.ended) return;
    if (session.endQ == null || session.nextQ > session.endQ) markReady(session);
  }

  return {
    begin(si, meta) {
      if (!si || done.has(si)) return;
      prunePending();
      const session = getSession(si);
      if (session.stroke || session.ready) return;

      // 新 begin 是上一笔的硬边界。先拼上所有连续已到片段，再兜底收尾；
      // 即使上一笔最后一段真的双通道都丢了，也不能阻塞后续全部笔画。
      if (activeSi && activeSi !== si) {
        const previous = sessions.get(activeSi);
        if (previous && !previous.ready) markReady(previous);
      }

      session.stroke = {
        points: decodePoints(meta && meta.p, width, height),
        color: (meta && meta.c) || DEFAULT_COLOR,
        width: (meta && meta.w) || DEFAULT_WIDTH,
        isEraser: !!(meta && meta.e),
      };
      beginOrder.push(si);
      activeSi = si;
      drainChunks(session);
      maybeReady(session);
      if (!session.ready && onLive) onLive(session.stroke);
    },

    points(si, flat, sequence) {
      if (!si || done.has(si)) return;
      prunePending();
      const session = getSession(si);
      if (session.ready) return;
      const q = validSequence(sequence);
      if (q != null) {
        if (q >= session.nextQ && !session.chunks.has(q)) {
          session.chunks.set(q, Array.isArray(flat) ? flat : []);
        }
      } else {
        session.legacyChunks.push(Array.isArray(flat) ? flat : []);
      }
      if (session.stroke) {
        drainChunks(session);
        maybeReady(session);
      }
    },

    end(si, lastSequence) {
      if (!si || done.has(si)) return;
      prunePending();
      const session = getSession(si);
      if (session.ready) return;
      session.ended = true;
      const q = Number(lastSequence);
      session.endQ = Number.isInteger(q) && q >= 0 ? q : null;
      if (session.stroke) {
        drainChunks(session);
        maybeReady(session);
      }
    },

    reset() {
      sessions.clear();
      ready.clear();
      beginOrder.length = 0;
      done.clear();
      doneOrder.length = 0;
      activeSi = null;
      if (onLive) onLive(null);
    },

    hasActive() {
      if (!activeSi) return false;
      const session = sessions.get(activeSi);
      return !!(session && session.stroke && !session.ready);
    },
  };
}

export function encodeStrokes(strokes, width, height) {
  return (strokes || []).map((stroke) => ({
    c: stroke.color || DEFAULT_COLOR,
    w: stroke.width || DEFAULT_WIDTH,
    e: stroke.isEraser ? 1 : 0,
    p: encodePoints(stroke.points, width, height),
  }));
}

export function decodeStrokes(list, width, height) {
  return (list || []).map((stroke) =>
    withPath({
      points: decodePoints(stroke && stroke.p, width, height),
      color: (stroke && stroke.c) || DEFAULT_COLOR,
      width: (stroke && stroke.w) || DEFAULT_WIDTH,
      isEraser: !!(stroke && stroke.e),
    })
  );
}
