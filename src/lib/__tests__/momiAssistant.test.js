jest.mock('expo-file-system', () => ({
  File: {},
  Paths: {},
}));
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { buildSystemPrompt } from '../momiAssistant';

describe('momiAssistant 厨房小助手与安全规则测试', () => {
  test('buildSystemPrompt 包含情侣专属信息及安全原则', () => {
    const context = {
      momoMemory: 'momo喜欢微辣',
      baomiMemory: '苞米喜欢可乐鸡翅',
      coupleMemory: '一起吃过火锅',
      dishTitles: '【番茄牛腩】(meat)、【清炒时蔬】(veg)',
      dishesCount: 2,
      openedCapsulesSummary: '[momo写]: 这是已拆封的信件内容...',
    };

    const prompt = buildSystemPrompt(context);

    expect(prompt).toContain('momi');
    expect(prompt).toContain('momo');
    expect(prompt).toContain('苞米');
    expect(prompt).toContain('momo喜欢微辣');
    expect(prompt).toContain('苞米喜欢可乐鸡翅');
    expect(prompt).toContain('【番茄牛腩】');
    expect(prompt).toContain('这是已拆封的信件内容');
    expect(prompt).toContain('绝对不能泄露未拆开的时光胶囊内容');
  });

  test('buildSystemPrompt 规则强调正向情绪与偏向和解', () => {
    const prompt = buildSystemPrompt({
      momoMemory: '',
      baomiMemory: '',
      coupleMemory: '',
      dishTitles: '',
      dishesCount: 0,
      openedCapsulesSummary: '',
    });

    expect(prompt).toContain('温柔劝和');
    expect(prompt).toContain('不超过 150 字');
  });
});
