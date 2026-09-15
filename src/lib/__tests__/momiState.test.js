// ═══════════════════════════════════════════════════════
// momiState 情绪规则机测试
// ═══════════════════════════════════════════════════════

const mockMaybeSingleHolder = { data: null };

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        insert() { return builder; },
        upsert() { return builder; },
        maybeSingle() { return Promise.resolve({ data: mockMaybeSingleHolder.data, error: null }); },
        then(resolve) { return resolve({ data: [], error: null }); },
      };
      return builder;
    }),
  },
}));

jest.mock('../fetchWithTimeout', () => ({
  fetchWithTimeout: (fn) => fn(),
}));

import {
  scoreRudenessLocally,
  detectApology,
  detectPraise,
  canSendProactive,
  buildEmotionPromptBlock,
  applyInteraction,
  GROWTH_THRESHOLDS,
  DEFAULT_MOMI_STATE,
} from '../momiState';

describe('momiState 粗鲁度检测', () => {
  test('真辱骂词得高分，白名单不能豁免', () => {
    expect(scoreRudenessLocally('你给我滚')).toBe(7);
    expect(scoreRudenessLocally('笨蛋，滚！')).toBe(7); // 白名单不豁免真辱骂
  });

  test('打情骂俏白名单不计为粗鲁', () => {
    expect(scoreRudenessLocally('你这个猪猪')).toBe(1);
    expect(scoreRudenessLocally('小笨蛋')).toBe(1);
  });

  test('普通对话 0 分', () => {
    expect(scoreRudenessLocally('今天吃了什么呀')).toBe(0);
    expect(scoreRudenessLocally('')).toBe(0);
  });

  test('道歉与夸奖检测', () => {
    expect(detectApology('对不起啦')).toBe(true);
    expect(detectApology('今天天气不错')).toBe(false);
    expect(detectPraise('谢谢你')).toBe(true);
    expect(detectPraise('随便')).toBe(false);
  });
});

describe('momiState 互动规则', () => {
  beforeEach(() => {
    mockMaybeSingleHolder.data = null;
  });

  test('粗鲁互动：怒气上升、好感下降、情绪转 annoyed/angry', async () => {
    const { state, emotionDelta } = await applyInteraction({ userId: 'momo', rudeness: 8, text: '滚' });
    expect(state.anger_level).toBeGreaterThanOrEqual(20);
    expect(['annoyed', 'angry']).toContain(state.mood);
    expect(state.affection_momo).toBeLessThan(50);
    expect(emotionDelta.angerDelta).toBeGreaterThan(0);
  });

  test('道歉：怒气 -30 逐步回落，不立即归零', async () => {
    // 预置怒气 50 的状态
    mockMaybeSingleHolder.data = { ...DEFAULT_MOMI_STATE, anger_level: 50, mood: 'annoyed', updated_at: new Date().toISOString() };
    const { state } = await applyInteraction({ userId: 'momo', rudeness: 0, text: '对不起' });
    expect(state.anger_level).toBe(20); // 50 - 30，不是 0
  });

  test('正向互动：好感与经验上升', async () => {
    mockMaybeSingleHolder.data = { ...DEFAULT_MOMI_STATE, updated_at: new Date().toISOString() };
    const { state, emotionDelta } = await applyInteraction({ userId: '苞米', rudeness: 0, text: '谢谢你 momi' });
    expect(state.affection_baomi).toBeGreaterThan(50);
    expect(emotionDelta.expGain).toBeGreaterThanOrEqual(3); // 1 基础 + 2 正向
  });

  test('升级阈值单调递增', () => {
    for (let i = 1; i < GROWTH_THRESHOLDS.length; i++) {
      expect(GROWTH_THRESHOLDS[i]).toBeGreaterThan(GROWTH_THRESHOLDS[i - 1]);
    }
  });
});

describe('momiState 主动消息闸门', () => {
  const baseState = { proactive_date: '2026-09-15', proactive_count_today: 1 };

  test('免扰窗口：23:00 与 08:00 不允许，10:00 允许', () => {
    expect(canSendProactive(baseState, { now: new Date('2026-09-15T23:00:00') }).allowed).toBe(false);
    expect(canSendProactive(baseState, { now: new Date('2026-09-15T08:00:00') }).allowed).toBe(false);
    expect(canSendProactive(baseState, { now: new Date('2026-09-15T10:00:00') }).allowed).toBe(true);
  });

  test('每日上限 3 条；跳天计数重置', () => {
    const capped = { proactive_date: '2026-09-15', proactive_count_today: 3 };
    expect(canSendProactive(capped, { now: new Date('2026-09-15T10:00:00') }).reason).toBe('daily_cap');
    // 新的一天，即使计数为 3 也允许
    expect(canSendProactive(capped, { now: new Date('2026-09-16T10:00:00') }).allowed).toBe(true);
  });
});

describe('momiState 情绪注入 prompt', () => {
  test('angry 状态包含“真的生气”行为约束', () => {
    const block = buildEmotionPromptBlock({ ...DEFAULT_MOMI_STATE, mood: 'angry', anger_level: 80 });
    expect(block).toContain('真的很生气');
    expect(block).toContain('绝对禁止');
  });

  test('calm 状态不含愤怒指令', () => {
    const block = buildEmotionPromptBlock({ ...DEFAULT_MOMI_STATE });
    expect(block).toContain('calm');
    expect(block).not.toContain('真的很生气');
  });
});
