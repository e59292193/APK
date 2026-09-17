// ═══════════════════════════════════════════════════════
// webSearchService.js —— momi 外网信息检索与实时新闻服务
// 通用检索：维基百科 + DuckDuckGo + 必应国内版（多源聚合，任源可用即可）
// 实时新闻：今日头条 / 微博 / 百度 / 知乎 四大热榜并行抓取、轮询合并、去重、
//           15 分钟缓存、8 秒超时保护；全部失败时返回诚实的失败原因，绝不编造。
// ═══════════════════════════════════════════════════════

const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000; // 15 分钟缓存
const SEARCH_TIMEOUT_MS = 6000; // 6 秒超时保护
const NEWS_CACHE_TTL_MS = 15 * 60 * 1000;
const NEWS_TIMEOUT_MS = 8000;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const searchCache = new Map();
let newsCache = null;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 清除 HTML 标签与实体
 */
function cleanSnippet(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从维基百科检索权威中文词条
 */
async function searchWikipedia(query, signal) {
  try {
    const url = 'https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch='
      + encodeURIComponent(query) + '&format=json&utf8=';
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'MomiCoupleApp/2.0 (momo_and_baomi)',
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = (data?.query?.search || []).slice(0, 3);
    return items.map((item) => ({
      title: item.title,
      snippet: cleanSnippet(item.snippet),
      source: '维基百科',
    })).filter((item) => Boolean(item.snippet));
  } catch {
    return [];
  }
}

/**
 * 从 DuckDuckGo 获取公开网页检索摘要
 */
async function searchDuckDuckGo(query, signal) {
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': BROWSER_UA,
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const results = [];
    const regex = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) && results.length < 4) {
      const snippet = cleanSnippet(match[1]);
      if (snippet && snippet.length > 10) {
        results.push({
          title: query,
          snippet,
          source: '公开网络检索',
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * 必应国内版网页检索（国内网络可达，解析搜索结果标题与摘要）
 */
async function searchBingCN(query, signal) {
  try {
    const url = 'https://cn.bing.com/search?q=' + encodeURIComponent(query);
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const results = [];
    const blockRegex = /<li class="b_algo"[\s\S]*?<\/li>/g;
    let block;
    while ((block = blockRegex.exec(html)) && results.length < 4) {
      const blockHtml = block[0];
      const titleMatch = blockHtml.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = blockHtml.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/)
        || blockHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const title = cleanSnippet(titleMatch?.[1] || '');
      const snippet = cleanSnippet(snippetMatch?.[1] || '');
      if (snippet && snippet.length > 10) {
        results.push({
          title: title || query,
          snippet,
          source: '必应检索',
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * 执行外网信息检索
 * @param {string} rawQuery - 用户提问或搜索词
 * @param {object} [options]
 * @param {number} [options.timeout=6000]
 * @returns {Promise<{ success: boolean, query: string, results: Array<{ title: string, snippet: string, source: string }>, formattedText: string }>}
 */
export async function searchWeb(rawQuery, { timeout = SEARCH_TIMEOUT_MS } = {}) {
  const query = String(rawQuery || '')
    .replace(/^(请问|帮我查一下|查一下|搜索一下|搜一下|外网|上网查查|查查|什么是|科普|了解一下)/g, '')
    .replace(/[？?。！!\s]+$/g, '')
    .trim();

  if (!query) {
    return {
      success: false,
      query: rawQuery,
      results: [],
      formattedText: '无有效搜索词',
    };
  }

  // 查内存缓存
  const cached = searchCache.get(query);
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL_MS) {
    return cached.data;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const [wikiResults, ddgResults, bingResults] = await Promise.all([
      searchWikipedia(query, controller.signal),
      searchDuckDuckGo(query, controller.signal),
      searchBingCN(query, controller.signal),
    ]);

    clearTimeout(timer);

    const merged = [...wikiResults, ...bingResults, ...ddgResults];
    const seen = new Set();
    const deduplicated = [];
    for (const item of merged) {
      const key = item.snippet.slice(0, 30);
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(item);
      }
    }

    const finalResults = deduplicated.slice(0, 5);
    let formattedText = '';
    if (finalResults.length > 0) {
      formattedText = finalResults
        .map((r, i) => `[${i + 1}] (${r.source} - ${r.title}) ${r.snippet}`)
        .join('\n');
    } else {
      formattedText = '未检索到与该关键词直接相关的公开外网信息。';
    }

    const output = {
      success: finalResults.length > 0,
      query,
      results: finalResults,
      formattedText,
    };

    searchCache.set(query, { timestamp: Date.now(), data: output });
    return output;
  } catch (err) {
    clearTimeout(timer);
    return {
      success: false,
      query,
      results: [],
      formattedText: `外网检索暂时不可用：${err.message || '网络超时'}`,
    };
  }
}

// ─────────────────────────────────────────────────────
// 实时新闻热榜（全部免 Key、国内网络可达）
// ─────────────────────────────────────────────────────

/** 在 JSON 对象中深度查找第一个「元素含指定键」的数组（防御接口结构变动） */
function findArrayWithKey(obj, key, depth = 0) {
  if (!obj || depth > 6) return null;
  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0] && typeof obj[0] === 'object' && obj[0][key] !== undefined) {
      return obj;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      const found = findArrayWithKey(value, key, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function fetchToutiaoHot(signal) {
  const res = await fetch('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', {
    signal,
    headers: { 'User-Agent': BROWSER_UA },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const list = (Array.isArray(data?.data) ? data.data : null) || findArrayWithKey(data, 'Title') || [];
  return list.slice(0, 12)
    .map((item) => ({
      title: cleanSnippet(item.Title || item.title || ''),
      source: '今日头条热榜',
    }))
    .filter((item) => item.title.length >= 4);
}

async function fetchWeiboHot(signal) {
  const res = await fetch('https://weibo.com/ajax/side/hotSearch', {
    signal,
    headers: { 'User-Agent': BROWSER_UA, Referer: 'https://weibo.com/' },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const list = (Array.isArray(data?.data?.realtime) ? data.data.realtime : null)
    || findArrayWithKey(data, 'word')
    || [];
  return list.slice(0, 12)
    .map((item) => ({
      title: cleanSnippet(item.word || item.note || ''),
      source: '微博热搜',
    }))
    .filter((item) => item.title.length >= 4);
}

async function fetchBaiduHot(signal) {
  const res = await fetch('https://top.baidu.com/board?tab=realtime', {
    signal,
    headers: { 'User-Agent': BROWSER_UA },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const items = [];
  const seen = new Set();
  // 页面内嵌 JSON 中每条热搜都带 "word":"..." 字段
  const regex = /"word":"([^"]{2,60})"/g;
  let match;
  while ((match = regex.exec(html)) && items.length < 12) {
    const title = match[1];
    if (!seen.has(title)) {
      seen.add(title);
      items.push({ title, source: '百度热搜' });
    }
  }
  return items;
}

async function fetchZhihuHot(signal) {
  const res = await fetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=15', {
    signal,
    headers: { 'User-Agent': BROWSER_UA },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const list = (Array.isArray(data?.data) ? data.data : null) || [];
  return list.slice(0, 12)
    .map((item) => ({
      title: cleanSnippet(item?.target?.title || ''),
      source: '知乎热榜',
    }))
    .filter((item) => item.title.length >= 4);
}

const NEWS_SOURCES = [
  ['今日头条热榜', fetchToutiaoHot],
  ['微博热搜', fetchWeiboHot],
  ['百度热搜', fetchBaiduHot],
  ['知乎热榜', fetchZhihuHot],
];

/**
 * 获取实时新闻/热榜摘要。
 * 四个来源并行抓取（任一成功即可），按来源轮询合并保证多样性，去重后截断。
 * @returns {Promise<{ success: boolean, items: Array<{ title: string, source: string }>, sourcesUsed: string[], fetchedAt: string, formattedText: string }>}
 */
export async function getLatestNews({ maxItems = 12, timeout = NEWS_TIMEOUT_MS } = {}) {
  if (newsCache && Date.now() - newsCache.timestamp < NEWS_CACHE_TTL_MS) {
    return newsCache.data;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const fetchedAt = new Date();
  const timeStr = `${fetchedAt.getMonth() + 1}月${fetchedAt.getDate()}日 ${pad2(fetchedAt.getHours())}:${pad2(fetchedAt.getMinutes())}`;

  try {
    const settled = await Promise.allSettled(NEWS_SOURCES.map(([, fn]) => fn(controller.signal)));
    clearTimeout(timer);

    const pools = [];
    const sourcesUsed = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled' && Array.isArray(result.value) && result.value.length > 0) {
        pools.push(result.value);
        sourcesUsed.push(NEWS_SOURCES[index][0]);
      } else if (result.status === 'rejected') {
        console.warn(`[webSearchService] 新闻源 ${NEWS_SOURCES[index][0]} 拉取失败:`, result.reason?.message || result.reason);
      }
    });

    // 轮询合并（每个来源轮流取一条），保证榜单多样性
    const items = [];
    const seen = new Set();
    for (let i = 0; items.length < maxItems && pools.some((pool) => pool.length > i); i += 1) {
      for (const pool of pools) {
        const item = pool[i];
        if (!item) continue;
        const key = item.title.slice(0, 12);
        if (!seen.has(key)) {
          seen.add(key);
          items.push(item);
        }
      }
    }

    const success = items.length > 0;
    const formattedText = success
      ? `抓取时间：${timeStr}（实时榜单数据，非指定日期的历史存档）\n来源：${sourcesUsed.join('、')}\n${items.map((item, i) => `${i + 1}. [${item.source}] ${item.title}`).join('\n')}`
      : '四个实时新闻源（今日头条/微博/百度/知乎）本轮都没有拉到数据，可能是当前网络暂时不通。';

    const output = {
      success,
      items,
      sourcesUsed,
      fetchedAt: fetchedAt.toISOString(),
      formattedText,
    };
    if (success) {
      newsCache = { timestamp: Date.now(), data: output };
    }
    return output;
  } catch (err) {
    clearTimeout(timer);
    return {
      success: false,
      items: [],
      sourcesUsed: [],
      fetchedAt: fetchedAt.toISOString(),
      formattedText: `新闻热榜拉取失败：${err.message || '网络异常'}`,
    };
  }
}
