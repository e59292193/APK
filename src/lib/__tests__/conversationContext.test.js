jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../fetchWithTimeout', () => ({ fetchWithTimeout: jest.fn() }));
jest.mock('../momiDataAccess', () => ({ getCoupleChatHistory: jest.fn(async () => []) }));

import { removeCurrentTurnFromHistory } from '../conversationContext';

describe('conversationContext 当前轮去重', () => {
  test('momi 助手场景移除最新且相同的当前用户消息', () => {
    const history = [
      { id: '1', sender: 'momo', sender_type: 'user', content: '同一句', source: 'assistant' },
      { id: '2', sender: 'momi', sender_type: 'assistant', content: '收到', source: 'assistant' },
      { id: '3', sender: 'momo', sender_type: 'user', content: '同一句', source: 'assistant' },
    ];
    const result = removeCurrentTurnFromHistory(history, {
      scene: 'assistant', userId: 'momo', message: '同一句',
    });
    expect(result.map((item) => item.id)).toEqual(['1', '2']);
    expect(history).toHaveLength(3);
  });

  test('保留另一位用户的同文消息', () => {
    const history = [
      { id: '1', sender: '苞米', sender_type: 'user', content: '晚安', source: 'assistant' },
      { id: '2', sender: 'momo', sender_type: 'user', content: '晚安', source: 'assistant' },
    ];
    const result = removeCurrentTurnFromHistory(history, {
      scene: 'assistant', userId: 'momo', message: '晚安',
    });
    expect(result).toEqual([history[0]]);
  });

  test('主聊天场景不删除历史', () => {
    const history = [{ id: '1', sender: 'momo', sender_type: 'user', content: '你好' }];
    expect(removeCurrentTurnFromHistory(history, {
      scene: 'chat_mention', userId: 'momo', message: '你好',
    })).toEqual(history);
  });
});
