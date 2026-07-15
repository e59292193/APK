// ═══════════════════════════════════════════════════════
// 你画我猜 —— 纯 JS 光栅化 + PNG 编码
//
// 用途：每局结束时把笔画数组渲染成 PNG 图片，上传到 Supabase Storage。
// 不依赖 react-native-view-shot，避免额外原生模块；复用已安装的 pako 做 zlib 压缩。
//
// 笔画格式：{ points: [{x,y}], color: [r,g,b], width: number, isEraser: bool }
// 坐标系：0..canvasW, 0..canvasH（与显示坐标系一致）
// ═══════════════════════════════════════════════════════
import { deflate } from 'pako';

// ─── CRC32（PNG chunk 校验）───
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function chunk(type, data) {
  const typeBytes = [];
  for (let i = 0; i < 4; i++) typeBytes.push(type.charCodeAt(i));
  const len = u32(data.length);
  const body = [...typeBytes, ...data];
  const crc = u32(crc32(new Uint8Array(body)));
  return [...len, ...body, ...crc];
}

/**
 * 把 RGBA 数组编码为 PNG（Uint8Array）。
 */
export function encodePNG(width, height, rgba) {
  // 签名
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  // IHDR
  const ihdr = [...u32(width), ...u32(height), 8, 6, 0, 0, 0]; // 8-bit, color type 6 (RGBA)
  // IDAT: 每行前加 filter byte 0
  const raw = new Uint8Array((width * 4 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: None
    const rowStart = y * width * 4;
    for (let i = 0; i < width * 4; i++) {
      raw[p++] = rgba[rowStart + i];
    }
  }
  const compressed = deflate(raw, { level: 6 });
  const idat = Array.from(compressed);
  // 组装
  const bytes = [
    ...sig,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', idat),
    ...chunk('IEND', []),
  ];
  return new Uint8Array(bytes);
}

// ─── 画粗线：沿路径盖圆点（实现平滑粗笔触）───
function stampCircle(rgba, W, H, cx, cy, r, cr, cg, cb) {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const idx = (y * W + x) * 4;
        rgba[idx] = cr;
        rgba[idx + 1] = cg;
        rgba[idx + 2] = cb;
        rgba[idx + 3] = 255;
      }
    }
  }
}

function drawSegment(rgba, W, H, x1, y1, x2, y2, r, cr, cg, cb) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, r * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stampCircle(rgba, W, H, x1 + dx * t, y1 + dy * t, r, cr, cg, cb);
  }
}

/**
 * 把笔画数组光栅化为 RGBA（Uint8ClampedArray），白底。
 */
export function rasterizeStrokes(strokes, W, H) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  // 白底
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = 255;
  }
  if (!strokes) return rgba;
  for (const s of strokes) {
    const isEraser = !!s.isEraser;
    let cr, cg, cb;
    if (isEraser) {
      cr = 255; cg = 255; cb = 255;
    } else {
      const c = s.color || [0, 0, 0];
      cr = c[0]; cg = c[1]; cb = c[2];
    }
    const r = Math.max(1, (s.width || 4) / 2);
    const pts = s.points || [];
    if (pts.length === 1) {
      stampCircle(rgba, W, H, pts[0].x, pts[0].y, r, cr, cg, cb);
    } else {
      for (let i = 0; i < pts.length - 1; i++) {
        drawSegment(rgba, W, H, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, r, cr, cg, cb);
      }
    }
  }
  return rgba;
}

/**
 * 一步到位：笔画 → PNG Uint8Array
 */
export function strokesToPNG(strokes, W, H) {
  const rgba = rasterizeStrokes(strokes, W, H);
  return encodePNG(W, H, rgba);
}
