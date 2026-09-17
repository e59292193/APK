// ═══════════════════════════════════════════════════════
// momiMemoryOrchestrator.js —— 可信记忆证据防火墙与跨源融合纯函数
//
// 本文件不持有模型/服务密钥，不直接信任 Hindsight / Graphiti 返回值。
// 所有派生记忆都必须先经过 hardFilterMemory + scoreMemoryCandidate，
// “你说过”只能由带原始 user message 证据的记录授权。
// ═══════════════════════════════════════════════════════

export const MEMORY_COUPLE_ID = 'momo_and_baomi';
export const MEMORY_MIN_CONFIDENCE = 0.72;
export const MEMORY_SCORE_THRESHOLD = 0.62;
export const MEMORY_EXACT_KEY_THRESHOLD = 0.58;
export const MEMORY_TOP_K = 5;
export const MEMORY_CONTEXT_CHAR_BUDGET = 1200;

export const MEMORY_SCORE_WEIGHTS = Object.freeze({
  semanticScore: 0.30,
  lexicalScore: 0.23,
  keyMatch: 0.17,
  subjectMatch: 0.10,
  confidenceScore: 0.08,
  importanceScore: 0.05,
  confirmationScore: 0.04,
  recencyScore: 0.03,
});

export const MEMORY_SOURCE_AUTHORITY = Object.freeze({
  structured_data: 1.00,
  user_message: 0.95,
  explicit_command: 0.95,
  graphiti: 0.88,
  hindsight_observation: 0.80,
  hindsight_experience: 0.70,
  manual: 0.70,
  seed: 1.00,
  assistant: 0.00,
  unknown: 0.00,
});

const VALID_ACTORS = new Set(['momo', '苞米']);
const VALID_OPERATIONS = new Set(['add', 'update', 'forget', 'none']);
const VALID_SCOPES = new Set(['private', 'couple']);
const AUTHORITATIVE_WITHOUT_MESSAGE = new Set(['structured_data', 'seed', 'verified_system_event']);
const USER_EVIDENCE_SOURCES = new Set(['user_message', 'explicit_command']);
const HARD_SENSITIVE_PATTERN = /(密码|验证码|口令|token|密钥|secret|银行卡|信用卡|支付信息|身份证号|精确位置|实时位置)/i;
const HYPOTHETICAL_PATTERN = /(如果|假如|要是|万一|也许|可能|开玩笑|假设)/;
const THIRD_PARTY_PATTERN = /(momo|苞米|他|她|ta)\s*(说|提过|告诉我)/i;

const SYNONYM_RULES = [
  [/(不吃|讨厌|忌口|不喜欢)/g, '不喜欢'],
  [/(对象|另一半|伴侣)/g, '伴侣'],
  [/(爱吃|爱喝|偏爱)/g, '喜欢'],
];

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

export function normalizeMomiActor(actorId) {
  const raw = String(actorId || '').trim().toLowerCase();
  if (raw === 'momo') return 'momo';
  if (raw === '苞米' || raw === 'baomi' || raw === '包米') return '苞米';
  return null;
}

export function normalizeMemoryText(text) {
  let normalized = String(text || '').normalize('NFKC').toLowerCase();
  for (const [pattern, replacement] of SYNONYM_RULES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized
    .replace(/[\u3000\s]+/g, '')
    .replace(/[“”‘’「」『』【】()[\]{}<>《》，。！？!?、；;：:·…—_-]+/g, '')
    .trim();
}

export function tokenizeMemoryText(text) {
  const normalized = normalizeMemoryText(text);
  const tokens = new Set();
  const chunks = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
  for (const chunk of chunks) {
    if (/^[\u4e00-\u9fff]+$/.test(chunk)) {
      if (chunk.length <= 3) tokens.add(chunk);
      for (const size of [2, 3]) {
        for (let index = 0; index <= chunk.length - size; index += 1) {
          tokens.add(chunk.slice(index, index + size));
        }
      }
    } else if (chunk) {
      tokens.add(chunk);
    }
  }
  return Array.from(tokens).slice(0, 80);
}

export function lexicalMemoryScore(query, candidate) {
  const queryTokens = new Set(tokenizeMemoryText(query));
  const candidateTokens = new Set(tokenizeMemoryText(candidate));
  if (!queryTokens.size || !candidateTokens.size) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }
  const coverage = overlap / queryTokens.size;
  const union = new Set([...queryTokens, ...candidateTokens]).size;
  const jaccard = union ? overlap / union : 0;
  return clamp01(coverage * 0.7 + jaccard * 0.3);
}

