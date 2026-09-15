// ═══════════════════════════════════════════════════════
// momi 伴侣业务核心 (momiAssistant.js) — V2
//
// 对话流程：
//  1) 轻量意图分类（查库 / 记忆指令 / 提醒由 scheduler 处理）
//  2) 命中则经 momiDataAccess 查真实数据
//  3) 拉 momi_state + momi_data_digest + 相关结构化记忆
//  4) 按身份→情绪→摘要→相关记忆→历史的顺序拼 prompt（约 2500 token）
//  5) 含图片走多模态 requiresVision；绝不静默丢图
//  6) 解析回复与 rudeness，持久化情绪/好感/经验
//  7) 明确记忆指令立即写入并确认复述
//  8) 消息由 UI 调 saveAssistantMessage 云端+本地双写
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import {
  sendChatCompletion,
  localUriToDataUrl,
  compressImageForAI,
  AI_ERROR_CODES,
} from './aiProvider';
import {
  getDataDigest,
  queryByIntent,
  queryRecipeIfAsked,
} from './momiDataAccess';
import {
  buildExplicitMemory,
  upsertMemory,
  getMemoriesForPrompt,
  extractAndSaveMemories,
  ensureMomiIdentitySeeds,
  runMemoryMaintenance,
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
const EXTRACTION_COUNTER_KEY = '@momi_memory_extraction_counter';

/** 读取本地缓存消息。 */
async function getLocalAssistantMessages() {
  try {
    const raw = await AsyncStorage.getItem(ASSISTANT_LOCAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** 追加单条消息到本地缓存（最多 200 条）。 */
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
 * 压缩并上传一组 momi 聊天图片到公开 momi-chat bucket。
 * 图片先上传再存消息表；绝不只保存本地 URI（否则另一用户看到破图）。
 */
export async function uploadMomiChatImages(uris = []) {
  const output = [];
  for (const uri of (uris || []).slice(0, 4)) {
    if (!uri) continue;
    if (/^https?:\/\//i.test(uri)) {
      output.push({ url: uri, path: null });
      continue;
    }
    try {
      const compressedUri = await compressImageForAI(uri);
      const { File } = require('expo-file-system');
      const file = new File(compressedUri);
      const bytes = await file.arrayBuffer();
      const path = `uploads/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`;
      const { error } = await supabase.storage
        .from(MOMI_CHAT_BUCKET)
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from(MOMI_CHAT_BUCKET).getPublicUrl(path);
      if (!data || !data.publicUrl) throw new Error('无法获取图片公开地址');
      output.push({ url: data.publicUrl, path });
    } catch (err) {
      console.warn('[momiAssistant] 图片上传失败:', err.message);
      // 不回退为本地 URI：那会造成双端不一致。调用方必须明确显示失败。
      const error = new Error(`图片上传失败：${err.message}`);
      error.code = 'IMAGE_UPLOAD_FAILED';
      throw error;
    }
  }
  return output;
}

/**
 * 聚合 system prompt 上下文。保留旧字段兼容测试/旧调用，同时所有实际数据读取
 * 已迁到 momiDataAccess 与 momiMemory。
 */
export async function fetchAssistantContext(message = '') {
  const [digest, memories, state, liveQuery, recipe] = await Promise.all([
    getDataDigest(),
    getMemoriesForPrompt(message),
    getMomiState(),
    queryByIntent(message),
    queryRecipeIfAsked(message),
  ]);
  return { digest, memories, state, liveQuery, recipe };
}

function compactJson(value, maxChars = 5000) {
  try {
    return JSON.stringify(value ?? {}, null, 0).slice(0, maxChars);
  } catch {
    return '{}';
  }
}

function memoryLines(items) {
  if (!Array.isArray(items) || !items.length) return '暂无相关记忆';
  return items.map((m) => `- [${m.subject}/${m.memory_type}/重要度${m.importance}] ${m.content}`).join('\n');
}

/**
 * 构建系统提示词。兼容旧 context.momoMemory 等字段，便于已有单测/旧入口平滑过渡。
 */
export function buildSystemPrompt(context = {}) {
  const oldContextBlock = context.momoMemory !== undefined
    ? `【关于 momo】：${context.momoMemory || '暂无记录'}
【关于 苞米】：${context.baomiMemory || '暂无记录'}
【两人的共同记忆】：${context.coupleMemory || '暂无记录'}
【momi厨房菜品库】：${context.dishTitles || '暂无菜品'} (共 ${context.dishesCount || 0} 道菜)
【恋爱足迹与已拆封信件】：${context.openedCapsulesSummary || '暂无已拆封信件'}`
    : '';

  const identities = context.memories?.identities || [];
  const relevant = context.memories?.relevant || [];
  const state = context.state || {
    mood: 'calm', mood_intensity: 50, energy: 80, anger_level: 0,
    affection_momo: 50, affection_baomi: 50, growth_level: 1,
  };

  return `你是 momi，是 momo 和 苞米 的电子宠物与专属伴侣，不是工具，也不自称“AI助手”。

【身份人格（最高优先）】
${memoryLines(identities)}

${buildEmotionPromptBlock(state)}

【全局数据摘要（常识，不用于替代精确实时查询）】
${compactJson(context.digest, 4200)}

【本轮按需实时查询结果】
${context.liveQuery ? compactJson(context.liveQuery, 3200) : '本轮不需要查业务数据'}
${context.recipe ? `\n【精确配方查询】${compactJson(context.recipe, 1800)}` : ''}

【与本轮相关的长期记忆】
${memoryLines(relevant)}

${oldContextBlock}

【你能查的数据】
你可以查他们的打卡记录、菜品库与配方、本周菜单、纪念日、愿望清单、
五子棋和你画我猜战绩、相册数量与时间分布、已拆开的信、未抽取小纸条数量，
也记得你们的结构化长期记忆和共同聊天历史。

【隐私与真实性铁律】
1. 永远不读取、不猜测、不编造未开封信件内容；未开封只能知道数量。
2. 永远不读取、不猜测、不编造未抽取小纸条或未播放语音内容；只能知道待抽取数量。
3. 禁止回答“我没有这个能力”“我只能查我之后的信息”。若查询结果为空，就说具体事实：
   “你们还没有打卡记录哦”或“菜品库现在是空的”；若查询确实失败，明确说“刚才查库失败了”，不可编数据。
4. 看到图片时，先用自己的语气具体评论看到了什么，再接话题。只有真实收到
   VISION_UNSUPPORTED 时才说明当前模型不支持识图并引导去设置，不得假装看到了。
5. 回复简短可爱，日常不超过 150 字；少量 emoji，促进两个人更亲近但不盲目站队。
6. 若当前情绪 angry/annoyed，必须真实表现情绪；被粗鲁对待后禁止开心顺从。
7. 最终只输出严格 JSON：{"content":"给用户看的回复","rudeness":0}
   rudeness 为对方本轮粗鲁程度 0-10；情侣间“傻子/猪猪/笨蛋”等打情骂俏不要误判。`;
}

function parseModelEnvelope(text) {
  const raw = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(raw);
    return {
      content: String(parsed.content || parsed.reply || '').trim(),
      rudeness: Math.max(0, Math.min(10, Number(parsed.rudeness) || 0)),
    };
  } catch {
    // 个别兼容模型无法稳定输出 JSON 时仍保留真实原文，不伪造内容；粗鲁度走本地检测。
    return { content: raw, rudeness: 0 };
  }
}

/**
 * 历史消息构造：最多 16 条；历史图片只保留最近 2 张，其他降级为文字占位。
 */
async function buildHistoryMessages(history) {
  const slice = (history || []).slice(-16);
  let imageBudget = 2;
  const keepImageAt = new Set();
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const urls = Array.isArray(slice[i].image_urls) ? slice[i].image_urls : [];
    if (urls.length && imageBudget > 0) {
      keepImageAt.add(i);
      imageBudget -= Math.min(imageBudget, urls.length);
    }
  }

  const out = [];
  for (let i = 0; i < slice.length; i += 1) {
    const item = slice[i];
    const isMomi = item.sender === 'momi' || item.role === 'assistant' || item.user_id === 'momi';
    const text = item.content || '';
    const urls = Array.isArray(item.image_urls) ? item.image_urls : [];
    if (!isMomi && urls.length) {
      if (keepImageAt.has(i)) {
        const parts = [{ type: 'text', text: `[${item.sender || item.user_id || '用户'}]: ${text || '发来了一张图片'}` }];
        for (const url of urls.slice(0, imageBudget + 2)) {
          parts.push({ type: 'image_url', image_url: { url } });
        }
        out.push({ role: 'user', content: parts });
      } else {
        out.push({ role: 'user', content: `[${item.sender || item.user_id || '用户'}]: ${text || '[图片]'}` });
      }
    } else {
      out.push({ role: isMomi ? 'assistant' : 'user', content: isMomi ? text : `[${item.sender || item.user_id || '用户'}]: ${text}` });
    }
  }
  return out;
}

async function maybeRunExtraction(recentChatHistory, currentMessage) {
  try {
    const raw = await AsyncStorage.getItem(EXTRACTION_COUNTER_KEY);
    const next = (Number(raw) || 0) + 1;
    if (next < 20) {
      await AsyncStorage.setItem(EXTRACTION_COUNTER_KEY, String(next));
      return;
    }
    await AsyncStorage.setItem(EXTRACTION_COUNTER_KEY, '0');
    const records = [...(recentChatHistory || []), { sender: '用户', content: currentMessage }].slice(-20);
    extractAndSaveMemories(records).catch(() => {});
  } catch {}
}

/**
 * momi 伴侣对话调用入口（V2）
 * @returns {Promise<{success:boolean, content:string, reply:string, emotionDelta:object|null,
 * memoryWrites:Array, usedFallbackModel:boolean, errorCode?:string}>}
 */
export async function chatWithMomi({
  userId,
  message = '',
  images = [],
  recentChatHistory = [],
  triggerSource = 'assistant',
}) {
  const text = String(message || '').trim();
  if (!text && (!images || images.length === 0)) {
    return { success: false, content: '', reply: '', errorCode: 'EMPTY_MESSAGE', memoryWrites: [] };
  }

  // 冷启动维护在 App 中异步触发；这里防御性确保种子存在（RPC 幂等）
  ensureMomiIdentitySeeds().catch(() => {});
  runMemoryMaintenance().catch(() => {});

  // W1：用户明确要求记住，立即写入，重要度5/置信度1
  const memoryWrites = [];
  const explicit = buildExplicitMemory(userId, text);
  if (explicit) {
    const write = await upsertMemory({ ...explicit, source_ref: `chat_${Date.now()}` });
    if (write.success) memoryWrites.push(write.memory || explicit);
  }

  let context;
  try {
    context = await fetchAssistantContext(text);
  } catch (err) {
    return {
      success: false,
      content: `刚才查资料时失败了：${err.message}`,
      reply: `刚才查资料时失败了：${err.message}`,
      errorCode: 'DATA_ACCESS_FAILED',
      memoryWrites,
      emotionDelta: null,
      usedFallbackModel: false,
    };
  }

  const messages = [{ role: 'system', content: buildSystemPrompt(context) }];
  messages.push(...(await buildHistoryMessages(recentChatHistory)));

  // 当前消息：有图时构造 OpenAI 多模态数组。图片优先使用已上传的 https URL；
  // 本地 URI 才转换 data URL。任何转换失败都明确返回，不静默去图。
  if (images && images.length) {
    try {
      const parts = [{ type: 'text', text: `[${userId} / ${triggerSource}]: ${text || '看看这些图片吧'}` }];
      for (const uri of images.slice(0, 4)) {
        const url = /^https?:\/\//i.test(uri) || /^data:/i.test(uri)
          ? uri
          : await localUriToDataUrl(uri);
        if (!url) throw new Error('图片转换为空');
        parts.push({ type: 'image_url', image_url: { url } });
      }
      messages.push({ role: 'user', content: parts });
    } catch (err) {
      return {
        success: false,
        content: `图片处理失败：${err.message}`,
        reply: `图片处理失败：${err.message}`,
        errorCode: 'IMAGE_PROCESS_FAILED',
        memoryWrites,
        emotionDelta: null,
        usedFallbackModel: false,
      };
    }
  } else {
    messages.push({ role: 'user', content: `[${userId} / ${triggerSource}]: ${text}` });
  }

  const res = await sendChatCompletion({
    messages,
    temperature: 0.75,
    max_tokens: 360,
    requiresVision: Boolean(images && images.length),
  });

  if (!res.success) {
    return {
      success: false,
      content: res.error || '',
      reply: res.error || '',
      errorCode: res.errorCode || AI_ERROR_CODES.NETWORK,
      memoryWrites,
      emotionDelta: null,
      usedFallbackModel: false,
    };
  }

  const envelope = parseModelEnvelope(res.text);
  const localRudeness = scoreRudenessLocally(text);
  const rudeness = Math.max(localRudeness, envelope.rudeness);
  const emotion = await applyInteraction({ userId, rudeness, text });

  let content = envelope.content;
  // W1 必须确认并复述理解内容；如果模型漏了，代码层保证回执，不掩盖写入结果。
  if (explicit && memoryWrites.length && !/记住|小本本|记下/.test(content)) {
    content = `记住了！${explicit.content}，momi 已经写进小本本啦～ ${content}`.trim();
  }

  // 升级高光：主动祝贺，并把解锁成长写入 identity 记忆（永久保留）
  if (emotion.leveledUp) {
    const unlock = `momi 成长到 Lv.${emotion.newLevel}，解锁了更丰富的陪伴语气和主动关心方式。`;
    await upsertMemory({
      subject: 'momi', memory_type: 'identity', content: unlock,
      keywords: ['成长', `Lv.${emotion.newLevel}`], importance: 5,
      confidence: 1, source: 'seed', source_ref: `growth_level_${emotion.newLevel}`,
    });
    content = `🎉 momi 升到 Lv.${emotion.newLevel} 啦！谢谢你们一直陪着我～\n${content}`;
  }

  maybeRunExtraction(recentChatHistory, text);

  return {
    success: true,
    content,
    reply: content, // 兼容旧 UI 字段
    emotionDelta: emotion.emotionDelta,
    memoryWrites,
    usedFallbackModel: Boolean(res.usedFallbackModel),
    errorCode: null,
    state: emotion.state,
  };
}

/** 读取 momi 独立聊天历史（云端优先，异常时本地缓存）。 */
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
  } catch (err) {
    console.warn('[momiAssistant] 云端拉取历史失败，使用本地缓存:', err.message);
  }
  return (await getLocalAssistantMessages()).slice(-limit);
}

