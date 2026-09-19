// 跨场景短期会话上下文；当前轮只允许在最终 messages 中出现一次
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { getCoupleChatHistory } from './momiDataAccess';

const COUPLE_ID = 'momo_and_baomi';
const MAX_TOTAL_TOKENS = 6000;
const EMPTY_MEMORIES = Object.freeze({ identity: [], related: [] });

function safeErrorCode(error) {
  return String(error?.code || error?.name || 'UNKNOWN').slice(0, 80);
}
function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 1.6);
}

async function getAssistantRecentMessages(limit = 40) {
  try {
    const { data, error } = await fetchWithTimeout(() => supabase
      .from('momi_assistant_messages')
      .select('*')
      .eq('couple_id', COUPLE_ID)
      .order('created_at', { ascending: false })
      .limit(limit));
    if (error) {
      console.warn('[conversationContext] 助手历史查询失败:', safeErrorCode(error));
      return [];
    }
    return (data || []).reverse().map((item) => ({
      id: item.id,
      client_message_id: item.client_message_id || null,
      sender: item.sender_user_id || item.sender || 'momi',
      sender_type: item.sender_type || (item.sender === 'momi' ? 'assistant' : 'user'),
      content: item.content || '',
      content_type: item.content_type || 'text',
      image_urls: Array.isArray(item.image_urls) ? item.image_urls : [],
      is_proactive: Boolean(item.is_proactive),
      trigger_source: item.trigger_source,
      server_sequence: item.server_sequence ?? null,
      source: 'assistant',
      created_at: item.created_at,
    }));
  } catch (error) {
    console.warn('[conversationContext] 助手历史读取异常:', safeErrorCode(error));
    return [];
  }
}

async function getDailySummaries(daysCount = 7) {
  try {
    const sinceDate = new Date(Date.now() - daysCount * 86400000).toISOString().slice(0, 10);
    const { data, error } = await fetchWithTimeout(() => supabase
      .from('momi_daily_summary')
      .select('day, summary, message_count')
      .eq('couple_id', COUPLE_ID)
      .gte('day', sinceDate)
      .order('day', { ascending: true }));
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

export async function scheduleDailySummaryGeneration(dayString) {
  setTimeout(async () => {
    try {
      const dayStart = new Date(`${dayString}T00:00:00`);
      const dayEnd = new Date(`${dayString}T23:59:59.999`);
      const messages = await getCoupleChatHistory({ since: dayStart, until: dayEnd, limit: 100 });
      if (!messages?.length) return;
      const { error } = await supabase.from('momi_daily_summary').upsert([{
        couple_id: COUPLE_ID,
        day: dayString,
        summary: `共聊了 ${messages.length} 条消息（自动计数摘要，未提取人物事实）。`,
        message_count: messages.length,
        updated_at: new Date().toISOString(),
      }]);
      if (error) throw error;
    } catch (error) {
      console.warn('[conversationContext] 每日摘要补写失败:', safeErrorCode(error));
    }
  }, 100);
}

function normalizeLocalMessage(item, scene) {
  const sender = item.sender_user_id || item.user_id || item.sender || '用户';
  const isImage = item.type === 'image' || item.content_type === 'image' || item.content_type === 'mixed'
    || Boolean(item.metadata?.image_url || item.image_url)
    || (Array.isArray(item.image_urls) && item.image_urls.length > 0);
  return {
    id: item.id,
    client_message_id: item.client_message_id || null,
    sender,
    sender_type: item.sender_type || (sender === 'momi' ? 'assistant' : 'user'),
    content: String(item.content || '').trim() || (isImage ? '[图片]' : ''),
    content_type: item.content_type || (isImage ? 'image' : 'text'),
    image_urls: Array.isArray(item.image_urls)
      ? item.image_urls
      : [item.metadata?.image_url || item.image_url].filter(Boolean),
    status: item.status,
    server_sequence: item.server_sequence ?? null,
    source: scene === 'assistant' ? 'assistant' : 'main_chat',
    created_at: item.created_at || new Date().toISOString(),
  };
}

function stableMessageKey(item, index) {
  if (item.client_message_id) return `${item.source}:client:${item.client_message_id}`;
  if (item.id) return `${item.source}:id:${item.id}`;
  return `${item.source}:local:${index}:${item.created_at}`;
}
function compareMessages(left, right) {
  const delta = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  if (Number.isFinite(delta) && delta !== 0) return delta;
  const leftSequence = Number(left.server_sequence);
  const rightSequence = Number(right.server_sequence);
  if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence) && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  return String(left.id || left.client_message_id || '').localeCompare(String(right.id || right.client_message_id || ''));
}

/** 删除本轮 user message：chatWithMomi 会在历史之后再次追加它。 */
export function removeCurrentTurnFromHistory(items, { scene, userId, message } = {}) {
  const out = [...(items || [])];
  if (scene !== 'assistant' || !message) return out;
  for (let index = out.length - 1; index >= 0; index -= 1) {
    const item = out[index];
    const isUser = item.sender_type !== 'assistant' && item.sender !== 'momi';
    if (isUser && item.sender === userId && String(item.content || '').trim() === String(message).trim()) {
      out.splice(index, 1);
      break;
    }
  }
  return out;
}

export async function buildConversationContext({ scene = 'assistant', userId, message = '', localMessages = [] } = {}) {
  const [dbCoupleHistory, assistantHistory, dailySummaries] = await Promise.all([
    scene === 'chat_mention' && localMessages.length ? Promise.resolve([]) : getMainChatRecentMessages(40),
    scene === 'assistant' && localMessages.length ? Promise.resolve([]) : getAssistantRecentMessages(40),
    getDailySummaries(7),
  ]);

  let rawNearMessages = localMessages.map((item) => normalizeLocalMessage(item, scene));
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

  const seen = new Set();
  const unique = rawNearMessages.filter((item, index) => {
    const key = stableMessageKey(item, index);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort(compareMessages);

  let nearList = removeCurrentTurnFromHistory(unique, { scene, userId, message }).slice(-40);
  const midSummaries = [...dailySummaries];
  const totalTokens = () => estimateTokens(message)
    + midSummaries.reduce((sum, item) => sum + estimateTokens(item.summary), 0)
    + nearList.reduce((sum, item) => sum + estimateTokens(item.content), 0);
  while (midSummaries.length && totalTokens() > MAX_TOTAL_TOKENS) midSummaries.shift();
  while (nearList.length > 10 && totalTokens() > MAX_TOTAL_TOKENS) nearList.shift();

  const historyMessages = nearList.map((item) => {
    const isMomi = item.sender_type === 'assistant' || item.sender === 'momi';
    if (isMomi) {
      return { role: 'assistant', content: String(item.content || '').replace(/\[(?:历史\s*assistant\s*文案|事实权重\s*=\s*0|仅供(?:语气)?连续)[^\]]*\]/gi, '').trim() };
    }
    const tag = item.source === 'main_chat' ? `[情侣主聊天/${item.sender}]` : `[momi助手/${item.sender}]`;
    return { role: 'user', content: `${tag}: ${item.content}` };
  });

  const historyBlockLines = [];
  if (midSummaries.length) {
    historyBlockLines.push('【过去 7 天滚动摘要（仅供连续性，不能作为用户原话或长期事实证据）】');
    midSummaries.forEach((item) => historyBlockLines.push(`- ${item.day} (共${item.message_count}条): ${item.summary}`));
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
