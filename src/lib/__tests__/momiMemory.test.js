jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('../fetchWithTimeout', () => ({ fetchWithTimeout: (fn) => fn() }));
jest.mock('../aiProvider', () => ({ sendChatCompletion: jest.fn() }));

import {
  detectExplicitMemoryIntent,
  buildExplicitMemory,
  extractMemoryKeywords,
  MOMI_IDENTITY_SEEDS,
  MEMORY_TYPES,
} from '../momiMemory';

describe('momiMemory 用户明确记忆通道', () => {
  test('识别“记住/别忘了/记一下/小本本”等意图', () => {
    expect(detectExplicitMemoryIntent('记住我不吃香菜')).toBe(true);
    expect(detectExplicitMemoryIntent('别忘了我们的纪念日')).toBe(true);
    expect(detectExplicitMemoryIntent('写进你的小本本')).toBe(true);
    expect(detectExplicitMemoryIntent('今天天气不错')).toBe(false);
  });

  test('“记住我不吃香菜”写为 user_explicit 高置信 dislike', () => {
    const m = buildExplicitMemory('momo', '记住我不吃香菜');
    expect(m.subject).toBe('momo');
    expect(m.memory_type).toBe('dislike');
    expect(m.content).toContain('不吃香菜');
    expect(m.importance).toBe(5);
    expect(m.confidence).toBe(1);
    expect(m.source).toBe('user_explicit');
  });

  test('说话者为苞米时 subject 使用苞米；共同事件使用 both', () => {
    expect(buildExplicitMemory('苞米', '记住我喜欢喝奶茶').subject).toBe('苞米');
    expect(buildExplicitMemory('momo', '记住我们每年去旅行').subject).toBe('both');
  });

  test('类型推断 preference/habit/milestone/promise/ongoing', () => {
    expect(buildExplicitMemory('momo', '记住我喜欢辣的').memory_type).toBe('preference');
    expect(buildExplicitMemory('momo', '记住我习惯早起').memory_type).toBe('habit');
    expect(buildExplicitMemory('momo', '记住我们的纪念日是2月25日').memory_type).toBe('milestone');
    expect(buildExplicitMemory('momo', '记住我们约定每周散步').memory_type).toBe('promise');
    expect(buildExplicitMemory('momo', '记住我最近正在准备考试').memory_type).toBe('ongoing');
  });

  test('关键词提取去重且有上限', () => {
    const keys = extractMemoryKeywords('记住我喜欢奶茶，尤其喜欢少糖奶茶');
    expect(Array.isArray(keys)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeLessThanOrEqual(12);
  });
});

describe('momiMemory 人格种子', () => {
  test('至少覆盖6条核心人格且全部非空', () => {
    expect(MOMI_IDENTITY_SEEDS.length).toBeGreaterThanOrEqual(6);
    MOMI_IDENTITY_SEEDS.forEach((s) => expect(s.length).toBeGreaterThan(10));
    const joined = MOMI_IDENTITY_SEEDS.join('\n');
    expect(joined).toContain('不是工具');
    expect(joined).toContain('两个人更亲近');
    expect(joined).toContain('会生气');
    expect(joined).toContain('未拆开的信');
    expect(joined).toContain('绝不骚扰');
  });

  test('记忆类型定义完整', () => {
    ['identity', 'personality', 'speech_style', 'habit', 'preference', 'dislike', 'milestone', 'fact', 'promise', 'ongoing']
      .forEach((t) => expect(MEMORY_TYPES).toContain(t));
  });
});
