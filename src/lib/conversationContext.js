// ═══════════════════════════════════════════════════════
// conversationContext.js —— 跨场景历史连续性上下文与预算管理
//
// 本模块只提供短期会话连续性，绝不充当“用户说过”的证据源。
// 可信长期记忆统一由 momiMemoryEvidenceStore 单独检索。
// ═══════════════════════════════════════════════════════

import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { getCoupleChatHistory } from './momiDataAccess';

const COUPLE_ID = 'momo_and_baomi';
const MAX_TOTAL_TOKENS = 6000;
const EMPTY_MEMORIES = Object.freeze({ identity: [], related: [] });

function safeErrorCode(error) {
  return String(error?.code || error?.name || 'UNKNOWN').slice(0, 80);
}

// 中文字符粗估: ~1.6 字符 / token
function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 1.6);
}

/**
 * 查同一 couple 的 momi_assistant_messages；历史 assistant 仅供语气连续。
 */
async function getAssistantRecentMessages(limit = 40) {
  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase
        .from('momi_assistant_messages')
        .select('*')
        .eq('couple_id', COUPLE_ID)
        .order('created_at', { ascending: false })
        .limit(limit)
    );
    if (error) {
      console.warn('[conversationContext] 助手历史查询失败:', safeErrorCode(error));
      return [];
    }
    return (data || []).reverse().map((message) => ({
      id: message.id,
      client_message_id: message.client_message_id || null,
      sender: message.sender_user_id || message.sender || 'momi',
      sender_type: message.sender_type || (message.sender === 'momi' ? 'assistant' : 'user'),
      content: message.content || '',
      content_type: message.content_type || 'text',
      image_urls: Array.isArray(message.image_urls) ? message.image_urls : [],
      is_proactive: Boolean(message.is_proactive),
      trigger_source: message.trigger_source,
      server_sequence: message.server_sequence ?? null,
      source: 'assistant',
      created_at: message.created_at,
    }));
  } catch (error) {
    console.warn('[conversationContext] 助手历史读取异常:', safeErrorCode(error));
    return [];
  }
}

/**
 * 获取最近 7 天的滚动摘要。摘要只能作为话题连续性提示，不能用于事实归因。
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
    if (error) {
      console.warn('[conversationContext] 每日摘要查询失败:', safeErrorCode(error));
      return [];
    }
    return data || [];
  } catch (error) {
    console.warn('[conversationContext] 每日摘要读取异常:', safeErrorCode(error));
    return [];
  }
}

async function getMainChatRecentMessages(limit) {
  try {
    return await getCoupleChatHistory({ limit });
  } catch (error) {
    console.warn('[conversationContext] 主聊天历史读取异常:', safeErrorCode(error));
    return [];
  }
}

/**
 * 异步补写计数型摘要（不得阻塞回复）。不让模型从摘要生成长期事实。
 */
export async function scheduleDailySummaryGeneration(dayString) {
  setTimeout(async () => {
    try {
      const dayStart = new Date(`${dayString}T00:00:00`);
      const dayEnd = new Date(`${dayString}T23:59:59.999`);
      const messages = await getCoupleChatHistory({ since: dayStart, until: dayEnd, limit: 100 });
      if (!messages || messages.length === 0) return;

      const summaryText = `共聊了 ${messages.length} 条消息（自动计数摘要，未提取人物事实）。`;
      const { error } = await supabase.from('momi_daily_summary').upsert([
        {
          couple_id: COUPLE_ID,
          day: dayString,
          summary: summaryText,
          message_count: messages.length,
          updated_at: new Date().toISOString(),
        },
      ]);
      if (error) throw error;
    } catch (error) {
      console.warn('[conversationContext] 每日摘要补写失败:', safeErrorCode(error));
    }
  }, 100);
}

function normalizeLocalMessage(message, scene) {
  const sender = message.sender_user_id || message.user_id || message.sender || '用户';
  const isImage = message.type === 'image'
    || message.content_type === 'image'
    || message.content_type === 'mixed'
    || Boolean(message.metadata?.image_url || message.image_url)
    || (Array.isArray(message.image_urls) && message.image_urls.length > 0);
  const content = String(message.content || '').trim() || (isImage ? '[图片]' : '');
  const imageUrls = Array.isArray(message.image_urls)
    ? message.image_urls
    : [message.metadata?.image_url || message.image_url].filter(Boolean);
  return {
    id: message.id,
    client_message_id: message.client_message_id || null,
    sender,
    sender_type: message.sender_type || (sender === 'momi' ? 'assistant' : 'user'),
    content,
    content_type: message.content_type || (isImage ? 'image' : 'text'),
    image_urls: imageUrls,
    status: message.status,
    server_sequence: message.server_sequence ?? null,
    source: scene === 'assistant' ? 'assistant' : 'main_chat',
    created_at: message.created_at || new Date().toISOString(),
  };
}

