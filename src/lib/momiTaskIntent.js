// ══════════════════════════════════════════════════════════
// momi 任务意图识别 (momiTaskIntent.js) — V6
// 双通道判定：
//   通道 A：显式触发词（提醒/闹钟/定时/待办/叫我…）
//   通道 B：时间线索 + 动作词（例：「等下两点钟准时给我发条信息」）
// 反例拦截：「你还是没有提醒我」「为什么不提醒」等投诉/疑问句不建任务。
// 纯函数、无依赖、可单测。
// ══════════════════════════════════════════════════════════

const NUM = '0-9零〇○一壹二贰两俩三仨四五六七八九十';

function normalize(input) {
  return String(input || '')
    .replace(/[\uff10-\uff19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：︰]/g, ':')
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase();
}

/** 显式触发词（通道 A） */
export const TRIGGER_WORDS = /(提醒|叫我|喊我|催我|通知我|闹钟|定时|待办|备忘|记得|别忘|到点|到时候告诉我|定个|设个|设置个|定一个|设置一个)/;

/** 时间线索 */
export const TIME_HINT_RE = new RegExp(
  `([${NUM}]{1,3}个?(?:分钟|小时|钟头|天|周|星期)(?:之)?(?:后|以后)`
  + `|[${NUM}]{1,3}[:点時时][${NUM}]{0,3}`
  + `|凌晨|清晨|早晨|早上|上午|中午|下午|午后|傍晚|晚上|今晚|明晚|半夜|夜里`
  + `|今天|今早|明天|明早|明日|后天|大后天|当天`
  + `|每天|每日|天天|每晚|每早|每个?工作日|每(?:周|星期|礼拜)`
  + `|周[一二三四五六天日]|星期[一二三四五六天日]|礼拜[一二三四五六天日]`
  + `|[${NUM}]{1,3}月[${NUM}]{1,3}[日号]|[${NUM}]{1,3}[日号]`
  + `|一会儿|一会|待会|等下|等会|稍后|过会|半小时)`,
);

/** 动作词（通道 B） */
export const ACTION_RE = /(给我|跟我|和我|叫我|喊我|催我|通知我|发(?:条|个|一条|一个)?(?:消息|信息|微信|短信|语音|红包)|打电话|视频|背单词|打卡|吃药|喝水|喝药|起床|睡觉|开会|上课|签到|交(?:作业|电费|水费|房租|钱|费)|买|做饭|煮|洗澡|洗衣|下单|充电|提交|复习|锻炼|跑步|运动|遛狗|浇花|倒垃圾|接娃|送娃|预约|体检|缴费|还款|回电|回复|拿快递|取快递|寄快递|看球|记账|学习|休息)/;

/** 取消意图 */
export const CANCEL_RE = new RegExp(
  `((取消|删掉|删除|关掉|撤销|不用|不要|别)[^，。！？,.!?]{0,10}(提醒|任务|闹钟|待办))`
  + `|((提醒|任务|闹钟|待办)[^，。！？,.!?]{0,8}(取消|删掉|删除|关掉|撤销))`,
);

/** 查询已有任务 */
export const LIST_RE = /((哪些|什么|多少|几个)(提醒|任务|待办|闹钟))|((提醒|任务|待办|闹钟)(列表|清单|都有哪些|有哪些|有几个))|(看下?(?:我的)?(?:提醒|任务|待办))/;

/** 投诉 / 疑问 / 能力询问，不是新建任务 */
export const NOT_TASK_RE = /(还是?没(?:有)?提醒|没提醒|没有提醒|未提醒|为什么(?:不|没)提醒|怎么(?:没|还没|不)提醒|并没有提醒|都没提醒|忘(?:记|了)提醒|提醒(?:功能)?(?:怎么|为什么|吗)|不管用|没反应|失效|不好用|是不是坏了|能不能提醒|会不会提醒|你能提醒吗|支持.{0,6}提醒吗)/;

/** 「别忘了提醒我」不是取消、也不是投诉 */
const KEEP_RE = /(别忘|不要忘|不能忘|记得提醒|记得叫)/;

/**
 * 任务意图判定。
 * 返回 { isTask, kind: 'create'|'cancel'|'list'|null, channel: 'A'|'B'|null, needsTime, reason, matched }
 */
