import {
  MEMORY_SCORE_THRESHOLD,
  buildMemoryKey,
  buildVerifiedMemoryBlock,
  createMemoryGrounding,
  extractMemoryOperations,
  findUserMessageEvidence,
  hardFilterMemory,
  lexicalMemoryScore,
  normalizeMomiActor,
  rankMemoryCandidates,
  scoreMemoryCandidate,
  validateMemoryOperation,
} from '../momiMemoryOrchestrator';

const NOW = '2026-09-17T08:00:00.000Z';

function makeMemory(overrides = {}) {
  return {
    id: 'memory-1',
    couple_id: 'momo_and_baomi',
    subject: 'momo',
    subject_type: 'user',
    subject_user_id: 'momo',
    visibility_scope: 'private',
    category: 'preference',
    memory_type: 'preference',
    memory_key: 'preference:香菜',
    content: '我不吃香菜',
    confidence: 0.95,
    importance: 5,
    explicitness: 'explicit',
    status: 'active',
    source_type: 'user_message',
    source_message_id: 'message-1',
    source_user_id: 'momo',
    created_at: NOW,
    last_confirmed_at: NOW,
    ...overrides,
  };
}

const MOMO_CONTEXT = {
  actorId: 'momo',
  subjectUserId: 'momo',
  coupleId: 'momo_and_baomi',
  now: NOW,
};

describe('momiMemoryOrchestrator 证据防火墙', () => {
  test('统一 momo/苞米 actor id，拒绝未知身份', () => {
    expect(normalizeMomiActor('momo')).toBe('momo');
    expect(normalizeMomiActor('baomi')).toBe('苞米');
    expect(normalizeMomiActor('包米')).toBe('苞米');
    expect(normalizeMomiActor('momi')).toBeNull();
  });

  test('assistant 文案和未持久化消息不会产生记忆候选', () => {
    expect(extractMemoryOperations('你喜欢榴莲', {
      actorId: 'momo', senderType: 'assistant', sourceMessageId: 'assistant-1',
    })[0].operation).toBe('none');
    expect(extractMemoryOperations('我不吃香菜', {
      actorId: 'momo', senderType: 'user',
    })[0].reason).toBe('message_not_persisted');
  });

  test('假设、第三方转述、问句和敏感信息一律不自动保存', () => {
    const context = { actorId: 'momo', senderType: 'user', sourceMessageId: 'message-1' };
    expect(extractMemoryOperations('记住如果中了大奖我就去冰岛', context)[0].operation).toBe('none');
    expect(extractMemoryOperations('记住苞米说自己不吃香菜', context)[0].operation).toBe('none');
    expect(extractMemoryOperations('我喜欢榴莲吗？', context)[0].operation).toBe('none');
    expect(extractMemoryOperations('记住我的验证码是123456', context)[0].operation).toBe('none');
  });

  test('连续原文证据与实际说话者必须匹配', () => {
    const context = { actorId: 'momo', senderType: 'user', sourceMessageId: 'message-1' };
    const operation = extractMemoryOperations('记住我不吃香菜', context)[0];
    expect(validateMemoryOperation(operation, '记住我不吃香菜', context).valid).toBe(true);
    expect(validateMemoryOperation({ ...operation, evidence_excerpt: '我爱吃香菜' }, '记住我不吃香菜', context))
      .toMatchObject({ valid: false, reason: 'evidence_not_contiguous_substring' });
    expect(validateMemoryOperation({ ...operation, subject_user_id: '苞米' }, '记住我不吃香菜', context))
      .toMatchObject({ valid: false, reason: 'speaker_subject_mismatch' });
  });

  test('当前纠正复用旧事实 key，供数据库 supersede', () => {
    const context = { actorId: 'momo', senderType: 'user', sourceMessageId: 'message-2' };
    const oldKey = buildMemoryKey('我不吃香菜');
    const correction = extractMemoryOperations('我以前不吃香菜，现在喜欢了', context)[0];
    expect(correction.operation).toBe('update');
    expect(correction.memory_key).toBe(oldKey);
  });
});