function stableMessageKey(message, index) {
  if (message.client_message_id) return `${message.source}:client:${message.client_message_id}`;
  if (message.id) return `${message.source}:id:${message.id}`;
  return `${message.source}:local:${index}:${message.created_at}`;
}

function compareMessages(left, right) {
  const timeDelta = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta;
  const leftSequence = Number(left.server_sequence);
  const rightSequence = Number(right.server_sequence);
  if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence) && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  return String(left.id || left.client_message_id || '').localeCompare(String(right.id || right.client_message_id || ''));
}

/**
 * 统一构建跨场景连续性上下文。
 */
export async function buildConversationContext({
  scene = 'assistant',
  userId,
  message = '',
  localMessages = [],
} = {}) {
  // 只拉历史与摘要；长期记忆由 chatWithMomi 独立走可信 evidence store。
  const [dbCoupleHistory, assistantHistory, dailySummaries] = await Promise.all([
    scene === 'chat_mention' && localMessages.length > 0
      ? Promise.resolve([])
      : getMainChatRecentMessages(40),
    scene === 'assistant' && localMessages.length > 0
      ? Promise.resolve([])
      : getAssistantRecentMessages(40),
    getDailySummaries(7),
  ]);

  let rawNearMessages = [];
  if (localMessages.length > 0) {
    rawNearMessages.push(...localMessages.map((item) => normalizeLocalMessage(item, scene)));
  }

  if (scene === 'assistant') {
    rawNearMessages.push(...(dbCoupleHistory || []).map((item) => ({
      id: item.id,
      client_message_id: item.client_message_id || null,
      sender: item.sender_user_id || item.sender,
      sender_type: item.sender_type || (item.sender === 'momi' ? 'assistant' : 'user'),
      content: item.content || '',
      content_type: item.content_type || item.type || 'text',
      image_urls: Array.isArray(item.image_urls) ? item.image_urls : [],
      server_sequence: item.server_sequence ?? null,
      source: 'main_chat',
      created_at: item.created_at,
    })));
  } else {
    rawNearMessages.push(...assistantHistory);
  }

  // source + client_message_id/id 去重；绝不按正文去重，避免双人同文消息被误删。
  const seen = new Set();
  const sortedNear = rawNearMessages
    .filter((item, index) => {
      const key = stableMessageKey(item, index);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareMessages)
    .slice(-40);

  let midSummaries = [...dailySummaries];
  const nearList = [...sortedNear];

  function calcTotalTokens() {
    let tokens = estimateTokens(message);
    for (const summary of midSummaries) tokens += estimateTokens(summary.summary);
    for (const item of nearList) tokens += estimateTokens(item.content);
    return tokens;
  }

  while (midSummaries.length > 0 && calcTotalTokens() > MAX_TOTAL_TOKENS) {
    midSummaries.shift();
  }
  while (nearList.length > 10 && calcTotalTokens() > MAX_TOTAL_TOKENS) {
    nearList.shift();
  }

  const historyMessages = nearList.map((item) => {
    const isMomi = item.sender_type === 'assistant' || item.sender === 'momi';
    const tag = item.source === 'main_chat' ? `[情侣主聊天/${item.sender}]` : `[momi助手/${item.sender}]`;
    if (isMomi) {
      return {
        role: 'assistant',
        content: `[历史 assistant 文案；仅供连续性；事实权重=0] ${item.content}`,
      };
    }
    return { role: 'user', content: `${tag}: ${item.content}` };
  });

  const historyBlockLines = [];
  if (midSummaries.length > 0) {
    historyBlockLines.push('【过去 7 天滚动摘要（仅供连续性，不能作为用户原话或长期事实证据）】');
    for (const summary of midSummaries) {
      historyBlockLines.push(`- ${summary.day} (共${summary.message_count}条): ${summary.summary}`);
    }
  }

  return {
    historyMessages,
    nearMessages: nearList,
    historyBlock: historyBlockLines.join('\n'),
    memories: { ...EMPTY_MEMORIES },
    sources: {
      actorId: userId || null,
      nearCount: nearList.length,
      summariesCount: midSummaries.length,
      hasMainChat: nearList.some((item) => item.source === 'main_chat'),
      hasAssistant: nearList.some((item) => item.source === 'assistant'),
      memorySource: 'momiMemoryEvidenceStore',
    },
  };
}