function inferMemoryCategory(content) {
  if (/(不吃|讨厌|忌口|不喜欢)/.test(content)) return 'preference';
  if (/(喜欢|爱吃|爱喝|偏爱)/.test(content)) return 'preference';
  if (/(习惯|每天|通常|经常)/.test(content)) return 'habit';
  if (/(约定|答应|承诺|计划)/.test(content)) return 'plan';
  if (/(生日|纪念日|周年|第一次)/.test(content)) return 'important_date';
  if (/(边界|不要|不能接受)/.test(content)) return 'boundary';
  return 'other';
}

function inferMemoryEntity(content) {
  return normalizeMemoryText(content)
    .replace(/^(记住|记一下|别忘了|你要知道|以后都)/, '')
    .replace(/^(我|我们)(以前|现在|一直|通常|经常)?/, '')
    .replace(/^(不喜欢|喜欢|习惯|计划|答应|承诺|是)/, '')
    .replace(/(了|这件事|的事情)$/, '')
    .slice(0, 64) || 'general';
}

export function buildMemoryKey(content, category = inferMemoryCategory(content)) {
  return `${category}:${inferMemoryEntity(content)}`;
}

function makeNone(reason) {
  return { operation: 'none', reason };
}

/**
 * 确定性候选提取：只处理当前已持久化的人类消息。
 * LLM 可提出同形状候选，但仍必须交给 validateMemoryOperation 校验。
 */
export function extractMemoryOperations(message, context = {}) {
  const rawMessage = String(message || '').trim();
  const actorId = normalizeMomiActor(context.actorId || context.userId);
  const sourceMessageId = context.sourceMessageId || null;
  const senderType = context.senderType || 'user';
  if (senderType !== 'user') return [makeNone('assistant_or_system_text_not_eligible')];
  if (!actorId || !rawMessage) return [makeNone('missing_actor_or_message')];
  if (!sourceMessageId) return [makeNone('message_not_persisted')];
  if (HARD_SENSITIVE_PATTERN.test(rawMessage)) return [makeNone('sensitive_content')];
  if (HYPOTHETICAL_PATTERN.test(rawMessage)) return [makeNone('hypothetical_content')];
  if (THIRD_PARTY_PATTERN.test(rawMessage)) return [makeNone('third_party_report')];

  const forgetMatch = rawMessage.match(/(?:忘掉|忘记|删掉|不要再记得)(?:关于)?(.+?)(?:这件事|的事情)?[。！!]?$/);
  if (forgetMatch?.[1]?.trim()) {
    const evidence = forgetMatch[1].trim();
    return [{
      operation: 'forget',
      subject_type: 'user',
      subject_user_id: actorId,
      visibility_scope: 'private',
      category: inferMemoryCategory(evidence),
      memory_key: buildMemoryKey(evidence),
      memory_value: evidence,
      confidence: 1,
      importance: 5,
      explicitness: 'explicit',
      evidence_excerpt: evidence,
      source_type: 'explicit_command',
      source_message_id: sourceMessageId,
      source_user_id: actorId,
      reason: 'explicit_forget_command',
    }];
  }

  const explicitMatch = rawMessage.match(/(?:请你)?(?:记住|记一下|别忘了|你要知道)(?:：|:|,|，|\s)*(.*?)[。！!]?$/i);
  const directMatch = rawMessage.match(/^(我|我们)(现在|一直|通常|经常)?(不吃|讨厌|忌口|不喜欢|喜欢|爱吃|爱喝|偏爱|习惯|计划|答应|承诺|是)(.+?)[。！!]?$/);
  const correctionMatch = rawMessage.match(/^我以前(.+?)[，,。]?(?:但|不过)?现在(.+?)[。！!]?$/);

  let evidence = explicitMatch?.[1]?.trim() || directMatch?.[0]?.trim() || correctionMatch?.[0]?.trim();
  if (!evidence || /[？?]$/.test(rawMessage)) return [makeNone('not_a_stable_direct_fact')];
  evidence = evidence.replace(/[。！!]+$/, '').trim();

  const isCouple = /^我们/.test(evidence) || /^我们/.test(rawMessage);
  const category = inferMemoryCategory(evidence);
  let memoryKey = buildMemoryKey(evidence, category);
  if (correctionMatch) {
    const previousEntity = inferMemoryEntity(correctionMatch[1]);
    memoryKey = `${category}:${previousEntity}`;
  }

  return [{
    operation: correctionMatch ? 'update' : 'add',
    subject_type: isCouple ? 'couple' : 'user',
    subject_user_id: isCouple ? null : actorId,
    visibility_scope: isCouple ? 'couple' : 'private',
    category,
    memory_key: memoryKey,
    memory_value: correctionMatch ? correctionMatch[2].trim() : evidence,
    confidence: explicitMatch ? 0.98 : 0.88,
    importance: explicitMatch ? 5 : 3,
    explicitness: explicitMatch ? 'explicit' : 'direct',
    evidence_excerpt: evidence,
    source_type: explicitMatch ? 'explicit_command' : 'user_message',
    source_message_id: sourceMessageId,
    source_user_id: actorId,
    reason: correctionMatch ? 'explicit_current_state_update' : 'direct_user_fact',
  }];
}

