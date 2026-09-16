// ═══════════════════════════════════════════════════════
// momi 伴侣业务核心 (momiAssistant.js) — V2
// 识图 / 全量数据按需访问 / 结构化记忆 / 持久情绪 / 主动触发统一入口
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { sendChatCompletion, localUriToDataUrl, compressImageForAI } from './aiProvider';
import { queryByIntent, queryRecipeIfAsked, getDataDigest } from './momiDataAccess';
import { buildConversationContext } from './conversationContext';
import { MOMI_PERSONA_CORE, DATA_CAPABILITIES_BLOCK, SCENE_RULES } from './momiPersona';
import {
  ensureIdentitySeeds,
  getRelevantMemories,
  saveExplicitMemory,
  parseExplicitMemory,
  extractAndSaveMemories,
} from './momiMemory';
import {
  getMomiState,
  applyInteraction,
  scoreRudenessLocally,
  buildEmotionPromptBlock,
} from './momiState';

export const COUPLE_ID = 'momo_and_baomi';
export const MOMI_CHAT_BUCKET = 'momi-chat';
const ASSISTANT_LOCAL_CACHE_KEY = '@momi_assistant_messages_local';

async function getLocalAssistantMessages() {
  try {
    const raw = await AsyncStorage.getItem(ASSISTANT_LOCAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function appendLocalAssistantMessage(msg) {
  if (!msg) return;
  try {
    const list = await getLocalAssistantMessages();
    if (list.some((m) => m.id === msg.id)) return;
    list.push(msg);
    await AsyncStorage.setItem(ASSISTANT_LOCAL_CACHE_KEY, JSON.stringify(list.slice(-200)));
  } catch (e) {
    console.warn('[momiAssistant] 缓存本地消息异常:', e.message);
  }
}

/**
 * 上传 momi 聊天图片到公开 momi-chat bucket（双人共享必须先上传，不能只存本地 URI）。
 * 返回 { urls, paths }；失败明确抛错，由 UI 告知用户，不静默丢图。
 */
export async function uploadMomiChatImages(localUris = [], onProgress) {
  const urls = [];
  const paths = [];
  for (let i = 0; i < localUris.length; i += 1) {
    const uri = localUris[i];
    if (/^https?:\/\//i.test(uri)) {
      urls.push(uri);
      paths.push(null);
      if (onProgress) onProgress((i + 1) / localUris.length);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const compressed = await compressImageForAI(uri);
      const file = new File(compressed);
      // eslint-disable-next-line no-await-in-loop
      const bytes = await file.arrayBuffer();
      const path = `chat/${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabase.storage.from(MOMI_CHAT_BUCKET).upload(path, bytes, {
        contentType: 'image/jpeg', upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from(MOMI_CHAT_BUCKET).getPublicUrl(path);
      if (!data?.publicUrl) throw new Error('未取得图片公开 URL');
      urls.push(data.publicUrl);
      paths.push(path);
      if (onProgress) onProgress((i + 1) / localUris.length);
    } catch (err) {
      throw new Error(`第 ${i + 1} 张图片上传失败：${err.message}`);
    }
  }
  return { urls, paths };
}

function formatMemoryBlock(memories) {
  const identity = memories.identity?.map((m) => `- ${m.content}`).join('\n') || '- 我是 momi';
  const related = memories.related?.map((m) => `- [${m.subject}/${m.memory_type}] ${m.content}`).join('\n') || '- 本轮暂无额外相关记忆';
  return `【momi 身份人格】\n${identity}\n\n【与本轮相关的长期记忆】\n${related}`;
}

function formatDigest(digest) {
  try {
    return JSON.stringify(digest || {}, null, 0).slice(0, 5000);
  } catch {
    return '{}';
  }
}

export function formatWeatherBlock(weather) {
  if (!weather) return '';
  if (weather.error === 'WEATHER_UNAVAILABLE') {
    const reasonGuide = {
      no_city: '用户未设置城市且无法获取定位，请提示用户：“去 momi 助手设置里填下城市或开启定位权限 🐾”。',
      no_permission: '定位权限未开启或被拒绝，请提示用户：“去 momi 助手设置开启定位权限，或者手动填一下城市哦 🐾”。',
      network: '拉取天气超时或网络异常，请告知用户：“天气没拉到，稍后再问我一次哦 🐾”。',
      api_error: '天气服务暂时响应异常，请告知用户：“天气服务开小差了，稍后再问我一次哦 🐾”。',
    };
    const guide = reasonGuide[weather.reason] || reasonGuide.api_error;
    return `\n【当前天气信息不可用】\n原因：${weather.reason || 'unknown'}。\n回复指导：${guide}\n禁止假装知道天气，也禁止生硬报错，请用亲切可爱的语气给用户可操作指引。`;
  }
  if (weather.current && weather.today) {
    return `\n【实时天气数据】
- 城市：${weather.location}（更新时间：${weather.updatedAt}）
- 当前天气：${weather.current.desc}，实时气温 ${weather.current.temp}℃（体感 ${weather.current.feelsLike}℃）
- 今日天气：${weather.today.desc}，最高 ${weather.today.max}℃ / 最低 ${weather.today.min}℃，降雨概率 ${weather.today.rainProb}%
- 明日预报：${weather.tomorrow.desc}，最高 ${weather.tomorrow.max}℃ / 最低 ${weather.tomorrow.min}℃，降雨概率 ${weather.tomorrow.rainProb}%
- 贴心建议：${weather.advice}
【回答硬性约束】本轮上下文已包含真实权威的天气数据！有天气数据时，你必须直接回答具体气温、天气与穿衣带伞建议，绝对禁止说不知道天气或建议去看天气预报。`;
  }
  return '';
}

/**
 * 构建 system prompt。保留旧 context 字段兼容测试/调用。
 * 固定拼装顺序：人格核心、场景规则、记忆、情绪、数据摘要、精确查询结果、天气、历史上下文、输出格式约束。
 */
export function buildSystemPrompt(context = {}) {
  const sceneKey = context.scene || 'assistant';
  const sceneRule = SCENE_RULES[sceneKey] || SCENE_RULES.assistant;

  const memoryBlock = context.memoryBlock || `【关于 momo】：${context.momoMemory || '暂无'}\n【关于 苞米】：${context.baomiMemory || '暂无'}\n【两人的共同记忆】：${context.coupleMemory || '暂无'}`;
  const emotionBlock = context.emotionBlock ? `\n\n${context.emotionBlock}` : '';
  const digestBlock = context.digestBlock ? `\n\n【业务数据全局摘要】${context.digestBlock}` : '';
  const legacyKitchen = context.dishTitles ? `\n\n【momi厨房菜品库】：${context.dishTitles} (共 ${context.dishesCount || 0} 道菜)` : '';
  const legacyCapsules = context.openedCapsulesSummary ? `\n\n【恋爱足迹与已拆封信件】：${context.openedCapsulesSummary}` : '';
  const dataBlock = context.preciseData ? `\n\n【本轮实时精确查询结果】${JSON.stringify(context.preciseData)}` : '';
  const weatherBlock = context.weatherBlock ? `\n\n${context.weatherBlock}` : (context.weatherData ? `\n\n${formatWeatherBlock(context.weatherData)}` : '');
  const historyBlock = context.historyBlock ? `\n\n${context.historyBlock}` : '';

  const taskCreated = context.preciseData?.taskCreated;
  const taskBlock = taskCreated
    ? `\n\n【定时任务/闹钟设定成功】\n已成功为他们创建了定时任务提醒！\n- 任务标题：${taskCreated.title}\n- 设定时间：${taskCreated.due_at}\n【回答硬性约束】请务必亲切开心地向用户确认该提醒已设定好，告诉用户到时间 momi 会准时叫他们 🐾`
    : (context.preciseData?.intent?.intent === 'tasks' && context.preciseData?.intent?.data?.summary
      ? `\n\n【进行中的定时提醒与待办列表】\n${context.preciseData.intent.data.summary}`
      : '');

  const webSearchResult = context.preciseData?.intent?.intent === 'web_search' ? context.preciseData.intent.data : null;
  const webSearchBlock = webSearchResult
    ? `\n\n【实时外网信息检索结果】\n关键词：${webSearchResult.query}\n检索结果内容：\n${webSearchResult.formattedText || '未检索到更多直接内容'}\n【回答硬性约束】本轮上下文已包含外网实时检索权威结果，请直接结合上述内容回答用户，证明你具备实时查询外网信息的能力！`
    : '';

  return `${MOMI_PERSONA_CORE}

${DATA_CAPABILITIES_BLOCK}

${sceneRule.guideline}
${sceneRule.lengthConstraint}

${memoryBlock}${emotionBlock}${digestBlock}${legacyKitchen}${legacyCapsules}${dataBlock}${taskBlock}${webSearchBlock}${weatherBlock}${historyBlock}

【输出格式约束】
回答正文后另起一行输出隐藏机器标记：<momi_meta>{"rudeness":0}</momi_meta>，rudeness 为用户本轮粗鲁度 0-10。正文不得提及此标记。`.trim();
}

/**
 * 兼容旧 API：聚合轻量 V2 上下文（不再拉全表塞 prompt）。
 */
export async function fetchAssistantContext(message = '') {
  const [digest, memories, state, precise] = await Promise.all([
    getDataDigest(),
    getRelevantMemories(message),
    getMomiState(),
    queryByIntent(message),
  ]);
  return {
    memoryBlock: formatMemoryBlock(memories),
    emotionBlock: buildEmotionPromptBlock(state),
    digestBlock: formatDigest(digest),
    preciseData: precise,
    state,
    memories,
    digest,
  };
}

function parseAssistantOutput(text) {
  const raw = String(text || '');
  const match = raw.match(/<momi_meta>([\s\S]*?)<\/momi_meta>/i);
  let rudeness = 0;
  if (match) {
    try {
      const meta = JSON.parse(match[1]);
      rudeness = Math.max(0, Math.min(10, Number(meta.rudeness) || 0));
    } catch {}
  }
  return {
    content: raw.replace(/\s*<momi_meta>[\s\S]*?<\/momi_meta>\s*/gi, '').trim(),
    rudeness,
  };
}

export function historyToMessages(history, { maxMessages = 16, maxImages = 2 } = {}) {
  const out = [];
  let remainingHistoricalImages = maxImages;
  // 从新到旧决定哪 2 张图保留，然后恢复顺序
  const prepared = (history || []).slice(-maxMessages).reverse().map((item) => {
    const rawUrls = Array.isArray(item.image_urls) ? item.image_urls : [];
    // 严格过滤：必须是合法的 http://, https:// 或 data:image/，严禁把相对存储路径（如 uploads/photo_...jpg）作为 image_url 送给模型
    let validUrls = rawUrls.filter((url) => typeof url === 'string' && (/^https?:\/\//i.test(url) || url.startsWith('data:image/')));
    if (validUrls.length > remainingHistoricalImages) validUrls = validUrls.slice(0, remainingHistoricalImages);
    remainingHistoricalImages -= validUrls.length;
    if (remainingHistoricalImages < 0) remainingHistoricalImages = 0;
    return { item, imageUrls: validUrls, hadAnyImage: rawUrls.length > 0 };
  }).reverse();

  for (const { item, imageUrls, hadAnyImage } of prepared) {
    const isMomi = item.sender === 'momi' || item.role === 'assistant' || item.user_id === 'momi';
    if (isMomi) {
      out.push({ role: 'assistant', content: item.content || '' });
      continue;
    }
    const sender = item.sender || item.user_id || '用户';
    const sourceTag = item.source === 'main_chat' ? '[主聊天]' : (item.source === 'assistant' ? '[momi助手]' : '');
    const prefix = sourceTag ? `${sourceTag}[${sender}]` : `[${sender}]`;
    if (imageUrls.length) {
      out.push({
        role: 'user',
        content: [
          { type: 'text', text: `${prefix}: ${item.content || '[图片]'}` },
          ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      });
    } else {
      const hadImage = item.content_type === 'image' || item.content_type === 'mixed' || hadAnyImage;
      out.push({ role: 'user', content: `${prefix}: ${item.content || ''}${hadImage ? ' [图片]' : ''}` });
    }
  }
  return out;
}

/**
 * momi 统一对话入口
 * triggerSource: 'assistant' | 'chat_mention' | 'proactive' | 'scheduled'
 */
export async function chatWithMomi({
  userId,
  message = '',
  images = [],
  recentChatHistory = [],
  triggerSource = 'assistant',
}) {
  // 1) 轻量意图分类：数据 / 配方 / 显式记忆 / 天气 / 聊天历史
  const explicit = parseExplicitMemory(message, userId);
  let preciseData = null;
  let weatherData = null;
  try {
    const [intentResult, recipeResult] = await Promise.all([
      queryByIntent(message, { userId }),
      queryRecipeIfAsked(message),
    ]);
    preciseData = { intent: intentResult, recipe: recipeResult };
    if (intentResult?.intent === 'weather') {
      weatherData = intentResult.data;
    }
  } catch (err) {
    return {
      success: false, content: '', reply: `momi 查询数据时失败了：${err.message}`,
      emotionDelta: null, memoryWrites: [], usedFallbackModel: false, errorCode: 'DATA_QUERY_FAILED',
    };
  }

  // 1.5) 定时任务/提醒设定解析与创建（如果用户提出了提醒需求）
  try {
    const { createTaskFromMessage, parseReminderLocally } = require('./momiTasks');
    const parsedReminder = parseReminderLocally(message);
    if (parsedReminder) {
      const created = await createTaskFromMessage({
        userId,
        message,
        sourceMessageId: null,
      });
      if (created) {
        preciseData = preciseData || {};
        preciseData.taskCreated = created;
      }
    }
  } catch (taskErr) {
    console.warn('[momiAssistant] 解析/创建定时任务异常:', taskErr.message);
  }

  // 1.6) 外网检索兜底匹配（若用户显式要求查询外网但未被 intent 拦截）
  if (!preciseData?.intent && /(查|搜索|搜).*外网|外网.*(信息|消息)|上网查|查一下最新|外网/i.test(message)) {
    try {
      const { searchWeb } = require('./webSearchService');
      const searchRes = await searchWeb(message);
      if (searchRes) {
        preciseData = preciseData || {};
        preciseData.intent = { intent: 'web_search', data: searchRes };
      }
    } catch (searchErr) {
      console.warn('[momiAssistant] 外网检索触发异常:', searchErr.message);
    }
  }

  // 跨场景多层级上下文构建（近端40条打通主聊天与助手 + 7天滚动摘要）
  const convContext = await buildConversationContext({
    scene: triggerSource,
    userId,
    message,
    localMessages: recentChatHistory,
  }).catch((err) => {
    console.warn('[momiAssistant] 构建跨场景上下文异常:', err.message);
    return null;
  });

  // 2-4) state + digest + 相关记忆，按预算拼 system prompt
  const [stateBefore, digest, memories] = await Promise.all([
    getMomiState(),
    getDataDigest(),
    convContext?.memories || getRelevantMemories(message),
  ]);
  const systemPrompt = buildSystemPrompt({
    scene: triggerSource,
    memoryBlock: formatMemoryBlock(memories),
    emotionBlock: buildEmotionPromptBlock(stateBefore),
    digestBlock: formatDigest(digest),
    preciseData,
    weatherData,
    historyBlock: convContext?.historyBlock || '',
  });

  // 5) 组装 messages：合并跨场景近端历史（最多40条），本轮图片绝不静默丢弃
  const effectiveHistory = convContext?.nearMessages?.length ? convContext.nearMessages : recentChatHistory;
  const messages = [{ role: 'system', content: systemPrompt }, ...historyToMessages(effectiveHistory, { maxMessages: 40 })];
  const preparedImages = [];
  if (images.length) {
    for (const uri of images) {
      let url = uri;
      if (typeof url === 'string' && !/^https?:\/\//i.test(url) && !url.startsWith('data:')) {
        if (url.startsWith('file://') || url.startsWith('/')) {
          // eslint-disable-next-line no-await-in-loop
          url = await localUriToDataUrl(url);
        } else {
          // Supabase Storage 路径（如 uploads/photo_...jpg 或 chat/...）
          try {
            const bucket = url.startsWith('chat/') ? MOMI_CHAT_BUCKET : 'photos';
            // eslint-disable-next-line no-await-in-loop
            const { data } = await supabase.storage.from(bucket).createSignedUrl(url, 3600);
            url = data?.signedUrl || '';
          } catch {
            url = '';
          }
        }
      } else if (typeof url === 'string' && !url.startsWith('data:') && !/^https?:\/\//i.test(url)) {
        // eslint-disable-next-line no-await-in-loop
        url = await localUriToDataUrl(url);
      }
      if (!url) {
        console.warn('[momiAssistant] 无法解析图片有效 URL，已忽略:', uri);
        continue;
      }
      preparedImages.push(url);
    }
    if (preparedImages.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: `[${userId}]: ${message || '看看这张图片'}` },
          ...preparedImages.map((u) => ({ type: 'image_url', image_url: { url: u } })),
        ],
      });
    } else {
      messages.push({ role: 'user', content: `[${userId}]: ${message || '[图片]'}` });
    }
  } else {
    messages.push({ role: 'user', content: `[${userId}]: ${message}` });
  }

  const maxTokensMap = {
    assistant: 350,
    chat_mention: 220,
    proactive: 160,
  };
  const max_tokens = maxTokensMap[triggerSource] || 350;

  const res = await sendChatCompletion({
    messages,
    temperature: 0.75,
    top_p: 0.9,
    max_tokens,
    requiresVision: preparedImages.length > 0,
  });
  if (!res.success) {
    let reply = res.error;
    if (res.errorCode === 'VISION_UNSUPPORTED') {
      reply = '现在这个模型看不了图，去 momi 设置里换支持识图的模型 🐾';
    }
    return {
      success: false,
      content: '',
      reply,
      emotionDelta: null,
      memoryWrites: [],
      usedFallbackModel: false,
      errorCode: res.errorCode,
    };
  }

  // 6) 解析回复并更新持久情绪：本地粗鲁词表 + AI 评分取高
  const parsed = parseAssistantOutput(res.text);
  const rudeness = Math.max(scoreRudenessLocally(message), parsed.rudeness);
  const stateResult = await applyInteraction({ userId, rudeness, text: message });

  // 7) 用户明确要求记住：立即结构化写入，importance=5/confidence=1
  const memoryWrites = [];
  if (explicit) {
    const saved = await saveExplicitMemory(message, userId);
    if (saved) memoryWrites.push(saved);
  }

  let content = parsed.content;
  if (explicit && memoryWrites.length && !/记住|小本本|不会忘/.test(content)) {
    content = `记住了！${explicit.content}，momi 已经写进小本本啦～ 🐾\n${content}`.trim();
  }
  if (stateResult.leveledUp) {
    content += `\n\n✨ momi 升到 Lv.${stateResult.newLevel} 啦！谢谢你们一直陪着我～`;
  }

  return {
    success: true,
    content,
    reply: content, // 兼容旧 UI
    emotionDelta: stateResult.emotionDelta,
    memoryWrites,
    usedFallbackModel: Boolean(res.usedFallbackModel),
    errorCode: null,
    state: stateResult.state,
  };
}

/**
 * 读取 momi 独立聊天历史（云端优先，异常时本地缓存）
 */
export async function fetchAssistantMessages(limit = 80) {
  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase
        .from('momi_assistant_messages')
        .select('*')
        .eq('couple_id', COUPLE_ID)
        .order('created_at', { ascending: true })
        .limit(limit)
    );
    if (!error && data) {
      await AsyncStorage.setItem(ASSISTANT_LOCAL_CACHE_KEY, JSON.stringify(data)).catch(() => {});
      return data;
    }
    if (error) throw error;
  } catch (err) {
    console.warn('[momiAssistant] 云端拉取历史失败，切换本地:', err.message);
  }
  return (await getLocalAssistantMessages()).slice(-limit);
}

/**
 * 云端 + 本地双写；支持图片、多图、主动消息及触发源。
 * 云端失败时本地保存，但会明确 console.warn，不再静默。
 */
export async function saveAssistantMessage({
  sender,
  content = '',
  imageUrls = [],
  imagePaths = [],
  isProactive = false,
  triggerSource = 'assistant',
}) {
  const now = new Date().toISOString();
  const contentType = imageUrls.length ? (content ? 'mixed' : 'image') : 'text';
  const localId = `momi_msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    couple_id: COUPLE_ID,
    sender,
    content,
    image_urls: imageUrls,
    image_paths: imagePaths.filter(Boolean),
    content_type: contentType,
    is_proactive: Boolean(isProactive),
    trigger_source: triggerSource,
  };
  const fallback = { id: localId, ...payload, created_at: now };

  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase.from('momi_assistant_messages').insert([payload]).select()
    );
    if (!error && data?.[0]) {
      await appendLocalAssistantMessage(data[0]);
      return data[0];
    }
    if (error) {
      if (error.code === '42703' || error.code === '42P01') {
        console.error('[momiAssistant] 请先执行 momi_upgrade_schema.sql（消息新字段/表尚不存在）');
      }
      console.warn('[momiAssistant] 云端保存消息失败，已保存在本地:', error.message);
    }
  } catch (err) {
    console.warn('[momiAssistant] 保存消息网络异常，已保存在本地:', err.message);
  }
  await appendLocalAssistantMessage(fallback);
  return fallback;
}

// 保留旧导出名，内部转给新的结构化记忆模块
export { extractAndSaveMemories, ensureIdentitySeeds };
