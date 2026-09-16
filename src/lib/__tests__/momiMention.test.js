jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../fetchWithTimeout', () => ({ fetchWithTimeout: jest.fn((fn) => fn()) }));
jest.mock('../momiAssistant', () => ({ chatWithMomi: jest.fn() }));
jest.mock('../momiProactiveSettings', () => ({ getProactiveSettings: jest.fn() }));

import { supabase } from '../supabase';
import { chatWithMomi } from '../momiAssistant';
import { getProactiveSettings } from '../momiProactiveSettings';
import { mentionsMomi, maybeCreateMomiInterjection } from '../momiMention';

function mockInterjectionTable({ existing = null, inserted = null, insertError = null } = {}) {
  const maybeSingle = jest.fn(async () => ({ data: existing, error: null }));
  const secondEq = jest.fn(() => ({ maybeSingle }));
  const firstEq = jest.fn(() => ({ eq: secondEq }));
  const selectExisting = jest.fn(() => ({ eq: firstEq }));
  const selectInserted = jest.fn(async () => ({ data: inserted ? [inserted] : [], error: insertError }));
  const insert = jest.fn(() => ({ select: selectInserted }));
  supabase.from.mockReturnValue({ select: selectExisting, insert });
  return { insert, selectInserted, maybeSingle };
}

