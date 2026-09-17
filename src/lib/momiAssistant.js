// ═══════════════════════════════════════════════════════
// momi 伴侣业务核心 (momiAssistant.js) — V5
// 识图 / 全量数据按需访问 / 可信记忆 / 持久情绪 / 主动触发统一入口
// V4：聊天内发布/取消任务统一走 handleTaskMessage（唯一入口，杜绝双写）。
// V5：所有回复路径共享 memoryGrounding；只有已持久化 user message 可写长期记忆。
// ═══════════════════════════════════════════════════════

import { File } from 'expo-file-system';
import { supabase } from './supabase';
import { sendChatCompletion, localUriToDataUrl, compressImageForAI } from './aiProvider';
import { queryByIntent, queryRecipeIfAsked, getDataDigest } from './momiDataAccess';
import { buildConversationContext } from './conversationContext';
import {
  loadDurableAssistantMessages,
  saveDurableAssistantMessage,
} from './momiAssistantMessageStore';
import {
  MOMI_PERSONA_CORE,
  DATA_CAPABILITIES_BLOCK,
  SCENE_RULES,
  buildMemoryGroundingRule,
} from './momiPersona';
import {
  ensureIdentitySeeds,
  parseExplicitMemory,
  extractAndSaveMemories,
  processPersistedUserMessage,
  retrieveMemoryContext,
} from './momiMemory';
import {
  getMomiState,
  applyInteraction,
  scoreRudenessLocally,
  buildEmotionPromptBlock,
} from './momiState';

export const COUPLE_ID = 'momo_and_baomi';
export const MOMI_CHAT_BUCKET = 'momi-chat';
const EMPTY_MEMORY_GROUNDING = Object.freeze({
  state: 'none',
  usedCount: 0,
  attributionAllowed: false,
});

function safeErrorCode(error) {
  return String(error?.code || error?.name || 'UNKNOWN').slice(0, 80);
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
    } catch (error) {
      throw new Error(`第 ${i + 1} 张图片上传失败：${error.message}`);
    }
  }
  return { urls, paths };
}

function formatMemoryBlock(memoryContext) {
  return memoryContext?.block || '【可信记忆检索结果：无】';
}