export function validateMemoryOperation(operation, rawMessage, context = {}) {
  if (!operation || !VALID_OPERATIONS.has(operation.operation)) {
    return { valid: false, reason: 'invalid_operation' };
  }
  if (operation.operation === 'none') return { valid: false, reason: operation.reason || 'no_operation' };

  const message = String(rawMessage || '');
  const actorId = normalizeMomiActor(context.actorId || context.userId || operation.source_user_id);
  const sourceType = operation.source_type || 'unknown';
  if (sourceType === 'assistant' || context.senderType === 'assistant') {
    return { valid: false, reason: 'assistant_is_not_evidence' };
  }
  if (!actorId || !operation.source_message_id) {
    return { valid: false, reason: 'unpersisted_or_unknown_speaker' };
  }
  if (!operation.evidence_excerpt || !message.includes(operation.evidence_excerpt)) {
    return { valid: false, reason: 'evidence_not_contiguous_substring' };
  }
  if (HARD_SENSITIVE_PATTERN.test(operation.evidence_excerpt)) {
    return { valid: false, reason: 'sensitive_content' };
  }
  if (HYPOTHETICAL_PATTERN.test(message) || THIRD_PARTY_PATTERN.test(message)) {
    return { valid: false, reason: 'ambiguous_or_reported_content' };
  }
  if (!VALID_SCOPES.has(operation.visibility_scope)) {
    return { valid: false, reason: 'invalid_visibility_scope' };
  }
  const subjectActor = normalizeMomiActor(operation.subject_user_id);
  if (operation.subject_type === 'user' && subjectActor !== actorId) {
    return { valid: false, reason: 'speaker_subject_mismatch' };
  }
  if (operation.subject_type === 'couple' && operation.visibility_scope !== 'couple') {
    return { valid: false, reason: 'couple_fact_must_be_shared' };
  }
  if (!operation.memory_key || !String(operation.memory_value || '').trim()) {
    return { valid: false, reason: 'missing_memory_key_or_value' };
  }
  return {
    valid: true,
    reason: null,
    operation: {
      ...operation,
      source_user_id: actorId,
      subject_user_id: operation.subject_type === 'couple' ? null : actorId,
      confidence: clamp01(operation.confidence),
      importance: Math.max(1, Math.min(5, Number(operation.importance) || 3)),
    },
  };
}

function normalizeSourceType(memory) {
  const source = memory?.source_type || memory?.source || 'unknown';
  if (source === 'user_explicit') return 'explicit_command';
  if (source === 'db_sync') return 'structured_data';
  if (source === 'ai_extracted') return 'unknown';
  return source;
}

function isExpired(memory, now) {
  const validTo = memory.valid_to ? new Date(memory.valid_to).getTime() : Infinity;
  const expiresAt = memory.expires_at ? new Date(memory.expires_at).getTime() : Infinity;
  return Number.isNaN(validTo) || Number.isNaN(expiresAt) || validTo <= now || expiresAt <= now;
}

/**
 * 相似度之前的硬过滤。返回 reason 便于单测和脱敏日志；不打印内容。
 */
