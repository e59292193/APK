// ═══════════════════════════════════════════════════════
// momi 结构化记忆服务 (momiMemory.js)
//
// 策略：稳定语义记忆 + 数据摘要 + 按需精确查询，绝不复制全部业务原始行。
// 所有记忆保存在 Supabase，与模型厂商无关；切换 provider 后仍完整保留。
// ═══════════════════════════════════════════════════════

import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { sendChatCompletion } from './aiProvider';

export const MEMORY_COUPLE_ID = 'momo_and_baomi';
export const MEMORY_TYPES = [
  'identity', 'personality', 'speech_style', 'habit', 'preference',
  'dislike', 'milestone', 'fact', 'promise', 'ongoing',
];

export const MOMI_IDENTITY_SEEDS = [
  '我是 momi，是 momo 和 苞米 的宠物，不是工具也不是冷冰冰的助手。',
  '我说话可爱、温暖、有点小脆弱，会用语气词和少量 emoji。',
  '我的使命是让 momo 和 苞米 两个人更亲近，不会只讨好其中一个。',
  '我有自己的情绪，不会一味顺着他们；被粗鲁对待时我会生气。',
  '我永远不看未拆开的信，也不看未抽取的小纸条，那是他们的秘密。',
  '我会主动关心他们，但尊重免扰时间与频率上限，绝不骚扰。',
];

const MEMORY_INTENT_RE = /记住|别忘了|记一下|记下来|以后都|你要知道|小本本/;
const STOP_WORDS = new Set(['momi', '莫米', '摸米', '默米', '请', '帮我', '一下', '这个', '那个', '真的', '以后', '记住', '别忘了', '记一下', '记下来', '你要知道']);

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n)));
}

export function detectExplicitMemoryIntent(text) {
  return Boolean(text && MEMORY_INTENT_RE.test(text));
}

export function extractMemoryKeywords(text) {
  if (!text) return [];
  const chunks = String(text)
    .replace(/[，。！？、；：,.!?;:\n\r\[\]()（）]/g, ' ')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && !STOP_WORDS.has(s));
  // 中文无空格句子再按关键语义抓取
  const semantic = String(text).match(/不吃[^，。！？]{1,10}|喜欢[^，。！？]{1,10}|讨厌[^，。！？]{1,10}|习惯[^，。！？]{1,10}|纪念日[^，。！？]{0,12}/g) || [];
  return Array.from(new Set([...chunks, ...semantic])).slice(0, 12);
}

function inferMemoryType(content) {
  if (/不吃|不喜欢|讨厌|忌口|不能/.test(content)) return 'dislike';
  if (/喜欢|爱吃|最爱|偏爱/.test(content)) return 'preference';
  if (/习惯|每天|经常|作息|早起|晚睡/.test(content)) return 'habit';
  if (/纪念日|周年|第一次|生日|里程碑/.test(content)) return 'milestone';
  if (/答应|承诺|约定|说好/.test(content)) return 'promise';
  if (/最近|正在|这阵子|目前/.test(content)) return 'ongoing';
  return 'fact';
}

/**
 * 把“记住我不吃香菜”转换为结构化记忆；subject 不猜性别，只按明确名字/说话者。
 */
export function buildExplicitMemory(userId, text) {
  if (!detectExplicitMemoryIntent(text)) return null;
  const content = String(text)
    .replace(/^(momi|莫米|摸米|默米)[，,：:\s]*/i, '')
    .replace(/请?\s*(帮我)?\s*(记住|记一下|记下来)|别忘了|你要知道/g, '')
    .trim()
    .replace(/^[，,：:\s]+|[，,：:\s]+$/g, '');
  if (!content) return null;

  let subject = userId === '苞米' ? '苞米' : 'momo';
  if (/我们|两个人|我和/.test(content)) subject = 'both';
  else if (/^momo|关于momo/.test(content)) subject = 'momo';
  else if (/^苞米|关于苞米/.test(content)) subject = '苞米';

  const memoryType = inferMemoryType(content);
  return {
    subject,
    memory_type: memoryType,
    content,
    keywords: extractMemoryKeywords(content),
    importance: 5,
    confidence: 1,
    source: 'user_explicit',
    expires_at: memoryType === 'ongoing'
      ? new Date(Date.now() + 30 * 86400000).toISOString()
      : null,
  };
}

