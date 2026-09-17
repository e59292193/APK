jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

jest.mock('../fetchWithTimeout', () => ({
  fetchWithTimeout: jest.fn(),
}));

import {
  ASSISTANT_COUPLE_ID,
  assistantMessageStableKey,
  compareAssistantMessages,
  mergeAssistantMessages,
  normalizeAssistantMessage,
} from '../momiAssistantMessageStore';

const BASE_TIME = '2026-09-17T10:00:00.000Z';

function message(overrides = {}) {
  return {
    couple_id: ASSISTANT_COUPLE_ID,
    id: 'cloud-1',
    client_message_id: 'client-1',
    sender: 'momo',
    content: '同一句话',
    created_at: BASE_TIME,
    updated_at: BASE_TIME,
    status: 'synced',
    ...overrides,
  };
}

describe('momiAssistantMessageStore 稳定合并与幂等键', () => {
  test('规范化人类与 assistant 的 sender 元数据', () => {
    const human = normalizeAssistantMessage(message({ sender: '包米', sender_user_id: null }));
    expect(human.sender).toBe('苞米');
    expect(human.sender_type).toBe('user');
    expect(human.sender_user_id).toBe('苞米');

    const assistant = normalizeAssistantMessage(message({
      sender: 'momi',
      sender_type: 'assistant',
      sender_user_id: null,
      client_message_id: 'assistant-1',
    }));
    expect(assistant.sender_type).toBe('assistant');
    expect(assistant.sender_user_id).toBeNull();
  });

  test('同一 client_message_id 的云端 canonical 行替换本地 pending 行', () => {
    const local = message({
      id: 'local:client-1',
      status: 'pending',
      cloud_persisted: false,
    });
    const cloud = message({
      id: '11111111-1111-1111-1111-111111111111',
      status: 'synced',
      cloud_persisted: true,
      server_sequence: 9,
    });
    const result = mergeAssistantMessages([local], [cloud]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(cloud.id);
    expect(result[0].cloud_persisted).toBe(true);
    expect(result[0].server_sequence).toBe(9);
  });

  test('momo 与苞米发送相同正文不会按内容误去重', () => {
    const result = mergeAssistantMessages([
      message({ id: 'momo-row', client_message_id: 'momo-client', sender: 'momo' }),
      message({ id: 'baomi-row', client_message_id: 'baomi-client', sender: '苞米' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.sender).sort()).toEqual(['momo', '苞米'].sort());
  });

  test('同一 generation_key 的 assistant 重试只保留一条', () => {
    const local = message({
      id: 'local:reply-a',
      client_message_id: 'reply-a',
      sender: 'momi',
      generation_key: 'job-42:generation-1',
      status: 'pending',
    });
    const cloud = message({
      id: 'assistant-cloud',
      client_message_id: 'reply-b',
      sender: 'momi',
      generation_key: 'job-42:generation-1',
      status: 'synced',
    });
    const result = mergeAssistantMessages([local, cloud]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('assistant-cloud');
    expect(assistantMessageStableKey(result[0])).toBe('generation:job-42:generation-1');
  });

  test('两条 canonical 消息优先按 server_sequence 排序', () => {
    const laterTimeLowerSequence = message({
      id: 'sequence-2',
      client_message_id: 'sequence-client-2',
      server_sequence: 2,
      created_at: '2026-09-17T10:05:00.000Z',
    });
    const earlierTimeHigherSequence = message({
      id: 'sequence-8',
      client_message_id: 'sequence-client-8',
      server_sequence: 8,
      created_at: '2026-09-17T10:00:00.000Z',
    });
    const result = mergeAssistantMessages([earlierTimeHigherSequence, laterTimeLowerSequence]);
    expect(result.map((item) => item.server_sequence)).toEqual([2, 8]);
  });

  test('一方缺少 server_sequence 时按 created_at 放置 pending 消息', () => {
    const pending = message({
      id: 'local:pending',
      client_message_id: 'pending-client',
      server_sequence: null,
      created_at: '2026-09-17T10:01:00.000Z',
      status: 'pending',
    });
    const canonical = message({
      id: 'canonical-before',
      client_message_id: 'canonical-before-client',
      server_sequence: 5,
      created_at: '2026-09-17T10:00:00.000Z',
    });
    expect([canonical, pending].sort(compareAssistantMessages).map((item) => item.id))
      .toEqual(['canonical-before', 'local:pending']);
  });

  test('错误 couple 的行不会进入共享历史', () => {
    const result = mergeAssistantMessages([
      message({ id: 'foreign', client_message_id: 'foreign-client', couple_id: 'other-couple' }),
      message({ id: 'valid', client_message_id: 'valid-client' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('valid');
  });
});
