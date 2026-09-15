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
 * triggerMessageId 使用腾讯 IM 消息 id，双重查询 + DB 唯一索引避免重复插话。
 */
export async function maybeCreateMomiInterjection({
  userId,
  message,
  triggerMessageId,
  recentChatHistory = [],
  isSender = true,
}) {
  if (!isSender || !triggerMessageId || !mentionsMomi(message)) return null;
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

    const generated = await chatWithMomi({
      userId,
      message: `情侣主聊天中，${userId} 说：“${message}”。他们点到了你的名字，请自然插一句，不超过80字。不要说自己被系统唤醒。`,
      recentChatHistory,
      triggerSource: 'chat_mention',
    });
    if (!generated.success || !generated.content) return null;

    const { data, error } = await fetchWithTimeout(() =>
      supabase.from('momi_chat_interjections').insert([{
        couple_id: COUPLE_ID,
        trigger_message_id: String(triggerMessageId),
        trigger_user: userId,
        content: generated.content,
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
