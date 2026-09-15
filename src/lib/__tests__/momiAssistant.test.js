jest.mock('expo-file-system', () => ({ File: class {} }));
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}));
jest.mock('../momiDataAccess', () => ({
  queryByIntent: jest.fn(async () => null),
  queryRecipeIfAsked: jest.fn(async () => null),
  getDataDigest: jest.fn(async () => ({})),
}));
jest.mock('../momiMemory', () => ({
  ensureIdentitySeeds: jest.fn(async () => []),
  getRelevantMemories: jest.fn(async () => ({ identity: [], related: [] })),
  saveExplicitMemory: jest.fn(async () => null),
  parseExplicitMemory: jest.fn(() => null),
  extractAndSaveMemories: jest.fn(async () => []),
}));
jest.mock('../momiState', () => ({
  getMomiState: jest.fn(async () => ({ mood: 'calm', mood_intensity: 50, energy: 80, anger_level: 0, affection_momo: 50, affection_baomi: 50, growth_level: 1 })),
  applyInteraction: jest.fn(async () => ({ state: {}, emotionDelta: {}, leveledUp: false, newLevel: 1 })),
  scoreRudenessLocally: jest.fn(() => 0),
  buildEmotionPromptBlock: jest.fn(() => '【momi 当前状态】calm'),
}));

import { buildSystemPrompt } from '../momiAssistant';

describe('momiAssistant V2 人格、能力与安全规则', () => {
  const baseContext = {
    momoMemory: 'momo喜欢微辣',
    baomiMemory: '苞米喜欢可乐鸡翅',
    coupleMemory: '一起吃过火锅',
    dishTitles: '【番茄牛腩】(meat)、【清炒时蔬】(veg)',
    dishesCount: 2,
    openedCapsulesSummary: '[momo写]: 这是已拆封的信件内容...',
  };

  test('包含情侣专属信息及安全原则', () => {
    const prompt = buildSystemPrompt(baseContext);
    expect(prompt).toContain('momi');
    expect(prompt).toContain('momo');
    expect(prompt).toContain('苞米');
    expect(prompt).toContain('momo喜欢微辣');
    expect(prompt).toContain('苞米喜欢可乐鸡翅');
    expect(prompt).toContain('【番茄牛腩】');
    expect(prompt).toContain('这是已拆封的信件内容');
    expect(prompt).toContain('绝对不能读取');
    expect(prompt).toContain('未拆开的时光胶囊');
    expect(prompt).toContain('小纸条是阅后即焚');
  });

  test('明确列出全量数据能力（解决“查不到打卡”）', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain('打卡记录');
    expect(prompt).toContain('菜品库');
    expect(prompt).toContain('纪念日');
    expect(prompt).toContain('愿望清单');
    expect(prompt).toContain('五子棋');
    expect(prompt).toContain('相册数量');
  });

  test('显式禁止否认能力与编造数据', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain('绝对禁止回答“我没有这个能力”');
    expect(prompt).toContain('“我只能查我之后的信息”');
    expect(prompt).toContain('不得编造');
  });

  test('图片行为与真实情绪约束存在', () => {
    const prompt = buildSystemPrompt({ emotionBlock: '【momi 当前状态】angry' });
    expect(prompt).toContain('必须先用自己的语气具体评论');
    expect(prompt).toContain('不得静默忽略图片');
    expect(prompt).toContain('必须表现真实情绪');
  });

  test('回复长度与显式记忆确认规则存在', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain('不超过 150 字');
    expect(prompt).toContain('写进小本本');
  });
});
