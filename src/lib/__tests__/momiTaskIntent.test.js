import {
  extractCancelKeyword,
  extractTaskTitle,
  looksLikeTaskIntent,
} from '../momiTaskIntent';

describe('momiTaskIntent 任务意图识别', () => {
  test('通道 A：显式触发词', () => {
    const result = looksLikeTaskIntent('明天上午9点提醒我开会');
    expect(result).toEqual(
      expect.objectContaining({ isTask: true, kind: 'create', channel: 'A', needsTime: false }),
    );
  });

  test('通道 B：时间线索 + 动作词（没有「提醒」二字也要建任务）', () => {
    const result = looksLikeTaskIntent('等下两点钟准时给我发条信息');
    expect(result).toEqual(
      expect.objectContaining({ isTask: true, kind: 'create', channel: 'B' }),
    );
  });

  test('缺时间的任务要标记 needsTime，交给上层反问', () => {
    expect(looksLikeTaskIntent('提醒我买牛奶')).toEqual(
      expect.objectContaining({ isTask: true, kind: 'create', needsTime: true }),
    );
  });

  test('投诉与能力询问不建任务', () => {
    expect(looksLikeTaskIntent('你还是没有提醒我啊')).toEqual(
      expect.objectContaining({ isTask: false, reason: 'complaint_or_question' }),
    );
    expect(looksLikeTaskIntent('你到底能不能提醒我')).toEqual(
      expect.objectContaining({ isTask: false }),
    );
    expect(looksLikeTaskIntent('定时任务怎么还是不管用')).toEqual(
      expect.objectContaining({ isTask: false }),
    );
  });

  test('「别忘了提醒我吃药」是布置任务，不是投诉也不是取消', () => {
    expect(looksLikeTaskIntent('别忘了提醒我吃药')).toEqual(
      expect.objectContaining({ isTask: true, kind: 'create' }),
    );
  });

  test('取消与查询意图', () => {
    expect(looksLikeTaskIntent('取消喝水的提醒')).toEqual(
      expect.objectContaining({ isTask: true, kind: 'cancel' }),
    );
    expect(looksLikeTaskIntent('我有哪些提醒')).toEqual(
      expect.objectContaining({ isTask: true, kind: 'list' }),
    );
  });

  test('闲聊不建任务', () => {
    expect(looksLikeTaskIntent('momi 今天心情怎么样')).toEqual(
      expect.objectContaining({ isTask: false }),
    );
    expect(looksLikeTaskIntent('')).toEqual(expect.objectContaining({ isTask: false }));
  });

  test('标题抽取剥离称呼、时间词、触发词与行首赘余动词', () => {
    expect(extractTaskTitle('momi，10分钟后提醒我喝水')).toBe('喝水');
    expect(extractTaskTitle('提醒我2小时后去取快递')).toBe('取快递');
    expect(extractTaskTitle('每天晚上九点提醒我背单词')).toBe('背单词');
    expect(extractTaskTitle('9月20日下午三点提醒我交报告')).toBe('交报告');
    expect(extractTaskTitle('后天晚上8点提醒我散步')).toBe('散步');
    expect(extractTaskTitle('提醒我一下')).toBe('你交给我的事');
  });

  test('取消关键词抽取', () => {
    expect(extractCancelKeyword('取消喝水的提醒')).toBe('喝水');
    expect(extractCancelKeyword('把背单词的任务删掉')).toBe('把背单词');
  });
});