/**
 * 保存消息（云端 + 本地双写）。支持图片、多模态与主动消息来源。
 */
export async function saveAssistantMessage({
  sender,
  content = '',
  imageUrls = [],
  imagePaths = [],
  isProactive = false,
  triggerSource = 'assistant',
}) {
  const urls = (imageUrls || []).filter(Boolean);
  const paths = (imagePaths || []).filter(Boolean);
  const contentType = urls.length ? (content ? 'mixed' : 'image') : 'text';
  const now = new Date().toISOString();
  const localId = `momi_msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const payload = {
    couple_id: COUPLE_ID,
    sender,
    content: content || '',
    image_urls: urls,
    image_paths: paths,
    content_type: contentType,
    is_proactive: Boolean(isProactive),
    trigger_source: triggerSource,
  };
  const fallbackMsg = { id: localId, ...payload, created_at: now };

  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase.from('momi_assistant_messages').insert([payload]).select()
    );
    if (!error && data && data[0]) {
      await appendLocalAssistantMessage(data[0]);
      return data[0];
    }
    if (error) {
      if (error.code === '42703' || error.code === '42P01') {
        console.error('[momiAssistant] 新字段/表不存在，请先执行 momi_upgrade_schema.sql');
      } else {
        console.warn('[momiAssistant] 云端保存失败，转本地缓存:', error.message);
      }
    }
  } catch (err) {
    console.warn('[momiAssistant] 云端保存异常，转本地缓存:', err.message);
  }

  await appendLocalAssistantMessage(fallbackMsg);
  return fallbackMsg;
}

// 向后兼容旧调用：实际实现已迁到 momiMemory 且全部走去重 RPC。
export { extractAndSaveMemories };
