// ═══════════════════════════════════════════════════════
// momi小助手业务服务核心 (momiAssistant.js)
// 包含上下文数据聚合、时光胶囊安全隔离、Prompt 生成与记忆库维护
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { sendChatCompletion } from './aiProvider';

export const COUPLE_ID = 'momo_and_baomi';
const ASSISTANT_LOCAL_CACHE_KEY = '@momi_assistant_messages_local';

/**
 * 读取本地缓存消息
 */
async function getLocalAssistantMessages() {
  try {
    const raw = await AsyncStorage.getItem(ASSISTANT_LOCAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * 追加单条消息到本地缓存
 */
async function appendLocalAssistantMessage(msg) {
  if (!msg) return;
  try {
    const list = await getLocalAssistantMessages();
    if (list.some((m) => m.id === msg.id)) return;
    list.push(msg);
    const trimmed = list.slice(-200);
    await AsyncStorage.setItem(ASSISTANT_LOCAL_CACHE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[momiAssistant] 缓存本地消息异常:', e.message);
  }
}

/**
 * 聚合 momi 的系统上下文
 * 【底层强制隐私安全铁律】：时光胶囊必须严格过滤 opened_at IS NOT NULL
 */
export async function fetchAssistantContext() {
  try {
    // 1. 菜品库 (全量)
    const dishesPromise = fetchWithTimeout(() =>
      supabase
        .from('kitchen_dishes')
        .select('title, category, recipe_text, created_by')
        .eq('couple_id', COUPLE_ID)
        .limit(40)
    ).catch(() => ({ data: [] }));

    // 2. 本周想吃清单
    const picksPromise = fetchWithTimeout(() =>
      supabase
        .from('kitchen_weekly_picks')
        .select('week_start, picked_by, dish_id')
        .eq('couple_id', COUPLE_ID)
        .limit(20)
    ).catch(() => ({ data: [] }));

    // 3. 时光胶囊 —— 【强制安全】：只能访问已拆开信件，未拆开绝对不包含
    const capsulesPromise = fetchWithTimeout(() =>
      supabase
        .from('time_capsules')
        .select('content, weather, mood, creator_id, opened_at')
        .not('opened_at', 'is', null) // 严格限制：只拉取已开封
        .limit(20)
    ).catch(() => ({ data: [] }));

    // 4. momi 记忆库
    const memoryPromise = fetchWithTimeout(() =>
      supabase
        .from('momi_memory')
        .select('user_id, memory_type, content')
        .eq('couple_id', COUPLE_ID)
        .limit(60)
    ).catch(() => ({ data: [] }));

    const [dishesRes, picksRes, capsulesRes, memoryRes] = await Promise.all([
      dishesPromise,
      picksPromise,
      capsulesPromise,
      memoryPromise,
    ]);

    const dishes = dishesRes.data || [];
    const picks = picksRes.data || [];
    const capsules = capsulesRes.data || [];
    const memories = memoryRes.data || [];

    // 格式化记忆条目
    const momoMemory = memories
      .filter((m) => m.user_id === 'momo')
      .map((m) => m.content)
      .join('；') || '暂无专属记录';
    const baomiMemory = memories
      .filter((m) => m.user_id === '苞米')
      .map((m) => m.content)
      .join('；') || '暂无专属记录';
    const coupleMemory = memories
      .filter((m) => m.user_id === 'both')
      .map((m) => m.content)
      .join('；') || '暂无共同记忆';

    const dishTitles = dishes.map((d) => `【${d.title}】(${d.category || '菜品'})`).join('、');
    const openedCapsulesSummary = capsules
      .map((c) => `[${c.creator_id}写]: ${c.content ? c.content.slice(0, 40) : ''}...`)
      .join('；');

    return {
      dishesCount: dishes.length,
      dishTitles: dishTitles || '厨房目前还没有添加菜品哦',
      weeklyPicksCount: picks.length,
      openedCapsulesCount: capsules.length,
      openedCapsulesSummary: openedCapsulesSummary || '暂无已拆开的信件',
      momoMemory,
      baomiMemory,
      coupleMemory,
    };
  } catch (err) {
    console.warn('[momiAssistant] 获取上下文异常，使用兜底:', err.message);
    return {
      dishesCount: 0,
      dishTitles: '暂无数据',
      weeklyPicksCount: 0,
      openedCapsulesCount: 0,
      openedCapsulesSummary: '暂无数据',
      momoMemory: 'momo 是个可爱的人',
      baomiMemory: '苞米是个贴心的人',
      coupleMemory: '他们相亲相爱',
    };
  }
}

/**
 * 构建系统提示词 System Prompt
 */
export function buildSystemPrompt(context) {
  return `你是 momi，一只可爱温暖的电子宠物，是 momo 和 苞米 这对情侣专属的 AI 伴侣。
你的性格：活泼可爱、贴心温暖、偶尔撒娇，像一只小动物一样依赖他们两个。你最喜欢的事情就是看他们开开心心在一起。

【关于 momo】：${context.momoMemory}
【关于 苞米】：${context.baomiMemory}
【两人的共同记忆】：${context.coupleMemory}
【momi厨房菜品库】：${context.dishTitles} (共 ${context.dishesCount} 道菜)
【恋爱足迹与已拆封信件】：${context.openedCapsulesSummary}

【重要原则与行为准则】：
1. 绝对不能泄露未拆开的时光胶囊内容（系统底层已做物理隔离，你也不要去猜测或编造未开封信件）；
2. 回复要简短可爱，不超过 150 字；
3. 多用可爱 emoji 表情（如 🐾, (ฅ'ω'ฅ), ✨, 🌽, 🍚）；
4. 无论谁跟你说话，遇到争吵或小矛盾话题都要温柔劝和，偏向于化解矛盾、促进两个人的感情；
5. 你知道厨房里有哪些菜，可以向他们推荐今天吃什么！`;
}

/**
 * momi 伴侣对话调用入口
 * @param {object} params
 * @param {string} params.userId - 发送者 ('momo' | '苞米')
 * @param {string} params.message - 用户发送的有效消息内容
 * @param {Array} [params.recentChatHistory=[]] - 历史上下文消息
 */
export async function chatWithMomi({ userId, message, recentChatHistory = [] }) {
  const context = await fetchAssistantContext();
  const systemPrompt = buildSystemPrompt(context);

  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  // 加入历史消息上下文 (最多最近 6 条)
  const historySlice = (recentChatHistory || []).slice(-6);
  for (const item of historySlice) {
    if (item.sender === 'momi' || item.role === 'assistant' || item.user_id === 'momi') {
      messages.push({ role: 'assistant', content: item.content });
    } else {
      messages.push({
        role: 'user',
        content: `[${item.sender || item.user_id || '用户'}]: ${item.content}`,
      });
    }
  }

  // 当前用户最新发言
  messages.push({
    role: 'user',
    content: `[${userId}]: ${message}`,
  });

  const res = await sendChatCompletion({
    messages,
    temperature: 0.75,
    max_tokens: 300,
  });

  if (!res.success) {
    return {
      success: false,
      reply: res.error || 'momi 遇到了一点小问题，等下再找我聊天吧~',
    };
  }

  return {
    success: true,
    reply: res.text,
  };
}

/**
 * 读取 momi 小助手独立聊天历史 (优先从 Supabase，异常时落入本地缓存)
 */
export async function fetchAssistantMessages(limit = 60) {
  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase
        .from('momi_assistant_messages')
        .select('*')
        .eq('couple_id', COUPLE_ID)
        .order('created_at', { ascending: true })
        .limit(limit)
    );

    if (!error && data && data.length > 0) {
      await AsyncStorage.setItem(ASSISTANT_LOCAL_CACHE_KEY, JSON.stringify(data)).catch(() => {});
      return data;
    }
  } catch (err) {
    console.warn('[momiAssistant] 云端拉取历史消息失败，切换为本地存储:', err.message);
  }

  // 兜底返回本地缓存
  const localList = await getLocalAssistantMessages();
  return localList.slice(-limit);
}

/**
 * 保存一条消息到 momi 小助手独立聊天 (云端与本地双写，绝不因云端缺表抛出异常)
 */
export async function saveAssistantMessage({ sender, content }) {
  const localId = `momi_msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const fallbackMsg = {
    id: localId,
    couple_id: COUPLE_ID,
    sender,
    content,
    created_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await fetchWithTimeout(() =>
      supabase
        .from('momi_assistant_messages')
        .insert([
          {
            couple_id: COUPLE_ID,
            sender,
            content,
          },
        ])
        .select()
    );

    if (!error && data && data[0]) {
      await appendLocalAssistantMessage(data[0]);
      return data[0];
    }
    if (error) {
      console.warn('[momiAssistant] 云端保存消息失败 (转为本地安全存储):', error.message);
    }
  } catch (err) {
    console.warn('[momiAssistant] 保存消息网络异常 (转为本地安全存储):', err.message);
  }

  // 云端失败时安全落入本地存储，绝不抛出异常阻断会话
  await appendLocalAssistantMessage(fallbackMsg);
  return fallbackMsg;
}

/**
 * 从聊天记录中提取记忆并写入 momi_memory 表
 */
export async function extractAndSaveMemories(chatRecords) {
  if (!chatRecords || chatRecords.length === 0) return;

  const chatText = chatRecords
    .map((m) => `${m.user_id || m.sender}: ${m.content}`)
    .join('\n');

  const prompt = `根据以下情侣（momo 和 苞米）的对话记录，提取关于两人的个人特征、习惯、偏好或重要事件（最多5条）。
请只输出严格的 JSON 数组，格式如下：
[
  { "user_id": "momo", "memory_type": "preference", "content": "喜欢喝奶茶" },
  { "user_id": "苞米", "memory_type": "habit", "content": "习惯早起锻炼" },
  { "user_id": "both", "memory_type": "milestone", "content": "纪念日是2023年2月25日" }
]
若无可提取内容，直接返回 []。

对话记录：
${chatText}`;

  const res = await sendChatCompletion({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 600,
  });

  if (!res.success || !res.text) return;

  try {
    const raw = res.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const items = JSON.parse(raw);
    if (Array.isArray(items) && items.length > 0) {
      const inserts = items.map((item) => ({
        couple_id: COUPLE_ID,
        user_id: item.user_id || 'both',
        memory_type: item.memory_type || 'habit',
        content: item.content,
      }));
      await supabase.from('momi_memory').insert(inserts);
    }
  } catch (err) {
    console.warn('[momiAssistant] 解析提取记忆 JSON 失败:', err.message);
  }
}