export function hardFilterMemory(memory, context = {}) {
  const actorId = normalizeMomiActor(context.actorId || context.userId);
  const targetSubject = normalizeMomiActor(context.subjectUserId || actorId);
  const coupleId = context.coupleId || MEMORY_COUPLE_ID;
  if (!memory || memory.couple_id !== coupleId) return { accepted: false, reason: 'couple_mismatch' };
  if (memory.status !== 'active') return { accepted: false, reason: 'inactive_status' };
  if (!actorId || !VALID_ACTORS.has(actorId)) return { accepted: false, reason: 'unknown_actor' };
  if (memory.visibility_scope === 'private' && normalizeMomiActor(memory.subject || memory.subject_user_id) !== actorId) {
    return { accepted: false, reason: 'private_scope_denied' };
  }
  const memorySubject = normalizeMomiActor(memory.subject || memory.subject_user_id);
  const isCoupleFact = memory.subject === 'both' || memory.subject_type === 'couple';
  if (!isCoupleFact && memorySubject !== targetSubject) return { accepted: false, reason: 'subject_mismatch' };
  if (isExpired(memory, context.now ? new Date(context.now).getTime() : Date.now())) {
    return { accepted: false, reason: 'expired' };
  }
  if (Number(memory.confidence) < MEMORY_MIN_CONFIDENCE) return { accepted: false, reason: 'low_confidence' };

  const sourceType = normalizeSourceType(memory);
  const hasUserEvidence = USER_EVIDENCE_SOURCES.has(sourceType)
    && Boolean(memory.source_message_id)
    && normalizeMomiActor(memory.source_user_id || memorySubject) === memorySubject;
  const authoritative = AUTHORITATIVE_WITHOUT_MESSAGE.has(sourceType);
  const observationVerified = sourceType === 'hindsight_observation'
    && Number(memory.proof_count) >= 2
    && memory.all_sources_active === true;
  const derivedWithProvenance = (sourceType === 'graphiti' || sourceType === 'hindsight_experience')
    && Boolean(memory.source_message_id || memory.episode_provenance);
  if (!hasUserEvidence && !authoritative && !observationVerified && !derivedWithProvenance && sourceType !== 'manual') {
    return { accepted: false, reason: 'missing_authoritative_evidence' };
  }
  return { accepted: true, reason: null, sourceType, hasUserEvidence };
}

function recencyScore(memory, now = Date.now()) {
  const value = memory.last_confirmed_at || memory.updated_at || memory.created_at;
  const time = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(time)) return 0;
  const ageDays = Math.max(0, (now - time) / 86400000);
  return clamp01(Math.exp(-ageDays / 365));
}

export function scoreMemoryCandidate(memory, query, context = {}) {
  const gate = hardFilterMemory(memory, context);
  if (!gate.accepted) return { accepted: false, reason: gate.reason, score: -Infinity };

  const queryKey = context.queryKey ? normalizeMemoryText(context.queryKey) : '';
  const memoryKey = normalizeMemoryText(memory.memory_key || '');
  const exactKey = Boolean(queryKey && memoryKey && queryKey === memoryKey);
  const semanticAvailable = Number.isFinite(memory.semanticScore);
  const components = {
    semanticScore: semanticAvailable ? clamp01(memory.semanticScore) : null,
    lexicalScore: lexicalMemoryScore(query, `${memory.memory_key || ''} ${memory.content || memory.memory_value || ''}`),
    keyMatch: exactKey ? 1 : (queryKey && memoryKey && (queryKey.includes(memoryKey) || memoryKey.includes(queryKey)) ? 0.7 : 0),
    subjectMatch: 1,
    confidenceScore: clamp01(memory.confidence),
    importanceScore: clamp01((Number(memory.importance) || 1) / 5),
    confirmationScore: memory.explicitness === 'explicit' || gate.hasUserEvidence ? 1 : clamp01((Number(memory.proof_count) || 1) / 2),
    recencyScore: recencyScore(memory, context.now ? new Date(context.now).getTime() : Date.now()),
  };

  const availableWeight = Object.entries(MEMORY_SCORE_WEIGHTS).reduce((sum, [key, weight]) =>
    components[key] === null ? sum : sum + weight, 0);
  const positive = Object.entries(MEMORY_SCORE_WEIGHTS).reduce((sum, [key, weight]) => {
    if (components[key] === null) return sum;
    return sum + components[key] * (weight / availableWeight);
  }, 0);
  const contradictionPenalty = clamp01(memory.contradictionPenalty || 0);
  const ambiguityPenalty = clamp01(memory.ambiguityPenalty || 0);
  const score = positive - contradictionPenalty - ambiguityPenalty;
  const threshold = exactKey ? MEMORY_EXACT_KEY_THRESHOLD : MEMORY_SCORE_THRESHOLD;

  return {
    accepted: score >= threshold,
    reason: score >= threshold ? null : 'below_threshold',
    score,
    threshold,
    exactKey,
    authority: MEMORY_SOURCE_AUTHORITY[gate.sourceType] ?? MEMORY_SOURCE_AUTHORITY.unknown,
    allowUserSaid: gate.hasUserEvidence,
    sourceType: gate.sourceType,
    components,
  };
}

function candidateText(memory) {
  return String(memory.content || memory.memory_value || '');
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(tokenizeMemoryText(candidateText(left)));
  const rightTokens = new Set(tokenizeMemoryText(candidateText(right)));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / new Set([...leftTokens, ...rightTokens]).size;
}

/**
 * 稳定 Top-K + MMR 去重 + 每分类最多 2 条。
 */