function formatDigest(digest) {
  try {
    return JSON.stringify(digest || {}, null, 0).slice(0, 5000);
  } catch (error) {
    console.warn('[momiAssistant] 业务摘要序列化失败:', safeErrorCode(error));
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

const TASK_RECURRENCE_LABELS = {
  daily: '每天',
  weekday: '每个工作日',
  weekly: '每周（星期几同首次设定日）',
};

function buildMemoryWriteBlock(status) {
  if (status === 'saved') {
    return '\n\n【本轮记忆写入状态】memory write status=saved；若对方明确要求记住，可以确认已经写进小本本。';
  }
  if (status === 'pending_propagation') {
    return '\n\n【本轮忘记状态】status=pending_propagation；只能说“删除请求已记录，正在同步”，不能说已经从所有系统彻底删除。';
  }
  if (status === 'error' || status === 'not_persisted') {
    return `\n\n【本轮记忆写入状态】memory write status=${status}；禁止说已经记住或写进小本本，必须如实说明暂未保存。`;
  }
  return '';
}

/**
 * 构建 system prompt。保留旧 context 字段兼容测试/调用。
 * 固定拼装顺序：人格、场景、可信记忆、校验状态、情绪、数据、任务、联网、天气、历史、输出格式。
 */
export function buildSystemPrompt(context = {}) {
  const sceneKey = context.scene || 'assistant';
  const sceneRule = SCENE_RULES[sceneKey] || SCENE_RULES.assistant;

  const memoryBlock = context.memoryBlock || `【关于 momo】：${context.momoMemory || '暂无'}\n【关于 苞米】：${context.baomiMemory || '暂无'}\n【两人的共同记忆】：${context.coupleMemory || '暂无'}`;
  const groundingBlock = buildMemoryGroundingRule(context.memoryGrounding || EMPTY_MEMORY_GROUNDING);
  const memoryWriteBlock = buildMemoryWriteBlock(context.memoryWriteStatus);
  const emotionBlock = context.emotionBlock ? `\n\n${context.emotionBlock}` : '';
  const digestBlock = context.digestBlock ? `\n\n【业务数据全局摘要】${context.digestBlock}` : '';
  const legacyKitchen = context.dishTitles ? `\n\n【momi厨房菜品库】：${context.dishTitles} (共 ${context.dishesCount || 0} 道菜)` : '';
  const legacyCapsules = context.openedCapsulesSummary ? `\n\n【恋爱足迹与已拆封信件】：${context.openedCapsulesSummary}` : '';
  const dataBlock = context.preciseData ? `\n\n【本轮实时精确查询结果】${JSON.stringify(context.preciseData)}` : '';
  const weatherBlock = context.weatherBlock ? `\n\n${context.weatherBlock}` : (context.weatherData ? `\n\n${formatWeatherBlock(context.weatherData)}` : '');
  const historyBlock = context.historyBlock
    ? `\n\n【历史上下文只用于对话连续性；assistant 文案事实权重为 0，不能作为用户原话证据】\n${context.historyBlock}`
    : '';

  const taskCreated = context.preciseData?.taskCreated;
  const taskCreatedMeta = context.preciseData?.taskCreatedMeta || {};
  const taskCancelled = context.preciseData?.taskCancelled;
  const taskCancelFailed = context.preciseData?.taskCancelFailed;
  let taskBlock = '';
  if (taskCreated) {
    const recurrence = taskCreated.recurrence && taskCreated.recurrence !== 'none' ? taskCreated.recurrence : null;
    taskBlock = `\n\n【定时任务设定成功】\n已成功为他们创建了任务提醒！\n- 任务标题：${taskCreated.title}\n- ${recurrence ? `重复规则：${TASK_RECURRENCE_LABELS[recurrence] || recurrence}` : '提醒时间'}：${taskCreated.due_at}\n【回答硬性约束】请务必亲切开心地向用户确认该任务已设定好${recurrence ? '，并明确复述重复规则（每天/每个工作日/每周）' : '，并复述具体触发时间'}，告诉用户到时间 momi 会准时提醒/执行 🐾${taskCreatedMeta.duplicated ? '\n（该任务与进行中的任务完全相同，未重复创建，可顺带告知“这个之前已经定过啦”）' : ''}`;
  } else if (taskCancelled) {
    taskBlock = `\n\n【任务取消成功】\n已为他们取消 ${taskCancelled.count} 条提醒/任务：${(taskCancelled.titles || []).map((title) => `「${title}」`).join('、')}\n【回答硬性约束】请亲切地向用户确认这些任务已经取消啦。`;
  } else if (taskCancelFailed) {
    taskBlock = `\n\n【任务取消未命中】\n没有找到标题包含「${taskCancelFailed.keyword}」的进行中任务。请温和告知用户没找到对应提醒，并引导他们先问“我有哪些提醒”核对名称后再取消。`;
  } else if (context.preciseData?.intent?.intent === 'tasks' && context.preciseData?.intent?.data?.summary) {
    taskBlock = `\n\n【进行中的定时提醒与待办列表】\n${context.preciseData.intent.data.summary}`;
  }

  const webSearchResult = context.preciseData?.intent?.intent === 'web_search' ? context.preciseData.intent.data : null;
  const webSearchBlock = webSearchResult
    ? `\n\n【实时外网信息检索结果】\n关键词：${webSearchResult.query}\n检索结果内容：\n${webSearchResult.formattedText || '未检索到更多直接内容'}\n【回答硬性约束】本轮上下文已包含外网实时检索权威结果，请直接结合上述内容回答用户，证明你具备实时查询外网信息的能力！`
    : '';

  const newsResult = context.preciseData?.intent?.intent === 'news' ? context.preciseData.intent.data : null;
  const newsBlock = newsResult
    ? (newsResult.success && Array.isArray(newsResult.items) && newsResult.items.length > 0
      ? `\n\n【实时新闻热榜（本轮刚联网抓取的真实数据）】\n${newsResult.formattedText}\n【回答硬性约束】本轮上下文包含刚联网抓取的真实热榜！请用 momi 自己的语气挑出 3-6 条重点做简要总结，并说明来源与抓取时间；热榜是实时数据，若用户问的是“昨天/过去某天”，如实说明这是最新热榜；绝对禁止说“我查不到新闻”“我没有联网能力”，也禁止编造榜单之外的新闻。`
      : `\n\n【新闻热榜拉取失败】\n${newsResult.formattedText || '网络暂时不通'}\n【回答硬性约束】诚实告知“刚刚联网拉取失败了，稍后再问我一次哦 🐾”，绝对禁止编造新闻内容，也绝对禁止说“我没有联网能力”。`)
    : '';

  const now = new Date();
  const timeString = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const currentTimeBlock = `\n\n【当前真实时间】${timeString}。你可以基于此时间计算任何相对时间（如5分钟后是几点几分、明天是几月几日等），绝对禁止回答“看不到现在的具体时间”。`;

  return `${MOMI_PERSONA_CORE}

${DATA_CAPABILITIES_BLOCK}

${sceneRule.guideline}
${sceneRule.lengthConstraint}

${memoryBlock}

${groundingBlock}${memoryWriteBlock}${emotionBlock}${digestBlock}${legacyKitchen}${legacyCapsules}${dataBlock}${taskBlock}${webSearchBlock}${newsBlock}${weatherBlock}${currentTimeBlock}${historyBlock}

【输出格式约束】
回答正文后另起一行输出隐藏机器标记：<momi_meta>{"rudeness":0}</momi_meta>，rudeness 为用户本轮粗鲁度 0-10。正文不得提及此标记。`.trim();
}

/**
 * 兼容旧 API：聚合轻量上下文；actor 缺失时可信记忆固定为空。
 */
export async function fetchAssistantContext(message = '', userId = null) {
  const [digest, memoryContext, state, precise] = await Promise.all([
    getDataDigest(),
    retrieveMemoryContext(message, { actorId: userId }),
    getMomiState(),
    queryByIntent(message, { userId }),
  ]);
  return {
    memoryBlock: formatMemoryBlock(memoryContext),
    memoryGrounding: memoryContext.grounding || EMPTY_MEMORY_GROUNDING,
    emotionBlock: buildEmotionPromptBlock(state),
    digestBlock: formatDigest(digest),
    preciseData: precise,
    state,
    memories: memoryContext.entries || [],
    digest,
  };
}

export function stripPromptArtifacts(text) {
  if (!text) return '';
  return String(text)
    .replace(/^(\s*\[\s*(?:历史\s*assistant\s*文案[，；\s]*|事实权重\s*=\s*0[，；\s]*|仅供(?:语气)?连续(?:性)?[，；\s]*)+\]\s*)+/gi, '')
    .replace(/\[(?:历史\s*assistant\s*文案|事实权重\s*=\s*0|仅供(?:语气)?连续)[^\]]*\]/gi, '')
    .trim();
}

function parseAssistantOutput(text) {
  const raw = String(text || '');
  const match = raw.match(/<momi_meta>([\s\S]*?)<\/momi_meta>/i);
  let rudeness = 0;
  if (match) {
    try {
      const meta = JSON.parse(match[1]);
      rudeness = Math.max(0, Math.min(10, Number(meta.rudeness) || 0));
    } catch (error) {
      console.warn('[momiAssistant] 模型元数据解析失败:', safeErrorCode(error));
    }
  }
  const strippedMeta = raw.replace(/\s*<momi_meta>[\s\S]*?<\/momi_meta>\s*/gi, '').trim();
  return {
    content: stripPromptArtifacts(strippedMeta),
    rudeness,
  };
}

export function historyToMessages(history, { maxMessages = 16, maxImages = 2 } = {}) {
  const out = [];
  let remainingHistoricalImages = maxImages;
  // 从新到旧决定哪 2 张图保留，然后恢复顺序
  const prepared = (history || []).slice(-maxMessages).reverse().map((item) => {
    const rawUrls = Array.isArray(item.image_urls) ? item.image_urls : [];
    // 必须是合法 http(s) 或 data:image，不能把相对存储路径送给模型。
    let validUrls = rawUrls.filter((url) => typeof url === 'string' && (/^https?:\/\//i.test(url) || url.startsWith('data:image/')));
    if (validUrls.length > remainingHistoricalImages) validUrls = validUrls.slice(0, remainingHistoricalImages);
    remainingHistoricalImages -= validUrls.length;
    if (remainingHistoricalImages < 0) remainingHistoricalImages = 0;
    return { item, imageUrls: validUrls, hadAnyImage: rawUrls.length > 0 };
  }).reverse();

  for (const { item, imageUrls, hadAnyImage } of prepared) {
    const isMomi = item.sender === 'momi' || item.role === 'assistant' || item.user_id === 'momi';
    if (isMomi) {
      out.push({
        role: 'assistant',
        content: stripPromptArtifacts(item.content || ''),
      });
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

function deriveMemoryWriteStatus(result, explicit, sourceMessageId) {
  if (result?.writes?.length) return 'saved';
  if (result?.results?.some((item) => item.status === 'pending_propagation')) return 'pending_propagation';
  if (result?.results?.some((item) => item.status === 'not_found')) return 'not_found';
  if (result?.results?.some((item) => item.status === 'error')) return 'error';
  if (explicit && !sourceMessageId) return 'not_persisted';
  return 'none';
}

function removeFalseMemoryConfirmation(content) {
  return String(content || '')
    .replace(/[^。！？\n]*(?:已经记住|记住了|写进小本本|不会忘)[^。！？\n]*[。！？]?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * momi 统一对话入口
 * triggerSource: 'assistant' | 'chat_mention' | 'proactive' | 'scheduled'
 * sourceMessageId: assistant 场景已持久化 user message 的 id，也是记忆证据唯一入口
 */
export async function chatWithMomi({
  userId,
  message = '',
  images = [],
  recentChatHistory = [],
  triggerSource = 'assistant',
  sourceMessageId = null,
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
    if (intentResult?.intent === 'weather') weatherData = intentResult.data;
  } catch (error) {
    return {
      success: false,
      content: '',
      reply: `momi 查询数据时失败了：${error.message}`,
      emotionDelta: null,
      memoryWrites: [],
      memoryWriteStatus: 'none',
      memoryGrounding: EMPTY_MEMORY_GROUNDING,
      usedFallbackModel: false,
      errorCode: 'DATA_QUERY_FAILED',
      taskCreated: null,
      taskCancelled: null,
      taskCancelFailed: null,
    };
  }

  // 1.5) 聊天内发布/取消任务的唯一入口。主聊天插话不在这里建任务。
  let taskAction = null;
  if (triggerSource === 'assistant' && message && preciseData?.intent?.intent !== 'tasks') {
    try {
      // eslint-disable-next-line global-require
      const { handleTaskMessage } = require('./momiTasks');
      taskAction = await handleTaskMessage({ userId, message, sourceMessageId });
    } catch (error) {
      console.warn('[momiAssistant] 任务意图处理异常:', safeErrorCode(error));
    }
  }
  if (taskAction?.action === 'created') {
    preciseData = preciseData || {};
    preciseData.taskCreated = taskAction.task;
    preciseData.taskCreatedMeta = { duplicated: Boolean(taskAction.duplicated) };
  } else if (taskAction?.action === 'cancelled') {
    preciseData = preciseData || {};
    preciseData.taskCancelled = { count: taskAction.count, titles: taskAction.titles };
  } else if (taskAction?.action === 'cancel_failed') {
    preciseData = preciseData || {};
    preciseData.taskCancelFailed = { keyword: taskAction.keyword };
  }

  const taskResultFields = {
    taskCreated: preciseData?.taskCreated || null,
    taskCancelled: preciseData?.taskCancelled || null,
    taskCancelFailed: preciseData?.taskCancelFailed || null,
  };

  // 1.6) 外网检索兜底匹配（若用户显式要求查询外网但未被 intent 拦截）
  if (!preciseData?.intent && /(查|搜索|搜).*外网|外网.*(信息|消息)|上网查|查一下最新|外网/i.test(message)) {
    try {
      // eslint-disable-next-line global-require
      const { searchWeb } = require('./webSearchService');
      const searchRes = await searchWeb(message);
      if (searchRes) {
        preciseData = preciseData || {};
        preciseData.intent = { intent: 'web_search', data: searchRes };
      }
    } catch (error) {
      console.warn('[momiAssistant] 外网检索触发异常:', safeErrorCode(error));
    }
  }

  // 1.7) 只有 assistant 场景且已有 canonical message id，才允许进入记忆账本。
  let memoryWriteResult = { writes: [], results: [] };
  if (triggerSource === 'assistant' && sourceMessageId && message) {
    try {
      memoryWriteResult = await processPersistedUserMessage({
        messageId: sourceMessageId,
        userId,
        content: message,
        senderType: 'user',
      });
    } catch (error) {
      console.warn('[momiAssistant] 可信记忆处理异常:', safeErrorCode(error));
      memoryWriteResult = { writes: [], results: [{ status: 'error' }] };
    }
  }
  const memoryWriteStatus = deriveMemoryWriteStatus(memoryWriteResult, explicit, sourceMessageId);
  const memoryWrites = memoryWriteResult.writes || [];

  // 跨场景近端历史只用于连续性，不能授权历史事实归因。
  const convContext = await buildConversationContext({
    scene: triggerSource,
    userId,
    message,
    localMessages: recentChatHistory,
  }).catch((error) => {
    console.warn('[momiAssistant] 构建跨场景上下文异常:', safeErrorCode(error));
    return null;
  });

  // 2-4) 可信记忆由独立 evidence store 查询，不采信 convContext 中的模型摘要。
  const [stateBefore, digest, memoryContext] = await Promise.all([
    getMomiState(),
    getDataDigest(),
    retrieveMemoryContext(message, { actorId: userId }),
  ]);
  const memoryGrounding = memoryContext.grounding || EMPTY_MEMORY_GROUNDING;
  const systemPrompt = buildSystemPrompt({
    scene: triggerSource,
    memoryBlock: formatMemoryBlock(memoryContext),
    memoryGrounding,
    memoryWriteStatus,
    emotionBlock: buildEmotionPromptBlock(stateBefore),
    digestBlock: formatDigest(digest),
    preciseData,
    weatherData,
    historyBlock: convContext?.historyBlock || '',
  });

  // 5) 组装 messages：近端历史最多 40 条；本轮图片绝不静默丢弃。
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
          try {
            const bucket = url.startsWith('chat/') ? MOMI_CHAT_BUCKET : 'photos';
            // eslint-disable-next-line no-await-in-loop
            const { data } = await supabase.storage.from(bucket).createSignedUrl(url, 3600);
            url = data?.signedUrl || '';
          } catch (error) {
            console.warn('[momiAssistant] 图片签名 URL 获取失败:', safeErrorCode(error));
            url = '';
          }
        }
      } else if (typeof url === 'string' && !url.startsWith('data:') && !/^https?:\/\//i.test(url)) {
        // eslint-disable-next-line no-await-in-loop
        url = await localUriToDataUrl(url);
      }
      if (!url) {
        console.warn('[momiAssistant] 无法解析第', preparedImages.length + 1, '张图片的有效 URL');
        continue;
      }
      preparedImages.push(url);
    }
    if (preparedImages.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: `[${userId}]: ${message || '看看这张图片'}` },
          ...preparedImages.map((url) => ({ type: 'image_url', image_url: { url } })),
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
    scheduled: 200,
  };
  const max_tokens = maxTokensMap[triggerSource] || 350;

  const response = await sendChatCompletion({
    messages,
    temperature: 0.75,
    top_p: 0.9,
    max_tokens,
    requiresVision: preparedImages.length > 0,
  });
  if (!response.success) {
    let reply = response.error;
    if (response.errorCode === 'VISION_UNSUPPORTED') {
      reply = '现在这个模型看不了图，去 momi 设置里换支持识图的模型 🐾';
    }
    return {
      success: false,
      content: '',
      reply,
      emotionDelta: null,
      memoryWrites,
      memoryWriteStatus,
      memoryGrounding,
      usedFallbackModel: false,
      errorCode: response.errorCode,
      ...taskResultFields,
    };
  }

  // 6) 解析回复并更新持久情绪：本地粗鲁词表 + AI 评分取高。
  const parsed = parseAssistantOutput(response.text);
  const rudeness = Math.max(scoreRudenessLocally(message), parsed.rudeness);
  const stateResult = await applyInteraction({ userId, rudeness, text: message });

  // 7) 确认文案由真实写入结果决定，绝不让模型凭感觉宣称保存/删除成功。
  let content = parsed.content;
  if (explicit && memoryWriteStatus === 'saved' && !/记住|小本本|不会忘/.test(content)) {
    content = `记住了！${explicit.content}，momi 已经写进小本本啦～ 🐾\n${content}`.trim();
  } else if (explicit && memoryWriteStatus !== 'saved') {
    const cleaned = removeFalseMemoryConfirmation(content);
    content = `我理解的是“${explicit.content}”，但这次暂时没能写进小本本；等记录同步好后再试一次哦 🐾${cleaned ? `\n${cleaned}` : ''}`;
  }

  const forgetRequested = /(?:忘掉|忘记|删除|删掉).{0,12}(?:记忆|这件事|这个|它)/.test(message);
  if (memoryWriteStatus === 'pending_propagation') {
    content = `删除请求已记录，正在同步；完成前我不会再主动引用这条记忆。${content ? `\n${content}` : ''}`;
  } else if (forgetRequested && memoryWriteStatus === 'not_found') {
    content = `我没有找到可删除的对应记忆记录。${content ? `\n${content}` : ''}`;
  } else if (forgetRequested && memoryWriteStatus === 'error') {
    content = `这次删除请求暂时没能保存，请稍后再试；我不会假装已经彻底忘记。${content ? `\n${content}` : ''}`;
  }

  if (stateResult.leveledUp) {
    content += `\n\n✨ momi 升到 Lv.${stateResult.newLevel} 啦！谢谢你们一直陪着我～`;
  }

  return {
    success: true,
    content,
    reply: content,
    emotionDelta: stateResult.emotionDelta,
    memoryWrites,
    memoryWriteStatus,
    memoryGrounding,
    usedFallbackModel: Boolean(response.usedFallbackModel),
    errorCode: null,
    state: stateResult.state,
    ...taskResultFields,
  };
}

/**
 * 兼容旧 API：统一委托 durable store，保留调用方签名。
 */
export async function fetchAssistantMessages(limit = 80) {
  return loadDurableAssistantMessages(limit);
}

export async function saveAssistantMessage(input = {}) {
  return saveDurableAssistantMessage(input);
}

// 保留旧导出名，内部转给新的结构化记忆模块。
export { extractAndSaveMemories, ensureIdentitySeeds };
