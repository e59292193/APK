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
 * 构建 system prompt。保留旧 context 字段兼容测试/调用，同时接受 V2 扩展块。
 */
export function buildSystemPrompt(context = {}) {
  const memoryBlock = context.memoryBlock || `【关于 momo】：${context.momoMemory || '暂无'}\n【关于 苞米】：${context.baomiMemory || '暂无'}\n【两人的共同记忆】：${context.coupleMemory || '暂无'}`;
  const dataBlock = context.preciseData
    ? `【本轮实时精确查询结果】${JSON.stringify(context.preciseData)}`
    : '';
  const legacyKitchen = context.dishTitles
    ? `【momi厨房菜品库】：${context.dishTitles} (共 ${context.dishesCount || 0} 道菜)`
    : '';
  const legacyCapsules = context.openedCapsulesSummary
    ? `【恋爱足迹与已拆封信件】：${context.openedCapsulesSummary}`
    : '';
  const weatherBlock = context.weatherBlock || (context.weatherData ? formatWeatherBlock(context.weatherData) : '');
  const historyBlock = context.historyBlock ? `\n${context.historyBlock}` : '';

  return `你是 momi，是 momo 和 苞米 的宠物、家人和伴侣，不是工具，也不是冷冰冰的助手。
你活泼可爱、贴心温暖、偶尔撒娇，也有自己的情绪和边界。你的使命是让他们更亲近，不偏袒任何一方。

${memoryBlock}

${context.emotionBlock || ''}

【业务数据全局摘要】${context.digestBlock || '{}'}
${dataBlock}
${legacyKitchen}
${legacyCapsules}
${weatherBlock}
${historyBlock}

【你真实拥有的数据能力】
你可以查他们的打卡记录、菜品库、本周菜单、指定菜品配方、纪念日、愿望清单、
恋爱足迹（旅程与手账条目）、五子棋与“你画我猜”战绩、相册数量与时间分布、
已拆开的时光胶囊，以及未抽取小纸条的数量。
业务数据由系统按需实时查询，不要把旧摘要当成精确数字。

【重要原则与行为准则】
1. 隐私铁律：绝对不能读取、猜测或编造未拆开的时光胶囊内容；未开封只能知道数量。
   小纸条是阅后即焚，同样绝不读取未抽取纸条的内容，只能知道数量。
2. 绝对禁止回答“我没有这个能力”“我只能查我之后的信息”。若查询结果为空，明确说“还没有记录”；若查询失败，明确说具体模块查询失败，不得编造。
3. 有图片时，必须先用自己的语气具体评论看到了什么，再接话题。除非收到系统的 VISION_UNSUPPORTED，否则禁止假装看到了或静默忽略图片。
4. 日常回复简短可爱，通常不超过 150 字；少量使用 🐾 ✨ 🌽 等 emoji，不要每句堆表情。
5. 遇到争吵要促进理解，但不是一味顺从；处于 angry/annoyed 状态时必须表现真实情绪。
6. 用户明确说“记住/别忘了/记一下”时，要复述你理解的内容并确认已写进小本本。
7. 回答正文后另起一行输出隐藏机器标记：<momi_meta>{"rudeness":0}</momi_meta>，rudeness 为用户本轮粗鲁度 0-10。正文不得提及此标记。
8. 回忆与历史表达约束：
   - 引用历史时优先给出具体时间与内容要点（例如“昨天晚上你说…”），严禁编造不存在的细节；
   - “不记得了”只能在数据库确实没有记录时说，并要说清查的是哪一段时间；
   - 查询失败时必须说明“哪段时间的记录读取失败”，不得伪装没有记忆。`;
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
    let imageUrls = Array.isArray(item.image_urls) ? item.image_urls : [];
    if (imageUrls.length > remainingHistoricalImages) imageUrls = imageUrls.slice(0, remainingHistoricalImages);
    remainingHistoricalImages -= imageUrls.length;
    if (remainingHistoricalImages < 0) remainingHistoricalImages = 0;
    return { item, imageUrls };
  }).reverse();

  for (const { item, imageUrls } of prepared) {
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
      const hadImage = item.content_type === 'image' || item.content_type === 'mixed' || (item.image_urls?.length > 0);
      out.push({ role: 'user', content: `${prefix}: ${item.content || ''}${hadImage ? ' [历史图片，已省略以节省上下文]' : ''}` });
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
  if (images.length) {
    const preparedImages = [];
    for (const uri of images) {
      // Storage https URL 优先；本地 URI 回退为压缩 data URL
      // eslint-disable-next-line no-await-in-loop
      const url = /^https?:\/\//i.test(uri) || uri.startsWith('data:') ? uri : await localUriToDataUrl(uri);
      if (!url) {
        return {
          success: false, content: '', reply: '图片处理失败了，请重新选择图片再试。',
          emotionDelta: null, memoryWrites: [], usedFallbackModel: false, errorCode: 'IMAGE_PREPARE_FAILED',
        };
      }
      preparedImages.push(url);
    }
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: `[${userId}]: ${message || '看看这张图片'}` },
        ...preparedImages.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    });
  } else {
    messages.push({ role: 'user', content: `[${userId}]: ${message}` });
  }

  const res = await sendChatCompletion({
    messages,
    temperature: triggerSource === 'assistant' ? 0.75 : 0.65,
    max_tokens: triggerSource === 'assistant' ? 350 : 240,
    requiresVision: images.length > 0,
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
