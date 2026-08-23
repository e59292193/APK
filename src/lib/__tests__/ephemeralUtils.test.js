import { newClientRequestId, normalizeWaveform } from '../ephemeralUtils';

describe('ephemeralUtils', () => {
  test('newClientRequestId 生成合法 v4 UUID 且不重复', () => {
    const id = newClientRequestId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(newClientRequestId()).not.toBe(id);
  });

  test('空采样返回全低值波形', () => {
    const wave = normalizeWaveform([], 40);
    expect(wave.length).toBe(40);
    wave.forEach((v) => expect(v).toBe(0.06));
  });

  test('dB 采样映射到 [0.04, 1]', () => {
    const wave = normalizeWaveform([-50, -25, 0], 3);
    expect(wave.length).toBe(3);
    // -50dB→0（下限0.04），0dB→1
    expect(wave[0]).toBeCloseTo(0.04, 3);
    expect(wave[2]).toBeCloseTo(1, 3);
    wave.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0.04);
      expect(v).toBeLessThanOrEqual(1);
    });
  });

  test('长采样按峰值压缩到目标点数', () => {
    const samples = new Array(100).fill(-40);
    samples[50] = -10; // 一个峰值
    const wave = normalizeWaveform(samples, 10);
    expect(wave.length).toBe(10);
    // 峰值落在包含 index 50 的桶（第 5 个桶：40-49? 50-59 → 第 6 个桶）
    expect(wave).toContain(0.8); // (-10+50)/50 = 0.8
    // 其余桶是 -40dB → 0.2
    expect(wave.filter((v) => v === 0.2).length).toBe(9);
  });

  test('超界 dB 值被钳制', () => {
    const wave = normalizeWaveform([-120, 10], 2);
    expect(wave[0]).toBe(0.04);
    expect(wave[1]).toBe(1);
  });
});