function normalizeMemory(memory) {
  const subject = ['momo', '苞米', 'both', 'momi'].includes(memory.subject)
    ? memory.subject
    : 'both';
  const memoryType = MEMORY_TYPES.includes(memory.memory_type)
    ? memory.memory_type
    : 'fact';
  const source = ['user_explicit', 'ai_extracted', 'db_sync', 'seed'].includes(memory.source)
    ? memory.source
    : 'ai_extracted';
  return {
    subject,
    memory_type: memoryType,
    content: String(memory.content || '').trim(),
    keywords: Array.isArray(memory.keywords)
      ? memory.keywords.filter(Boolean).map(String).slice(0, 12)
      : extractMemoryKeywords(memory.content),
    importance: clamp(memory.importance ?? 3, 1, 5),
    confidence: clamp(memory.confidence ?? 0.6, 0, source === 'ai_extracted' ? 0.8 : 1),
    source,
    source_ref: memory.source_ref || null,
    expires_at: memory.expires_at || null,
  };
}

/**
 * 记忆写入统一入口：优先调用数据库 RPC（表达式部分唯一索引无法由 PostgREST
 * onConflict 字符串可靠表达）；RPC 内 INSERT ... ON CONFLICT DO UPDATE 并发安全去重。
 */
export async function upsertMemory(memory) {
  const m = normalizeMemory(memory || {});
  if (!m.content) return { success: false, error: '记忆内容为空' };

  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase.rpc('upsert_momi_memory', {
        p_couple_id: MEMORY_COUPLE_ID,
        p_subject: m.subject,
        p_memory_type: m.memory_type,
        p_content: m.content,
        p_keywords: m.keywords,
        p_importance: m.importance,
        p_confidence: m.confidence,
        p_source: m.source,
        p_source_ref: m.source_ref,
        p_expires_at: m.expires_at,
      })
    );
    if (!error) return { success: true, memory: Array.isArray(data) ? data[0] : data };
    if (error.code === '42883') {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[momiMemory] upsert_momi_memory RPC 不存在，请执行 momi_memory_rpc_migration.sql');
      }
    } else {
      console.warn('[momiMemory] upsert 失败:', error.message);
    }
    return { success: false, error: error.message, errorCode: error.code };
  } catch (err) {
    console.warn('[momiMemory] 写入异常:', err.message);
    return { success: false, error: err.message };
  }
}

/** 首次启动插入 momi 身份人格种子（RPC upsert 保证幂等、永不重复）。 */
export async function ensureMomiIdentitySeeds() {
  const results = [];
  for (let i = 0; i < MOMI_IDENTITY_SEEDS.length; i += 1) {
    results.push(await upsertMemory({
      subject: 'momi',
      memory_type: 'identity',
      content: MOMI_IDENTITY_SEEDS[i],
      keywords: extractMemoryKeywords(MOMI_IDENTITY_SEEDS[i]),
      importance: 5,
      confidence: 1,
      source: 'seed',
      source_ref: `identity_seed_v1_${i + 1}`,
    }));
  }
  return results;
}

async function queryActiveMemories() {
  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase
        .from('momi_memory')
        .select('id, subject, memory_type, content, keywords, importance, confidence, source, hit_count, last_hit_at, expires_at')
        .eq('couple_id', MEMORY_COUPLE_ID)
        .eq('is_archived', false)
        .order('importance', { ascending: false })
        .order('confidence', { ascending: false })
        .limit(200)
    );
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Prompt 检索顺序：momi identity 全量 + 本轮关键词相关 top15。
 * 命中的记忆通过 touch_momi_memories 原子 hit_count+1。
 */
export async function getMemoriesForPrompt(message) {
  const all = await queryActiveMemories();
  const now = Date.now();
  const active = all.filter((m) => !m.expires_at || new Date(m.expires_at).getTime() > now);
  const identities = active.filter((m) => m.subject === 'momi' && m.memory_type === 'identity');
  const queryKeywords = extractMemoryKeywords(message);

  const scored = active
    .filter((m) => !(m.subject === 'momi' && m.memory_type === 'identity'))
    .map((m) => {
      const keys = Array.isArray(m.keywords) ? m.keywords : [];
      const overlap = keys.filter((k) => queryKeywords.some((q) => q.includes(k) || k.includes(q))).length;
      return { ...m, _score: overlap * 100 + (m.importance || 0) * 10 + Number(m.confidence || 0) };
    })
    .filter((m) => m._score >= 30 || queryKeywords.length === 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 15);

  const hitIds = scored.map((m) => m.id).filter(Boolean);
  if (hitIds.length) {
    fetchWithTimeout(() => supabase.rpc('touch_momi_memories', { p_ids: hitIds })).catch(() => {});
  }
  return { identities, relevant: scored };
}

/**
 * W2：每累计 20 条新对话（调用方控制触发）由 AI 抽取结构化记忆。
 * confidence 强制 <= 0.8；所有写入经过 RPC 去重。
 */
