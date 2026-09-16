// ═══════════════════════════════════════════════════════
// webSearchService.js —— momi 外网信息检索服务
// 聚合维基百科 API 与轻量网络检索，提供防抖缓存、超时保护与文本清洗
// ═══════════════════════════════════════════════════════

const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000; // 15 分钟缓存
const SEARCH_TIMEOUT_MS = 6000; // 6 秒超时保护

const searchCache = new Map();

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
    const url = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=`;
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
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
    const [wikiResults, ddgResults] = await Promise.all([
      searchWikipedia(query, controller.signal),
      searchDuckDuckGo(query, controller.signal),
    ]);

    clearTimeout(timer);

    const merged = [...wikiResults, ...ddgResults];
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
