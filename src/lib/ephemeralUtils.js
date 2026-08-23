// ═══════════════════════════════════════════════════════
// 小纸条 & 语音 —— 纯函数（无副作用，可单测）
// ═══════════════════════════════════════════════════════

/**
 * 生成客户端去重 UUID（v4）
 * react-native-get-random-values 已在 App.js 顶部 import，polyfill crypto
 */
export function newClientRequestId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

/**
 * 把录音 metering（dB，通常 -160 ~ 0）采样归一化为 [0..1] 波形点
 * @param {number[]} samples  原始 metering 采样
 * @param {number} targetLen  目标点数（32~64）
 * @returns {number[]}
 */
export function normalizeWaveform(samples, targetLen = 40) {
  if (!samples || samples.length === 0) return new Array(targetLen).fill(0.06);
  // 归一化：-50dB → 0，0dB → 1
  const norm = samples.map((db) => {
    const v = (db + 50) / 50; // -50..0 → 0..1
    return Math.max(0.04, Math.min(1, v));
  });
  // 压缩/重采样到 targetLen
  const out = [];
  const step = norm.length / targetLen;
  for (let i = 0; i < targetLen; i++) {
    const start = Math.floor(i * step);
    const end = Math.min(norm.length, Math.floor((i + 1) * step));
    const slice = norm.slice(start, end || start + 1);
    const peak = slice.reduce((m, x) => Math.max(m, x), 0.04);
    out.push(Number(peak.toFixed(3)));
  }
  return out;
}
