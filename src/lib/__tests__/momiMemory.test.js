jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('../fetchWithTimeout', () => ({ fetchWithTimeout: (fn) => fn() }));
jest.mock('../aiProvider', () => ({ sendChatCompletion: jest.fn() }));

import { parseExplicitMemory, MOMI_IDENTITY_SEEDS, MEMORY_TYPES } from '../momiMemory';

describe('momiMemory 用户明确记忆通道', () => {
  test('识别记住/别忘了/记一下意图，忽略普通聊天', () => {
    expect(parseExplicitMemory('记住我不吃香菜', 'momo')).toBeTruthy();
    expect(parseExplicitMemory('别忘了我们的纪念日', 'momo')).toBeTruthy();
    expect(parseExplicitMemory('记一下我喜欢少糖奶茶', '苞米')).toBeTruthy();
    expect(parseExplicitMemory('今天天气不错', 'momo')).toBeNull();
  });

  test('“记住我不吃香菜”写为 user_explicit 高置信 dislike', () => {
    const memory = parseExplicitMemory('记住我不吃香菜', 'momo');
    expect(memory.subject).toBe('momo');
    expect(memory.memory_type).toBe('dislike');
    expect(memory.content).toContain('不吃香菜');
    expect(memory.importance).toBe(5);
    expect(memory.confidence).toBe(1);
    expect(memory.source).toBe('user_explicit');
  });

  test('说话者 subject 与 preference/habit/milestone/promise 类型推断', () => {
    expect(parseExplicitMemory('记住我喜欢喝奶茶', '苞米').subject).toBe('苞米');
    expect(parseExplicitMemory('记住我喜欢辣的', 'momo').memory_type).toBe('preference');
    expect(parseExplicitMemory('记住我习惯早起', 'momo').memory_type).toBe('habit');
    expect(parseExplicitMemory('记住我们的纪念日是2月25日', 'momo').memory_type).toBe('milestone');
    expect(parseExplicitMemory('记住我们约定每周散步', 'momo').memory_type).toBe('promise');
  });

  test('关键词提取去重且有上限', () => {
    const keys = parseExplicitMemory('记住我喜欢奶茶，尤其喜欢少糖奶茶', 'momo').keywords;
    expect(Array.isArray(keys)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeLessThanOrEqual(30);
  });
});

describe('momiMemory 人格种子', () => {
  test('覆盖核心人格且全部非空', () => {
    expect(MOMI_IDENTITY_SEEDS.length).toBeGreaterThanOrEqual(6);
    MOMI_IDENTITY_SEEDS.forEach((seed) => expect(seed.length).toBeGreaterThan(10));
    const joined = MOMI_IDENTITY_SEEDS.join('\n');
    expect(joined).toContain('不是工具');
    expect(joined).toContain('更亲近');
    expect(joined).toContain('会生气');
    expect(joined).toContain('未拆开的信');
    expect(joined).toContain('绝不骚扰');
  });

  test('记忆类型定义完整', () => {
    ['identity', 'personality', 'speech_style', 'habit', 'preference', 'dislike', 'milestone', 'fact', 'promise', 'ongoing']
      .forEach((type) => expect(MEMORY_TYPES).toContain(type));
  });
});