export function looksLikeTaskIntent(message) {
  const text = normalize(message);
  const none = (reason) => ({
    isTask: false, kind: null, channel: null, needsTime: false, reason, matched: null,
  });
  if (!text) return none('empty');

  // 「别忘了提醒我吃药」是布置任务，不是投诉也不是取消
  const keepIntent = KEEP_RE.test(text);

  if (!keepIntent && NOT_TASK_RE.test(text)) {
    return {
      isTask: false,
      kind: null,
      channel: null,
      needsTime: false,
      reason: 'complaint_or_question',
      matched: (text.match(NOT_TASK_RE) || [])[0] || null,
    };
  }

  if (LIST_RE.test(text)) {
    return {
      isTask: true, kind: 'list', channel: 'A', needsTime: false, reason: 'list_pattern',
      matched: (text.match(LIST_RE) || [])[0] || null,
    };
  }

  if (!keepIntent && CANCEL_RE.test(text)) {
    return {
      isTask: true, kind: 'cancel', channel: 'A', needsTime: false, reason: 'cancel_pattern',
      matched: (text.match(CANCEL_RE) || [])[0] || null,
    };
  }

  const hasTrigger = TRIGGER_WORDS.test(text);
  const hasTime = TIME_HINT_RE.test(text);
  const hasAction = ACTION_RE.test(text);

  if (hasTrigger) {
    return {
      isTask: true,
      kind: 'create',
      channel: 'A',
      needsTime: !hasTime,
      reason: hasTime ? 'trigger_with_time' : 'trigger_without_time',
      matched: (text.match(TRIGGER_WORDS) || [])[0] || null,
    };
  }

  if (hasTime && hasAction) {
    return {
      isTask: true,
      kind: 'create',
      channel: 'B',
      needsTime: false,
      reason: 'time_plus_action',
      matched: `${(text.match(TIME_HINT_RE) || [])[0] || ''}+${(text.match(ACTION_RE) || [])[0] || ''}`,
    };
  }

  return none('no_signal');
}

const TIME_STRIP_RE = new RegExp(
  `(今天|今晚|今早|今夜|明天|明早|明晚|明日|后天|大后天|当天`
  + `|每天|每日|天天|每晚|每早|每个?工作日|每(?:个)?(?:周|星期|礼拜)[一二三四五六天日]?`
  + `|周[一二三四五六天日]|星期[一二三四五六天日]|礼拜[一二三四五六天日]`
  + `|凌晨|清晨|早晨|大早|早上|上午|中午|下午|午后|傍晚|晚上|半夜|夜里`
  + `|一会儿|一会|待会|等会|等下|稍后|过会`
  + `|[0-9]{4}年|[${NUM}]{1,3}月[${NUM}]{1,3}[日号]|[${NUM}]{1,3}[日号]`
  + `|[${NUM}]{1,3}个?(?:分钟|小时|钟头|天|周|星期)(?:之)?(?:后|以后)`
  + `|半小时后|[${NUM}]{1,3}[:点時时](?:[${NUM}]{1,3}分?|半|一刻|三刻)?(?:钟)?)`,
  'g',
);

const TRIGGER_STRIP_RE = /(提醒我一下|提醒我|提醒一下|提醒|叫我|喊我|催我|通知我|记得|别忘了|别忘|到点|准时|定个|设个|设置个|定一个|设置一个|设置|闹钟|定时任务|定时|待办|备忘|帮我|麻烦|请你|请|一下)/g;

/** 从原句中抽取任务标题（去掉时间词与触发词） */
export function extractTaskTitle(message, fallback = '你交给我的事') {
  let s = String(message || '').trim();
  s = s.replace(/momi/gi, '');
  s = s.replace(TIME_STRIP_RE, '');
  s = s.replace(TRIGGER_STRIP_RE, '');
  s = s.replace(/^[的了吧呀啊呢吗，,。.、：:；;~!！?？\s]+/, '');
  s = s.replace(/[，,。.、：:；;~!！?？\s]+$/, '');
  s = s.trim();
  if (!s) return fallback;
  return s.slice(0, 30);
}

/** 取消意图中的关键词（用于匹配已有任务标题） */
export function extractCancelKeyword(message) {
  let s = String(message || '').trim();
  s = s.replace(/momi/gi, '');
  s = s.replace(/(取消|删掉|删除|关掉|撤销|不用|不要|别再|别|那个|这个|的|了|吧|呀|啊|呢)/g, '');
  s = s.replace(/(提醒我|提醒|任务|闹钟|待办)/g, '');
  s = s.replace(TIME_STRIP_RE, '');
  s = s.replace(/[，,。.、：:；;~!！?？\s]+/g, '');
  return s.trim().slice(0, 20);
}
