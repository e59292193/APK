// ═══════════════════════════════════════════════════════
// 你画我猜 —— 题库与判词工具（纯函数，无副作用）
// ═══════════════════════════════════════════════════════

// ─── 预设题库（按分类组织，200+ 词，适合情侣玩）───
// 每个分类对应给猜题人的「提示文案」
export const WORD_CATEGORIES = [
  {
    key: 'animal',
    hint: '一种动物',
    words: [
      '大象', '长颈鹿', '企鹅', '鸵鸟', '兔子', '猴子', '袋鼠', '恐龙', '老虎', '狮子',
      '熊猫', '斑马', '孔雀', '骆驼', '河马', '犀牛', '海豚', '鲨鱼', '鹦鹉', '狐狸',
      '狼', '驯鹿', '蛇', '青蛙', '乌龟', '鸭子', '鹅', '老鼠', '蝴蝶', '蜜蜂',
      '猫咪', '小狗', '金鱼', '小鸟', '蜗牛', '螃蟹', '考拉', '松鼠', '刺猬', '猫头鹰',
    ],
  },
  {
    key: 'food',
    hint: '一种食物',
    words: [
      '苹果', '香蕉', '西瓜', '草莓', '葡萄', '榴莲', '芒果', '火龙果', '柠檬', '橙子',
      '桃子', '梨', '冰淇淋', '蛋糕', '披萨', '汉堡', '薯条', '可乐', '奶茶', '火锅',
      '烧烤', '饺子', '包子', '面条', '米饭', '鸡蛋', '牛奶', '面包', '巧克力', '棒棒糖',
      '寿司', '糖葫芦', '寿喜烧', '棉花糖', '甜甜圈', '咖啡',
    ],
  },
  {
    key: 'object',
    hint: '一种日常物品',
    words: [
      '手机', '电脑', '电视', '冰箱', '空调', '台灯', '雨伞', '眼镜', '手表', '钥匙',
      '钱包', '背包', '帽子', '围巾', '手套', '袜子', '鞋子', '枕头', '被子', '镜子',
      '梳子', '牙刷', '毛巾', '纸巾', '垃圾桶', '钟表', '灯泡', '剪刀', '相机', '气球',
      '礼物', '吹风机', '指甲刀', '晾衣架',
    ],
  },
  {
    key: 'action',
    hint: '一个动作',
    words: [
      '跑步', '游泳', '跳绳', '打球', '踢足球', '打篮球', '打乒乓球', '滑雪', '滑冰', '冲浪',
      '攀岩', '瑜伽', '跳舞', '举重', '射击', '击剑', '骑自行车', '开车', '坐飞机', '划船',
      '睡觉', '打哈欠', '亲吻', '拥抱', '鼓掌', '招手', '鞠躬', '眨眼',
    ],
  },
  {
    key: 'idiom',
    hint: '一个成语',
    words: [
      '画蛇添足', '守株待兔', '对牛弹琴', '亡羊补牢', '坐井观天', '指鹿为马', '掩耳盗铃', '刻舟求剑',
      '盲人摸象', '画龙点睛', '虎头蛇尾', '鸡飞狗跳', '鸡鸣狗盗', '狗急跳墙', '狼吞虎咽', '鹤立鸡群',
      '如鱼得水', '打草惊蛇', '虎背熊腰', '三头六臂', '七上八下', '眉飞色舞', '愁眉苦脸', '目瞪口呆',
      '捧腹大笑', '泪流满面', '手舞足蹈', '摇头晃脑', '东张西望', '抓耳挠腮', '鬼鬼祟祟', '一举两得',
      '三长两短', '走马观花', '抱头鼠窜', '对镜贴花黄', '掩面而泣',
    ],
  },
  {
    key: 'job',
    hint: '一个职业',
    words: [
      '医生', '护士', '警察', '消防员', '老师', '厨师', '飞行员', '宇航员', '快递员', '外卖员',
      '理发师', '画家', '音乐家', '运动员', '演员', '律师', '法官', '司机', '导游', '摄影师',
      '魔术师', '舞蹈家', '工程师', '程序员', '歌手',
    ],
  },
  {
    key: 'romance',
    hint: '与浪漫相关',
    words: [
      '爱心', '戒指', '婚纱', '玫瑰', '月亮', '星星', '钻石', '丘比特', '烟花', '拥抱',
      '婚礼', '告白', '约会', '牵手', '亲吻', '情人节', '巧克力盒', '情书', '红玫瑰', '烛光晚餐',
    ],
  },
  {
    key: 'scene',
    hint: '一个场景',
    words: [
      '海滩', '雪人', '彩虹', '日出', '城堡', '摩天轮', '秋千', '下雨', '打雷', '风车',
      '沙漠', '森林', '瀑布', '星空', '烟花表演', '游乐园', '图书馆', '咖啡馆',
    ],
  },
];

// ─── 扁平题库（向后兼容 PRESET_WORDS）───
export const PRESET_WORDS = WORD_CATEGORIES.flatMap((c) => c.words);

// 词 → 分类提示 反查表
const WORD_TO_HINT = new Map();
for (const cat of WORD_CATEGORIES) {
  for (const w of cat.words) WORD_TO_HINT.set(w, cat.hint);
}

/**
 * 获取某个词的分类提示（如「一种动物」），未知分类返回「一个东西」
 */
export function getCategoryHint(word) {
  if (!word) return '一个东西';
  return WORD_TO_HINT.get(word) || '一个东西';
}

/**
 * 从预设题库 + 用户自定义词中随机抽取 n 个不重复的词。
 * @param {string[]} customWords 当前用户的自定义词
 * @param {number} n 默认 3
 * @returns {string[]}
 */
export function pickRandomWords(customWords = [], n = 3) {
  // 自定义词有 40% 概率混入（增加默契感），但最多 1 个
  const pool = [...PRESET_WORDS];
  const result = [];

  // 尝试混入 1 个自定义词
  if (customWords.length > 0 && Math.random() < 0.4) {
    const cw = customWords[Math.floor(Math.random() * customWords.length)];
    result.push(cw);
  }

  // 从预设池补齐（打乱）
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const w of pool) {
    if (result.length >= n) break;
    if (!result.includes(w)) result.push(w);
  }
  // 若仍不足（理论上不会），兜底重复
  while (result.length < n) result.push(pool[result.length % pool.length] || '爱心');
  return result;
}

/**
 * 规范化词/猜测：去空格、转小写、去标点。
 */
export function normalizeText(s) {
  if (!s) return '';
  return String(s)
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?~～·…]/g, '')
    .toLowerCase();
}

/**
 * 判断猜测是否正确（精确匹配，或包含关系）。
 * - 完全相等 → 正确
 * - 猜测包含答案且长度差 ≤ 1 → 正确（容错小输入）
 */
export function isCorrectGuess(guess, word) {
  const g = normalizeText(guess);
  const w = normalizeText(word);
  if (!g || !w) return false;
  if (g === w) return true;
  // 容错：猜中核心词（答案长度 ≥ 2 时，猜测等于答案去掉一个字）
  if (w.length >= 2 && g.length >= 2 && (w.includes(g) || g.includes(w)) && Math.abs(g.length - w.length) <= 1) {
    return true;
  }
  return false;
}
