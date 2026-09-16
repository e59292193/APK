// 情侣主聊天中提到 momi 时的 sender-side only 唤醒逻辑
import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import { chatWithMomi } from './momiAssistant';
import { getProactiveSettings } from './momiProactiveSettings';

const COUPLE_ID = 'momo_and_baomi';

export function mentionsMomi(text) {
  return /(^|[^a-z])momi([^a-z]|$)/i.test(String(text || ''));
}

/**
 * 只能在「本机成功发出情侣聊天消息后」调用；接收端绝不能调用。
 * triggerMessageId 使用消息 id，双重查询 + DB 唯一索引避免重复插话。
 *
 * images：与本轮发言相关的图片 URL 数组（已解析为可访问的 https/data URL），
 * 由 ChatScreen 从「被引用的图片消息 + 最近 10 分钟内的聊天图片」收集而来，
 * 让 momi 在主聊天里也能真正看到图片，而不是假装没看到。
 */
export async function maybeCreateMomiInterjection({
  userId,
  message,
  text,
  triggerMessageId,
  recentChatHistory = [],
  isSender = true,
  isQuote = false,
  quotedContent = '',
  images = [],
}) {
  const content = (text !== undefined ? text : message) || '';
  const isMentioned = mentionsMomi(content);
  if (!isSender || !triggerMessageId || (!isMentioned && !isQuote)) return null;
  const settings = await getProactiveSettings(userId);
  if (!settings.nameWakeEnabled) return null;

  try {
    const existing = await fetchWithTimeout(() =>
      supabase
        .from('momi_chat_interjections')
        .select('id')
        .eq('couple_id', COUPLE_ID)
        .eq('trigger_message_id', String(triggerMessageId))
        .maybeSingle()
    );
    if (existing?.data) return null;

    const hasImages = Array.isArray(images) && images.length > 0;
    let userPrompt = `情侣主聊天中，${userId} 说：“${content}”。他们点到了你的名字，请自然插一句，不超过80字。不要说自己被系统唤醒。`;
    if (isQuote && !isMentioned) {
      userPrompt = `情侣主聊天中，${userId} 引用回复了你刚才说的话「${quotedContent}」，对你说：“${content}”。请自然回复一句，不超过80字。`;
    }
    if (hasImages) {
      userPrompt += `\n对方同时附上了 ${images.length} 张图片（就在这条消息里）。你必须先用自己的语气具体说说看到了什么，再自然接话；禁止说看不到图片，也不要假装看到了不存在的内容。总长不超过120字。`;
    }

    const generated = await chatWithMomi({
      userId,
      message: userPrompt,
      images: hasImages ? images : [],
      recentChatHistory,
      triggerSource: 'chat_mention',
    });
    let replyContent = generated.content;
    if (!generated.success) {
      if (generated.errorCode === 'VISION_UNSUPPORTED') {
        replyContent = '现在这个模型看不了图，去 momi 设置里换支持识图的模型 🐾';
      } else {
        return null;
      }
    }
    if (!replyContent) return null;

    const { data, error } = await fetchWithTimeout(() =>
      supabase.from('momi_chat_interjections').insert([{
        couple_id: COUPLE_ID,
        trigger_message_id: String(triggerMessageId),
        trigger_user: userId,
        content: replyContent,
      }]).select(),
    { kind: 'write' });
    if (error) {
      if (error.code === '23505') return null;
      throw error;
    }
    return data?.[0] || null;
  } catch (err) {
    console.warn('[momiMention] 插话生成失败（不影响主聊天）:', err.message);
    return null;
  }
}