export function rankMemoryCandidates(candidates, query, context = {}) {
  const scored = (Array.isArray(candidates) ? candidates : [])
    .map((memory) => ({ memory, scoring: scoreMemoryCandidate(memory, query, context) }))
    .filter((entry) => entry.scoring.accepted)
    .sort((left, right) =>
      right.scoring.score - left.scoring.score
      || right.scoring.authority - left.scoring.authority
      || String(right.memory.last_confirmed_at || right.memory.updated_at || '').localeCompare(String(left.memory.last_confirmed_at || left.memory.updated_at || ''))
      || String(left.memory.id || '').localeCompare(String(right.memory.id || '')));

  const selected = [];
  const categoryCounts = new Map();
  const lambda = Number.isFinite(context.mmrLambda) ? context.mmrLambda : 0.75;
  while (selected.length < (context.limit || MEMORY_TOP_K)) {
    let best = null;
    for (const entry of scored) {
      if (selected.some((item) => item.memory === entry.memory)) continue;
      const category = entry.memory.category || entry.memory.memory_type || 'other';
      if ((categoryCounts.get(category) || 0) >= 2) continue;
      const maxSimilarity = selected.reduce((max, item) => Math.max(max, tokenSimilarity(entry.memory, item.memory)), 0);
      const mmrScore = lambda * entry.scoring.score - (1 - lambda) * maxSimilarity;
      if (!best || mmrScore > best.mmrScore) best = { ...entry, mmrScore };
    }
    if (!best) break;
    selected.push(best);
    const category = best.memory.category || best.memory.memory_type || 'other';
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  }
  return selected;
}

export function retrieveRelevantMemories(query, context = {}) {
  return rankMemoryCandidates(context.candidates || [], query, context);
}

export function buildVerifiedMemoryBlock(entries, evidenceState = 'none') {
  const selected = Array.isArray(entries) ? entries : [];
  if (!selected.length) return '【可信记忆检索结果：无】';
  const lines = ['【可信记忆】'];
  for (const entry of selected) {
    const memory = entry.memory || entry;
    const scoring = entry.scoring || scoreMemoryCandidate(memory, memory.content || '', {
      actorId: memory.subject || memory.subject_user_id,
      subjectUserId: memory.subject || memory.subject_user_id,
      coupleId: memory.couple_id,
    });
    const subject = memory.subject_type === 'couple' || memory.subject === 'both'
      ? 'momo与苞米'
      : (memory.subject || memory.subject_user_id || '未知');
    const fact = candidateText(memory).slice(0, 180);
    const time = memory.last_confirmed_at || memory.valid_from || memory.created_at || '未知';
    lines.push(`- 主体=${subject}；事实=${fact}；来源=${scoring.sourceType || normalizeSourceType(memory)}；证据时间=${time}；置信=${Number(memory.confidence || 0).toFixed(2)}；allow_user_said=${scoring.allowUserSaid === true}`);
    if (lines.join('\n').length >= MEMORY_CONTEXT_CHAR_BUDGET) break;
  }
  if (evidenceState === 'conflict') lines.push('【证据状态：冲突；必须说明不确定并询问确认】');
  return lines.join('\n').slice(0, MEMORY_CONTEXT_CHAR_BUDGET);
}

/**
 * “我说过吗”只在对应人类说话人的原始消息里找证据。
 * 该纯函数供数据库查询结果二次校验；assistant/system 永远不命中。
 */
export function findUserMessageEvidence(query, speakerId, messages = []) {
  const actorId = normalizeMomiActor(speakerId);
  if (!actorId) return { state: 'not_found', matches: [] };
  const matches = (Array.isArray(messages) ? messages : [])
    .filter((message) => {
      const sender = normalizeMomiActor(message.sender_user_id || message.sender || message.user_id);
      const senderType = message.sender_type || (message.sender === 'momi' ? 'assistant' : 'user');
      return senderType === 'user' && sender === actorId && message.content;
    })
    .map((message) => ({ ...message, evidenceScore: lexicalMemoryScore(query, message.content) }))
    .filter((message) => message.evidenceScore >= 0.2)
    .sort((left, right) => right.evidenceScore - left.evidenceScore
      || String(right.created_at || '').localeCompare(String(left.created_at || '')))
    .slice(0, 10);
  if (!matches.length) return { state: 'not_found', matches: [] };
  return { state: 'verified', matches };
}

export function createMemoryGrounding(entries = [], state = 'none') {
  const selected = Array.isArray(entries) ? entries : [];
  return {
    state,
    usedCount: selected.length,
    attributionAllowed: selected.some((entry) => entry.scoring?.allowUserSaid === true),
  };
}