describe('momiMemoryOrchestrator 检索、评分与归因', () => {
  test('中文同义词与 2/3-gram 词法兜底可命中', () => {
    expect(lexicalMemoryScore('我忌口香菜', '我不吃香菜')).toBeGreaterThan(0.4);
  });

  test('private 记忆绝不跨 momo/苞米，couple id 也必须一致', () => {
    expect(hardFilterMemory(makeMemory(), { ...MOMO_CONTEXT, actorId: '苞米', subjectUserId: '苞米' }))
      .toMatchObject({ accepted: false, reason: 'private_scope_denied' });
    expect(hardFilterMemory(makeMemory({ couple_id: 'other-couple' }), MOMO_CONTEXT))
      .toMatchObject({ accepted: false, reason: 'couple_mismatch' });
  });

  test.each(['unverified', 'deleted', 'superseded'])('%s 状态不参与检索', (status) => {
    expect(hardFilterMemory(makeMemory({ status }), MOMO_CONTEXT))
      .toMatchObject({ accepted: false, reason: 'inactive_status' });
  });

  test('过期、低置信与无证据 ai_extracted 全部硬淘汰', () => {
    expect(hardFilterMemory(makeMemory({ expires_at: '2026-09-16T00:00:00Z' }), MOMO_CONTEXT).reason)
      .toBe('expired');
    expect(hardFilterMemory(makeMemory({ confidence: 0.7 }), MOMO_CONTEXT).reason)
      .toBe('low_confidence');
    expect(hardFilterMemory(makeMemory({
      source_type: 'unknown', source: 'ai_extracted', source_message_id: null,
    }), MOMO_CONTEXT).reason).toBe('missing_authoritative_evidence');
  });

  test('embedding 不可用时重归一化，不把 unavailable 当 0', () => {
    const withoutEmbedding = scoreMemoryCandidate(makeMemory(), '香菜', MOMO_CONTEXT);
    const zeroEmbedding = scoreMemoryCandidate(makeMemory({ semanticScore: 0 }), '香菜', MOMO_CONTEXT);
    expect(withoutEmbedding.components.semanticScore).toBeNull();
    expect(withoutEmbedding.score).toBeGreaterThan(zeroEmbedding.score);
    expect(withoutEmbedding.score).toBeGreaterThanOrEqual(MEMORY_SCORE_THRESHOLD);
  });

  test('无候选达到阈值时返回空，不凑最像的一条', () => {
    const selected = rankMemoryCandidates([makeMemory()], '完全无关的量子火箭新闻', MOMO_CONTEXT);
    expect(selected).toEqual([]);
  });

  test('Top-K 顺序稳定、最多五条且同分类最多两条', () => {
    const candidates = [
      makeMemory({ id: 'p2', content: '我不喜欢香菜', memory_key: 'preference:香菜', created_at: '2026-09-16T00:00:00Z' }),
      makeMemory({ id: 'p1', content: '我不吃香菜', memory_key: 'preference:香菜' }),
      makeMemory({ id: 'p3', content: '香菜是我的忌口', memory_key: 'preference:香菜' }),
      makeMemory({ id: 'h1', category: 'habit', memory_type: 'habit', content: '我吃饭会避开香菜', memory_key: 'habit:香菜' }),
      makeMemory({ id: 'b1', category: 'boundary', memory_type: 'boundary', content: '不要给我放香菜', memory_key: 'boundary:香菜' }),
      makeMemory({ id: 'o1', category: 'other', memory_type: 'fact', content: '香菜会影响我的胃口', memory_key: 'other:香菜' }),
    ];
    const first = rankMemoryCandidates(candidates, '香菜', MOMO_CONTEXT);
    const second = rankMemoryCandidates(candidates, '香菜', MOMO_CONTEXT);
    expect(first.map((entry) => entry.memory.id)).toEqual(second.map((entry) => entry.memory.id));
    expect(first.length).toBeLessThanOrEqual(5);
    expect(first.filter((entry) => entry.memory.category === 'preference').length).toBeLessThanOrEqual(2);
  });

  test('Hindsight observation 至少两个有效来源，任一失效即拒绝', () => {
    const valid = makeMemory({
      source_type: 'hindsight_observation', source_message_id: null,
      proof_count: 2, all_sources_active: true,
    });
    expect(hardFilterMemory(valid, MOMO_CONTEXT).accepted).toBe(true);
    expect(hardFilterMemory({ ...valid, all_sources_active: false }, MOMO_CONTEXT).reason)
      .toBe('missing_authoritative_evidence');
  });

  test('手工资料可作为记忆但永远不能授权“你说过”', () => {
    const result = scoreMemoryCandidate(makeMemory({
      source_type: 'manual', source_message_id: null, source_user_id: null,
    }), '香菜', { ...MOMO_CONTEXT, queryKey: 'preference:香菜' });
    expect(result.accepted).toBe(true);
    expect(result.allowUserSaid).toBe(false);
  });

  test('“我说过吗”只命中对应用户原始消息，不命中 assistant 或另一方', () => {
    const result = findUserMessageEvidence('榴莲', 'momo', [
      { id: 'assistant-1', sender: 'momi', sender_type: 'assistant', content: '你喜欢榴莲' },
      { id: 'baomi-1', sender: '苞米', sender_type: 'user', content: '我喜欢榴莲' },
      { id: 'momo-1', sender: 'momo', sender_type: 'user', content: '我不喜欢榴莲', created_at: NOW },
    ]);
    expect(result.state).toBe('verified');
    expect(result.matches.map((item) => item.id)).toEqual(['momo-1']);
    expect(findUserMessageEvidence('榴莲', 'momo', [
      { sender: 'momi', sender_type: 'assistant', content: '你喜欢榴莲' },
    ]).state).toBe('not_found');
  });

  test('可信记忆块与 memoryGrounding 只按证据授权归因', () => {
    const ranked = rankMemoryCandidates([makeMemory()], '香菜', MOMO_CONTEXT);
    const block = buildVerifiedMemoryBlock(ranked, 'verified');
    expect(block).toContain('【可信记忆】');
    expect(block).toContain('allow_user_said=true');
    expect(createMemoryGrounding(ranked, 'verified')).toEqual({
      state: 'verified', usedCount: 1, attributionAllowed: true,
    });
    expect(buildVerifiedMemoryBlock([], 'none')).toBe('【可信记忆检索结果：无】');
  });
});