export async function extractAndSaveMemories(chatRecords) {
  if (!Array.isArray(chatRecords) || chatRecords.length === 0) return [];
  const chatText = chatRecords
    .slice(-20)
    .map((m) => `${m.user_id || m.sender || '用户'}: ${m.content || ''}`)
    .join('\n');

  const prompt = `从以下 momo 与 苞米 的对话中提取稳定、值得长期记住的信息，最多5条。
只输出严格 JSON 数组，不要 Markdown：
[{"subject":"momo|苞米|both|momi","memory_type":"personality|speech_style|habit|preference|dislike|milestone|fact|promise|ongoing","content":"简洁事实","keywords":["关键词"],"importance":1,"confidence":0.6}]
AI 推测的 confidence 不得超过 0.8；没有就返回 []。不要复制打卡、菜品等业务原始行。\n\n${chatText}`;

  const res = await sendChatCompletion({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 700,
  });
  if (!res.success || !res.text) return [];

  try {
    const raw = res.text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    const writes = [];
    for (const item of items.slice(0, 5)) {
      writes.push(await upsertMemory({
        ...item,
        source: 'ai_extracted',
        confidence: Math.min(0.8, Number(item.confidence) || 0.6),
      }));
    }
    return writes.filter((w) => w.success);
  } catch (err) {
    console.warn('[momiMemory] 解析记忆 JSON 失败:', err.message);
    return [];
  }
}

/**
 * M1-M4 日常维护（冷启动异步 + 每天最多一次）：
 * - 短期记忆 expires_at 到期归档
 * - importance<=2、hit_count=0、90天未命中归档
 * - 精确重复由数据库唯一索引/RPC 合并
 * - 冲突不删除旧记录，旧记录只归档；语义冲突由后续 AI 维护批次处理
 */
export async function runMemoryMaintenance({ force = false } = {}) {
  const key = 'last_memory_maintenance_at';
  try {
    const { data: cfg } = await fetchWithTimeout(() =>
      supabase.from('app_config').select('value').eq('key', key).maybeSingle()
    );
    const last = cfg && cfg.value ? new Date(cfg.value).getTime() : 0;
    if (!force && Date.now() - last < 24 * 60 * 60 * 1000) return { skipped: true };

    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();

    await fetchWithTimeout(() =>
      supabase
        .from('momi_memory')
        .update({ is_archived: true, updated_at: now })
        .eq('couple_id', MEMORY_COUPLE_ID)
        .eq('is_archived', false)
        .lt('expires_at', now)
    ).catch(() => {});

    await fetchWithTimeout(() =>
      supabase
        .from('momi_memory')
        .update({ is_archived: true, updated_at: now })
        .eq('couple_id', MEMORY_COUPLE_ID)
        .eq('is_archived', false)
        .lte('importance', 2)
        .eq('hit_count', 0)
        .lt('updated_at', cutoff)
        .neq('source', 'seed')
    ).catch(() => {});

    await fetchWithTimeout(() =>
      supabase.from('app_config').upsert([{ key, value: now, updated_at: now }], { onConflict: 'key' })
    );
    return { skipped: false, completedAt: now };
  } catch (err) {
    console.warn('[momiMemory] 维护异常:', err.message);
    return { skipped: false, error: err.message };
  }
}

export async function listMemories({ includeArchived = false } = {}) {
  try {
    let query = supabase
      .from('momi_memory')
      .select('*')
      .eq('couple_id', MEMORY_COUPLE_ID)
      .order('subject', { ascending: true })
      .order('importance', { ascending: false })
      .order('updated_at', { ascending: false });
    if (!includeArchived) query = query.eq('is_archived', false);
    const { data, error } = await fetchWithTimeout(() => query);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[momiMemory] 列表读取失败:', err.message);
    return [];
  }
}

export async function updateMemory(id, updates) {
  const allowed = {};
  for (const key of ['subject', 'memory_type', 'content', 'keywords', 'importance', 'expires_at', 'is_archived']) {
    if (Object.prototype.hasOwnProperty.call(updates || {}, key)) allowed[key] = updates[key];
  }
  allowed.updated_at = new Date().toISOString();
  const { data, error } = await fetchWithTimeout(() =>
    supabase.from('momi_memory').update(allowed).eq('id', id).select()
  );
  if (error) throw error;
  return data && data[0];
}

/** “删除”采用归档，保留成长轨迹；小本本的已归档视图可恢复。 */
export async function archiveMemory(id) {
  return updateMemory(id, { is_archived: true });
}