describe('momiMention 名字唤醒', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getProactiveSettings.mockResolvedValue({ nameWakeEnabled: true });
    chatWithMomi.mockResolvedValue({ success: true, content: 'momi 来啦～' });
  });

  test('普通 momi 与 @momi 都命中，英文单词内部不误触', () => {
    expect(mentionsMomi('momi 你觉得呢')).toBe(true);
    expect(mentionsMomi('问问 @MOMI！')).toBe(true);
    expect(mentionsMomi('嗨momi呀')).toBe(true);
    expect(mentionsMomi('momification')).toBe(false);
    expect(mentionsMomi('今晚吃什么')).toBe(false);
  });

  test('接收端、缺少触发消息 ID 或未提名字均不触发 AI', async () => {
    await expect(maybeCreateMomiInterjection({ isSender: false, userId: 'momo', message: 'momi', triggerMessageId: '1' })).resolves.toBeNull();
    await expect(maybeCreateMomiInterjection({ isSender: true, userId: 'momo', message: 'momi' })).resolves.toBeNull();
    await expect(maybeCreateMomiInterjection({ isSender: true, userId: 'momo', message: '你好', triggerMessageId: '1' })).resolves.toBeNull();
    expect(chatWithMomi).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('nameWakeEnabled 关闭时不查表也不触发 AI', async () => {
    getProactiveSettings.mockResolvedValue({ nameWakeEnabled: false });
    const result = await maybeCreateMomiInterjection({
      isSender: true, userId: '苞米', message: '@momi 在吗', triggerMessageId: 'msg-off',
    });
    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(chatWithMomi).not.toHaveBeenCalled();
  });

  test('已有 trigger_message_id 时直接短路', async () => {
    mockInterjectionTable({ existing: { id: 'already-created' } });
    const result = await maybeCreateMomiInterjection({
      isSender: true, userId: 'momo', message: 'momi 来一下', triggerMessageId: 'msg-existing',
    });
    expect(result).toBeNull();
    expect(chatWithMomi).not.toHaveBeenCalled();
  });

  test('成功生成并写入发送端触发信息', async () => {
    const inserted = { id: 'interjection-1', content: 'momi 来啦～' };
    const table = mockInterjectionTable({ inserted });
    const history = [{ sender: '苞米', content: '今晚吃什么' }];
    const result = await maybeCreateMomiInterjection({
      isSender: true,
      userId: 'momo',
      message: 'momi 你来推荐吧',
      triggerMessageId: 123,
      recentChatHistory: history,
    });

    expect(result).toEqual(inserted);
    expect(chatWithMomi).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'momo', recentChatHistory: history, triggerSource: 'chat_mention',
    }));
    expect(table.insert).toHaveBeenCalledWith([expect.objectContaining({
      couple_id: 'momo_and_baomi',
      trigger_message_id: '123',
      trigger_user: 'momo',
      content: 'momi 来啦～',
    })]);
  });

  test('数据库 23505 并发冲突安静去重', async () => {
    mockInterjectionTable({ insertError: { code: '23505', message: 'duplicate key' } });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await maybeCreateMomiInterjection({
      isSender: true, userId: '苞米', message: 'momi 说句话', triggerMessageId: 'msg-race',
    });
    expect(result).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('支持 text 参数替代 message', async () => {
    const inserted = { id: 'interjection-text-param', content: 'momi 来了' };
    mockInterjectionTable({ inserted });
    const result = await maybeCreateMomiInterjection({
      isSender: true,
      userId: 'momo',
      text: 'momi 看看这个',
      triggerMessageId: 'msg-text',
    });
    expect(result).toEqual(inserted);
    expect(chatWithMomi).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'momo',
      triggerSource: 'chat_mention',
    }));
  });

  test('引用 momi 消息在开关开启时触发，开关关闭或非发送端时不触发', async () => {
    const inserted = { id: 'interjection-quote', content: '收到回复' };
    mockInterjectionTable({ inserted });

    // 1. 开关开启且是发送端：即使内容没有 momi 字样，由于 isQuote 也触发
    const res1 = await maybeCreateMomiInterjection({
      isSender: true,
      userId: '苞米',
      text: '好的呀',
      triggerMessageId: 'msg-quote-1',
      isQuote: true,
      quotedContent: '早点休息哦',
    });
    expect(res1).toEqual(inserted);
    expect(chatWithMomi).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('引用回复了你刚才说的话「早点休息哦」'),
    }));

    // 2. 开关关闭：不触发
    getProactiveSettings.mockResolvedValueOnce({ nameWakeEnabled: false });
    const res2 = await maybeCreateMomiInterjection({
      isSender: true,
      userId: '苞米',
      text: '好的呀',
      triggerMessageId: 'msg-quote-2',
      isQuote: true,
      quotedContent: '早点休息哦',
    });
    expect(res2).toBeNull();

    // 3. 接收端：不触发
    const res3 = await maybeCreateMomiInterjection({
      isSender: false,
      userId: '苞米',
      text: '好的呀',
      triggerMessageId: 'msg-quote-3',
      isQuote: true,
      quotedContent: '早点休息哦',
    });
    expect(res3).toBeNull();
  });

  test('附带图片时透传给 chatWithMomi，且提示词要求先描述图片', async () => {
    const inserted = { id: 'interjection-img', content: '看到照片啦' };
    mockInterjectionTable({ inserted });
    const images = ['https://example.com/a.jpg', 'https://example.com/b.jpg'];
    const result = await maybeCreateMomiInterjection({
      isSender: true,
      userId: 'momo',
      text: 'momi 这张',
      triggerMessageId: 'msg-img',
      images,
    });
    expect(result).toEqual(inserted);
    expect(chatWithMomi).toHaveBeenCalledWith(expect.objectContaining({
      images,
      triggerSource: 'chat_mention',
    }));
    const callArg = chatWithMomi.mock.calls[0][0];
    expect(callArg.message).toContain('图片');
  });

  test('无图片时 images 为空数组，提示词不追加图片指令', async () => {
    const inserted = { id: 'interjection-no-img', content: '来了' };
    mockInterjectionTable({ inserted });
    const result = await maybeCreateMomiInterjection({
      isSender: true,
      userId: 'momo',
      text: 'momi 在吗',
      triggerMessageId: 'msg-no-img',
    });
    expect(result).toEqual(inserted);
    const callArg = chatWithMomi.mock.calls[0][0];
    expect(callArg.images).toEqual([]);
    expect(callArg.message).not.toContain('附上了');
  });
});
