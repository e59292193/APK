// ═══════════════════════════════════════════════════════
// momi AI 统一调用层 (aiProvider.js)
// 支持 MiniMax (小米)、DeepSeek、GLM (智谱 AI)
// ═══════════════════════════════════════════════════════

import { getAIConfig, PROVIDER_ENDPOINTS, getDefaultModel } from './aiConfig';
import { File } from 'expo-file-system';

const REQUEST_TIMEOUT_MS = 15000;

export const AI_ERRORS = {
  NO_KEY: '请先在设置中配置 momi AI',
  NETWORK: 'momi 睡着了，请稍后再试 zzz',
  AUTH_OR_BALANCE: 'momi 的能量耗尽了，请检查 API Key',
  TIMEOUT: 'momi 正在思考但超时了，请重试',
};

/**
 * 将本地图片文件转换为 Base64 data URL
 */
async function localUriToDataUrl(uri) {
  if (!uri) return '';
  if (uri.startsWith('data:') || uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }
  try {
    const file = new File(uri);
    const base64 = await file.base64();
    return `data:image/jpeg;base64,${base64}`;
  } catch (err) {
    console.warn('[aiProvider] 本地图片转 base64 失败，尝试以原始路径传递:', err.message);
    return uri;
  }
}

/**
 * 执行统一的 OpenAI 兼容 Chat Completions 请求
 * @param {object} params
 * @param {Array} params.messages - OpenAI 兼容 messages 数组
 * @param {number} [params.temperature=0.7]
 * @param {number} [params.max_tokens=800]
 * @param {object} [params.overrideConfig] - 用于测试连接或临时覆盖配置
 * @returns {Promise<{ success: boolean, text: string, error?: string }>}
 */
export async function sendChatCompletion({
  messages,
  temperature = 0.7,
  max_tokens = 800,
  overrideConfig = null,
}) {
  const config = overrideConfig || (await getAIConfig());
  const provider = config.provider || 'glm';
  const apiKey = (config.apiKey || '').trim();
  const modelName = (config.modelName || '').trim() || getDefaultModel(provider);

  if (!apiKey) {
    return {
      success: false,
      text: '',
      error: AI_ERRORS.NO_KEY,
    };
  }

  const endpoint = PROVIDER_ENDPOINTS[provider] || PROVIDER_ENDPOINTS.glm;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    const payload = {
      model: modelName,
      messages,
      temperature,
      max_tokens,
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[aiProvider] ${provider} 响应异常 [${res.status}]:`, errText);

      if (res.status === 401 || res.status === 403 || res.status === 402 || res.status === 429) {
        return {
          success: false,
          text: '',
          error: AI_ERRORS.AUTH_OR_BALANCE,
        };
      }
      return {
        success: false,
        text: '',
        error: `调用失败 (${res.status})，请稍后再试`,
      };
    }

    const data = await res.json();
    let text = '';
    if (data.choices && data.choices[0] && data.choices[0].message) {
      text = data.choices[0].message.content || '';
    } else if (data.reply) {
      text = data.reply;
    }

    return {
      success: true,
      text: text.trim(),
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { success: false, text: '', error: AI_ERRORS.TIMEOUT };
    }
    console.warn('[aiProvider] 请求异常:', err.message);
    return { success: false, text: '', error: AI_ERRORS.NETWORK };
  }
}

/**
 * 验证用户输入的 API Key 是否有效
 */
export async function testAIConnection(config) {
  const result = await sendChatCompletion({
    messages: [
      { role: 'user', content: '测试：请仅回复“OK”两个字母。' },
    ],
    temperature: 0.1,
    max_tokens: 10,
    overrideConfig: config,
  });
  return result;
}

/**
 * 食谱/菜谱图片 OCR 识别提取
 * @param {string} imageUri - 本地或网络图片 URI
 * @returns {Promise<{ success: boolean, text: string, error?: string }>}
 */
export async function recognizeRecipeImage(imageUri) {
  if (!imageUri) {
    return { success: false, text: '', error: '未提供图片' };
  }

  const dataUrl = await localUriToDataUrl(imageUri);
  const prompt =
    '请识别这张食谱/菜谱图片，提取其中所有文字内容，包括：菜名、食材清单（含用量）、烹饪步骤。请按以下格式输出：\n【食材】\n- 食材1：用量\n【步骤】\n1. 步骤描述\n如果图片不是食谱，请回复：该图片不包含食谱内容。';

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: {
            url: dataUrl,
          },
        },
      ],
    },
  ];

  return sendChatCompletion({
    messages,
    temperature: 0.2,
    max_tokens: 1200,
  });
}
