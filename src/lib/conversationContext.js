// ═══════════════════════════════════════════════════════
// conversationContext.js —— 跨场景对话历史统一打通与多层级上下文预算管理
// ═══════════════════════════════════════════════════════

import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { getCoupleChatHistory } from './momiDataAccess';
import { getRelevantMemories, formatMemoryBlock } from './momiMemory';

const COUPLE_ID = 'momo_and_baomi';
const MAX_TOTAL_TOKENS = 6000;
// 中文字符粗估: ~1.6 字符 / token
function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 1.6);
}

/**
 * 查 momi_assistant_messages 表获取最近助手历史
 */
async function getAssistantRecentMessages(limit = 40) {
  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase
        .from('momi_assistant_messages')
        .select('id, sender, content, is_proactive, trigger_source, created_at')
        .order('created_at', { ascending: false })
        .limit(limit)
    );
    if (error) return [];
    return (data || []).reverse().map((m) => ({
      id: m.id,
      sender: m.sender || 'momi',
      content: m.content || '',
      source: 'assistant',
      created_at: m.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * 获取最近 7 天的每日滚动摘要
 */
async function getDailySummaries(daysCount = 7) {
  try {
    const sinceDate = new Date(Date.now() - daysCount * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const { data, error } = await fetchWithTimeout(() =>
      supabase
        .from('momi_daily_summary')
        .select('day, summary, message_count')
        .eq('couple_id', COUPLE_ID)
        .gte('day', sinceDate)
        .order('day', { ascending: true })
    );
    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}

/**
 * 异步补写某天的滚动摘要（不得阻塞对话回复）
 */
export async function scheduleDailySummaryGeneration(dayString) {
  setTimeout(async () => {
    try {
      const dayStart = new Date(`${dayString}T00:00:00`);
      const dayEnd = new Date(`${dayString}T23:59:59.999`);
      const msgs = await getCoupleChatHistory({ since: dayStart, until: dayEnd, limit: 100 });
      if (!msgs || msgs.length === 0) return;

      const summaryText = `共聊了 ${msgs.length} 条消息。主要话题涉及情侣日常互动。`;
      await supabase.from('momi_daily_summary').upsert([
        {
          couple_id: COUPLE_ID,
          day: dayString,
          summary: summaryText,
          message_count: msgs.length,
          updated_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      console.warn('[conversationContext] 每日摘要补写失败:', err.message);
    }
  }, 100);
}

/**
 * 统一构建跨场景对话上下文
 * @param {object} params
 * @param {string} params.scene - 'assistant' | 'chat_mention' | 'proactive'
 * @param {string} params.userId - 当前操作用户
 * @param {string} [params.message=''] - 本轮输入文本
 * @param {Array} [params.localMessages=[]] - 调用方已持有的本地消息列表
 * @returns {Promise<{ historyMessages: Array, historyBlock: string, memories: object, sources: object }>}
 */
export async function buildConversationContext({
  scene = 'assistant',
  _userId,
  message = '',
  localMessages = [],
} = {}) {
  // 1) 并行拉取：主聊天近端 + 助手聊天近端 + 最近 7 天摘要 + 相关记忆
  const [dbCoupleHistory, assistantHistory, dailySummaries, memories] = await Promise.all([
    scene === 'chat_mention' && localMessages.length > 0
      ? Promise.resolve([])
      : getCoupleChatHistory({ limit: 40 }).catch(() => []),
    scene === 'assistant' && localMessages.length > 0
      ? Promise.resolve([])
      : getAssistantRecentMessages(40).catch(() => []),
    getDailySummaries(7).catch(() => []),
    getRelevantMemories(message).catch(() => ({ identity: [], related: [] })),
  ]);

  // 2) 近端合并与规范化
  let rawNearMessages = [];

  // 若由屏幕传入 localMessages，按其类型转化
  if (localMessages && localMessages.length > 0) {
    const formattedLocal = localMessages.map((m) => {
      const sender = m.user_id || m.sender || '用户';
      const isImg = m.type === 'image' || m.content_type === 'image' || Boolean(m.metadata?.image_url || m.image_url);
      const content = (m.content || '').trim() || (isImg ? '[图片]' : '');
      const source = scene === 'assistant' ? 'assistant' : 'main_chat';
      return {
        id: m.id,
        sender,
        content,
        source,
        created_at: m.created_at || new Date().toISOString(),
      };
    });
    rawNearMessages.push(...formattedLocal);
  }

  // 补充另一端的历史以实现两处互通
  if (scene === 'assistant') {
    const mainChatMapped = (dbCoupleHistory || []).map((m) => ({
      id: m.id,
      sender: m.sender,
      content: m.content,
      source: 'main_chat',
      created_at: m.created_at,
    }));
    rawNearMessages.push(...mainChatMapped);
  } else {
    rawNearMessages.push(...(assistantHistory || []));
  }

  // 按时间升序排序并去重
  const seenIds = new Set();
  const sortedNear = rawNearMessages
    .filter((m) => {
      if (!m.id) return true;
      if (seenIds.has(m.id)) return false;
      seenIds.add(m.id);
      return true;
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-40); // 最多 40 条近端原文

  // 3) 预算控制 (~6000 tokens)
  let midSummaries = [...dailySummaries];
  let relevantMemories = { ...memories };
  let nearList = [...sortedNear];

  function calcTotalTokens() {
    let tokens = 0;
    for (const s of midSummaries) tokens += estimateTokens(s.summary);
    tokens += estimateTokens(formatMemoryBlock(relevantMemories));
    for (const n of nearList) tokens += estimateTokens(n.content);
    return tokens;
  }

  // 超出时裁剪顺序：1. 先删中端摘要的最旧日期
  while (midSummaries.length > 0 && calcTotalTokens() > MAX_TOTAL_TOKENS) {
    midSummaries.shift();
  }

  // 2. 再删远端记忆
  if (calcTotalTokens() > MAX_TOTAL_TOKENS && relevantMemories.related?.length > 0) {
    relevantMemories.related = relevantMemories.related.slice(0, 1);
  }

  // 3. 最后才动近端原文（从旧到新裁）
  while (nearList.length > 10 && calcTotalTokens() > MAX_TOTAL_TOKENS) {
    nearList.shift();
  }

  // 4) 格式化输出
  const historyMessages = nearList.map((m) => {
    const isMomi = m.sender === 'momi';
    const tag = m.source === 'main_chat' ? `[情侣主聊天/${m.sender}]` : `[momi助手/${m.sender}]`;
    if (isMomi) {
      return { role: 'assistant', content: m.content };
    }
    return {
      role: 'user',
      content: `${tag}: ${m.content}`,
    };
  });

  const historyBlockLines = [];
  if (midSummaries.length > 0) {
    historyBlockLines.push('【过去 7 天滚动摘要】');
    for (const s of midSummaries) {
      historyBlockLines.push(`- ${s.day} (共${s.message_count}条): ${s.summary}`);
    }
  }

  const historyBlock = historyBlockLines.join('\n');

  return {
    historyMessages,
    nearMessages: nearList,
    historyBlock,
    memories: relevantMemories,
    sources: {
      nearCount: nearList.length,
      summariesCount: midSummaries.length,
      hasMainChat: nearList.some((m) => m.source === 'main_chat'),
      hasAssistant: nearList.some((m) => m.source === 'assistant'),
    },
  };
}
