import {
  makeStrokeId,
  withPath,
  encodeStrokes,
  decodeStrokes,
  createStrokeAssembler,
  strokeToPath,
} from '../drawGuessSync';

describe('drawGuessSync 笔迹协议与同步测试', () => {
  test('makeStrokeId 生成唯一 strokeId 且包含用户标识', () => {
    const id1 = makeStrokeId('momo');
    const id2 = makeStrokeId('momo');
    expect(id1).toContain('momo:s');
    expect(id2).toContain('momo:s');
    expect(id1).not.toBe(id2);
  });

  test('withPath 保留 strokeId 与 timestamp 属性', () => {
    const raw = {
      strokeId: 'user1:s1',
      t: 1726000000000,
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      color: [255, 0, 0],
      width: 4,
    };
    const formatted = withPath(raw);
    expect(formatted.strokeId).toBe('user1:s1');
    expect(formatted.t).toBe(1726000000000);
    expect(formatted.d).toBe('M 10.0 20.0 L 30.0 40.0');
  });

  test('strokeToPath 点数组转 SVG Path 语法', () => {
    expect(strokeToPath([])).toBe('');
    expect(strokeToPath([{ x: 5, y: 5 }])).toBe('M 5.0 5.0');
    expect(strokeToPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe('M 0.0 0.0 L 10.0 10.0');
  });

  test('encodeStrokes 与 decodeStrokes 往返无损序列化', () => {
    const originalStrokes = [
      {
        strokeId: 'u1:s1',
        t: 1700000001,
        points: [{ x: 100, y: 100 }, { x: 200, y: 200 }],
        color: [33, 33, 33],
        width: 3,
        isEraser: false,
      },
    ];

    const encoded = encodeStrokes(originalStrokes, 400, 400);
    expect(encoded[0].si).toBe('u1:s1');
    expect(encoded[0].p.length).toBe(4);

    const decoded = decodeStrokes(encoded, 400, 400);
    expect(decoded.length).toBe(1);
    expect(decoded[0].strokeId).toBe('u1:s1');
    expect(decoded[0].points.length).toBe(2);
    expect(decoded[0].points[0].x).toBeCloseTo(100, 0);
    expect(decoded[0].points[0].y).toBeCloseTo(100, 0);
  });

  test('createStrokeAssembler 组装并隔离笔画', (done) => {
    const completedList = [];
    const assembler = createStrokeAssembler({
      width: 300,
      height: 300,
      onLive: () => {},
      onComplete: (stroke) => {
        completedList.push(stroke);
        if (completedList.length === 1) {
          expect(completedList[0].strokeId).toBe('s1');
          expect(completedList[0].points.length).toBe(2);
          done();
        }
      },
    });

    assembler.begin('s1', { p: [0.1, 0.1], c: [33, 33, 33], w: 3, e: 0, t: 1000 });
    assembler.points('s1', [0.2, 0.2], 1);
    assembler.end('s1', 1);
  });
});
