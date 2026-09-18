// ═══════════════════════════════════════════════════════
// momi AI 统一调用层 (aiProvider.js)
// OpenAI 兼容封装 + 识图能力判定 + 分级超时 + 结构化错误码
// V6：新增 SSE 流式输出（onToken），首字延迟从「等整段生成完」降到「首个 token」
// 注意：XHR 必须通过 global 取用，项目 eslint env 不含 browser，直接写 XMLHttpRequest 会 no-undef
// ═══════════════════════════════════════════════════════

import { Image } from 'react-native';
import { File } from 'expo-file-system';
import {
  getAIConfig,
  PROVIDER_ENDPOINTS,
  getDefaultModel,
  modelSupportsVision,
  getVisionFallbackModel,
} from './aiConfig';

// 分级超时：带 Base64 图片的请求体大、上传慢，15s 必定超时（历史 bug 根源之一）
export const REQUEST_TIMEOUT_TEXT_MS = 20000;
export const REQUEST_TIMEOUT_VISION_MS = 45000;

// 结构化错误码，便于上层做差异化文案与重试策略
export const AI_ERROR_CODES = {
  NO_KEY: 'NO_KEY',
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  AUTH_OR_BALANCE: 'AUTH_OR_BALANCE',
  VISION_UNSUPPORTED: 'VISION_UNSUPPORTED',
  RATE_LIMIT: 'RATE_LIMIT',
  SERVER_ERROR: 'SERVER_ERROR',
};

export const AI_ERRORS = {
  NO_KEY: '请先在设置中配置 momi AI',
  NETWORK: 'momi 睡着了，请稍后再试 zzz',
  AUTH_OR_BALANCE: 'momi 的能量耗尽了，请检查 API Key 或账户余额',
  TIMEOUT: 'momi 正在思考但超时了，请重试',
  VISION_UNSUPPORTED: '现在这个模型看不了图，去 momi 设置里换支持识图的模型 🐾',
  RATE_LIMIT: 'momi 被问得太频繁啦，稍等一下再试~',
  SERVER_ERROR: 'AI 服务暂时开小差了，请稍后再试',
};

function failure(errorCode, error) {
  return {
    success: false,
    text: '',
    errorCode,
    error: error || AI_ERRORS[errorCode] || '未知错误',
  };
}

/** 取当前运行环境的 XHR 构造器；不可用时返回 null，由调用方回落非流式 */
function getXhrCtor() {
  const scope = typeof globalThis !== 'undefined' ? globalThis : null;
  if (scope && typeof scope.XMLHttpRequest === 'function') return scope.XMLHttpRequest;
  return null;
}

/**
 * 判断 messages 中是否携带图片（OpenAI 多模态结构）
 */
export function messagesContainImage(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => {
    const c = m && m.content;
    return Array.isArray(c) && c.some((part) => part && part.type === 'image_url');
  });
}

function getImageSize(uri) {
  return new Promise((resolve) => {
    try {
      Image.getSize(
        uri,
        (width, height) => resolve({ width, height }),
        () => resolve({ width: 0, height: 0 })
      );
    } catch {
      resolve({ width: 0, height: 0 });
    }
  });
}

/**
 * 图片压缩预处理：长边 <= 1024px、JPEG quality 0.7。
 * 手机原图（5-12MB）直接转 Base64 会接近 10MB 文本，必定超时或被服务端 413 拒绝。
 */
export async function compressImageForAI(uri, maxEdge = 1024) {
  if (!uri || uri.startsWith('data:') || uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }
  try {
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator');
    const { width, height } = await getImageSize(uri);
    const context = ImageManipulator.manipulate(uri);
    const longEdge = Math.max(width, height);
    const targetEdge = Number(maxEdge) || 1024;
    if (longEdge > targetEdge && width > 0 && height > 0) {
      if (width >= height) {
        context.resize({ width: targetEdge });
      } else {
        context.resize({ height: targetEdge });
      }
    }
    const ref = await context.renderAsync();
    const saved = await ref.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return saved.uri;
  } catch (err) {
    console.warn('[aiProvider] 图片压缩失败，回退原图:', err.message);
    return uri;
  }
}

/**
 * 将本地图片文件转换为 Base64 data URL（先压缩再转换）
 */
export async function localUriToDataUrl(uri) {
  if (!uri) return '';
  if (uri.startsWith('data:') || uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }
  try {
    const compressed = await compressImageForAI(uri);
    const file = new File(compressed);
    const base64 = await file.base64();
    return `data:image/jpeg;base64,${base64}`;
  } catch (err) {
    console.warn('[aiProvider] 本地图片转 base64 失败，尝试以原始路径传递:', err.message);
    return uri;
  }
}

/**
 * 解析底层实际发送给 API 的 model 参数：
 * - 用户若填入具体的官方模型（如 deepseek-chat, deepseek-reasoner, qwen-plus, qwen-turbo, qwen-max, qwen-vl-plus 等）或自定义代理模型，直接透传；
 * - 若为默认别名「DeepSeek V4.1 Flash」或「Qwen3.8-Flash」，在调用对应官方平台时映射为可用的标准模型（DeepSeek -> deepseek-chat；Qwen -> 识图时 qwen-vl-plus，纯文本 qwen-plus）。
 */
export function resolveApiModel(provider, modelName, needsVision = false) {
  const clean = String(modelName || '').trim();
  if (provider === 'deepseek') {
    if (/^deepseek[- ]v?4(\.1)?[- ]flash$/i.test(clean)) {
      return 'deepseek-chat';
    }
    return clean || 'deepseek-chat';
  }
  if (provider === 'qwen') {
    if (/^qwen[- ]?3?\.?8?[- ]?flash$/i.test(clean)) {
      return needsVision ? 'qwen-vl-plus' : 'qwen-plus';
    }
    return clean || (needsVision ? 'qwen-vl-plus' : 'qwen-plus');
  }
  return clean;
}

function isModelNotFoundError(status, errText) {
  if (status === 400 || status === 404) {
    const text = String(errText || '').toLowerCase();
    return (
      text.includes('model_not_found') ||
      text.includes('does not exist') ||
      text.includes('invalidmodel') ||
      text.includes('model not found') ||
      text.includes('not found: model')
    );
  }
  return false;
}

/** HTTP 失败 → 结构化错误码（流式与非流式共用同一套映射） */
function mapHttpFailure(status, errText) {
  const errLower = String(errText || '').toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    status === 402 ||
    errLower.includes('insufficient_quota') ||
    errLower.includes('quota') ||
    errLower.includes('arrearage') ||
    errLower.includes('balance') ||
    errLower.includes('欠费')
  ) {
    return failure(AI_ERROR_CODES.AUTH_OR_BALANCE);
  }
  if (status === 429) {
    return failure(AI_ERROR_CODES.RATE_LIMIT);
  }
  if (
    status === 400 &&
    (errLower.includes('image_url') ||
      errLower.includes('multimodal') ||
      errLower.includes('image') ||
      errLower.includes('vision') ||
      errLower.includes('picture'))
  ) {
    return failure(AI_ERROR_CODES.VISION_UNSUPPORTED);
  }
  if (status >= 500) {
    return failure(AI_ERROR_CODES.SERVER_ERROR, `AI 服务异常 (${status})，请稍后再试`);
  }
  return failure(AI_ERROR_CODES.SERVER_ERROR, `调用失败 (${status})，请稍后再试`);
}

/**
 * 从一行 SSE 文本里取出增量内容。
 * OpenAI 兼容格式：data: {"choices":[{"delta":{"content":"你"}}]}
 */
export function parseSseLine(rawLine) {
  const line = String(rawLine || '').trim();
  if (!line || line.startsWith(':')) return '';
  if (!line.startsWith('data:')) return '';
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return '';
  try {
    const json = JSON.parse(payload);
    const choice = (json.choices && json.choices[0]) || {};
    const delta = choice.delta || {};
    if (typeof delta.content === 'string' && delta.content) return delta.content;
    if (choice.message && typeof choice.message.content === 'string') return choice.message.content;
    return '';
  } catch {
    // 分片还没拼完整，等下一段
    return '';
  }
}

/**
 * SSE 流式请求。RN 的 fetch 不支持增量读取 body，这里用 XHR 的增量 responseText。
 * 返回：
 *   { ok, text }                       —— 正常读完
 *   { timeout, text }                  —— 超时（text 可能已有部分内容）
 *   { httpError, status, errText }     —— 服务端错误
 *   { unsupported }                    —— 环境不支持流式，交由非流式兜底
 */
function streamChatCompletionViaXHR({ endpoint, headers, payload, timeoutMs, onToken }) {
  return new Promise((resolve) => {
    const XhrCtor = getXhrCtor();
    if (!XhrCtor) {
      resolve({ unsupported: true });
      return;
    }

    let xhr = null;
    try {
      xhr = new XhrCtor();
    } catch {
      resolve({ unsupported: true });
      return;
    }
    if (!xhr) {
      resolve({ unsupported: true });
      return;
    }

    let settled = false;
    let consumed = 0;
    let buffer = '';
    let full = '';
    let sawAnyChunk = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (xhr.readyState !== 4) xhr.abort();
      } catch {
        // 忽略 abort 异常
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish({ timeout: true, text: full }), timeoutMs);

    const consume = () => {
      const text = xhr.responseText || '';
      if (text.length <= consumed) return;
      buffer += text.slice(consumed);
      consumed = text.length;
      sawAnyChunk = true;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (let i = 0; i < lines.length; i += 1) {
        const delta = parseSseLine(lines[i]);
        if (delta) {
          full += delta;
          if (onToken) {
            try {
              onToken(delta);
            } catch {
              // UI 回调异常不能影响取数
            }
          }
        }
      }
    };

    xhr.onreadystatechange = () => {
      if (settled) return;
      if (xhr.readyState === 3 && xhr.status === 200) {
        consume();
        return;
      }
      if (xhr.readyState === 4) {
        const status = xhr.status || 0;
        if (status === 200) {
          consume();
          if (buffer) {
            const tail = parseSseLine(buffer);
            if (tail) {
              full += tail;
              if (onToken) {
                try {
                  onToken(tail);
                } catch {
                  // 忽略
                }
              }
            }
          }
          if (!full && !sawAnyChunk) {
            finish({ unsupported: true });
            return;
          }
          finish({ ok: true, text: full });
          return;
        }
        if (status === 0) {
          finish(full ? { timeout: true, text: full } : { unsupported: true });
          return;
        }
        finish({ httpError: true, status, errText: xhr.responseText || '' });
      }
    };

    xhr.onerror = () => finish(full ? { timeout: true, text: full } : { unsupported: true });
    xhr.ontimeout = () => finish({ timeout: true, text: full });

    try {
      xhr.open('POST', endpoint, true);
      Object.keys(headers).forEach((key) => xhr.setRequestHeader(key, headers[key]));
      xhr.setRequestHeader('Accept', 'text/event-stream');
      xhr.timeout = timeoutMs;
      xhr.send(JSON.stringify({ ...payload, stream: true }));
    } catch (err) {
      console.warn('[aiProvider] 流式请求发起失败，回落非流式:', err.message);
      finish({ unsupported: true });
    }
  });
}

/**
 * 执行统一的 OpenAI 兼容 Chat Completions 请求
 * @param {object} params
 * @param {Array} params.messages - OpenAI 兼容 messages 数组
 * @param {number} [params.temperature=0.7]
 * @param {number} [params.max_tokens=1024]
 * @param {object} [params.overrideConfig] - 用于测试连接或临时覆盖配置
 * @param {boolean} [params.requiresVision=false] - 本轮请求必须支持识图
 * @param {function} [params.onToken] - 传入即启用 SSE 流式，每收到一段增量文本回调一次
 * @returns {Promise<{ success: boolean, text: string, error?: string, errorCode?: string, usedFallbackModel?: boolean, modelUsed?: string, streamed?: boolean }>}
 */
export async function sendChatCompletion({
  messages,
  temperature = 0.7,
  top_p = 0.9,
  max_tokens = 1024,
  overrideConfig = null,
  requiresVision = false,
  onToken = null,
}) {
  const config = overrideConfig || (await getAIConfig());
  const provider = config.provider === 'qwen' ? 'qwen' : 'deepseek';
  const apiKey = (config.apiKey || '').trim();
  let configuredModel = (config.modelName || '').trim() || getDefaultModel(provider);
  let usedFallbackModel = false;

  if (!apiKey) {
    return failure(AI_ERROR_CODES.NO_KEY);
  }

  const hasImages = messagesContainImage(messages);
  const needsVision = requiresVision || hasImages;

  // 识图能力判定：当前模型不支持时，先尝试临时降级模型
  if (needsVision && !modelSupportsVision(provider, configuredModel)) {
    const fallback = getVisionFallbackModel(provider, configuredModel);
    if (fallback) {
      configuredModel = fallback; // 仅本次请求生效，不持久化用户配置
      usedFallbackModel = true;
    } else {
      return failure(AI_ERROR_CODES.VISION_UNSUPPORTED);
    }
  }

  const endpoint = PROVIDER_ENDPOINTS[provider] || PROVIDER_ENDPOINTS.deepseek;
  const timeoutMs = needsVision ? REQUEST_TIMEOUT_VISION_MS : REQUEST_TIMEOUT_TEXT_MS;

  const actualModel = resolveApiModel(provider, configuredModel, needsVision);

  const buildHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  });

  const buildPayload = (targetModel) => ({
    model: targetModel,
    messages,
    temperature,
    top_p,
    max_tokens,
  });

  async function executeRequest(targetModel) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(buildPayload(targetModel)),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[aiProvider] ${provider} 响应异常 [${res.status}]:`, errText);

        if (isModelNotFoundError(res.status, errText)) {
          return { modelNotFound: true, status: res.status, errText };
        }
        return mapHttpFailure(res.status, errText);
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
        usedFallbackModel,
        modelUsed: targetModel,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        return failure(AI_ERROR_CODES.TIMEOUT);
      }
      console.warn('[aiProvider] 请求异常:', err.message);
      return failure(AI_ERROR_CODES.NETWORK);
    }
  }

  // 流式优先：首字可见时间显著低于整段等待；失败时静默回落非流式。
  async function executeStreamRequest(targetModel) {
    const streamResult = await streamChatCompletionViaXHR({
      endpoint,
      headers: buildHeaders(),
      payload: buildPayload(targetModel),
      timeoutMs,
      onToken,
    }).catch((err) => {
      console.warn('[aiProvider] 流式请求异常:', err.message);
      return { unsupported: true };
    });

    if (streamResult.ok && streamResult.text) {
      return {
        success: true,
        text: streamResult.text.trim(),
        usedFallbackModel,
        modelUsed: targetModel,
        streamed: true,
      };
    }
    if (streamResult.httpError) {
      if (isModelNotFoundError(streamResult.status, streamResult.errText)) {
        return { modelNotFound: true, status: streamResult.status, errText: streamResult.errText };
      }
      console.warn(`[aiProvider] ${provider} 流式响应异常 [${streamResult.status}]`);
      return mapHttpFailure(streamResult.status, streamResult.errText);
    }
    if (streamResult.timeout && streamResult.text) {
      // 已经有内容就不算失败，按已收到的部分回复返回
      return {
        success: true,
        text: streamResult.text.trim(),
        usedFallbackModel,
        modelUsed: targetModel,
        streamed: true,
        truncated: true,
      };
    }
    return null;
  }

  let result = null;
  if (typeof onToken === 'function') {
    result = await executeStreamRequest(actualModel);
  }
  if (!result) {
    result = await executeRequest(actualModel);
  }

  // 若服务端提示模型不存在，自动降级至平台标配基底模型重试一次
  if (result.modelNotFound) {
    const fallbackStandard = provider === 'deepseek'
      ? 'deepseek-chat'
      : (needsVision ? 'qwen-vl-plus' : 'qwen-plus');

    if (actualModel !== fallbackStandard) {
      console.warn(`[aiProvider] 模型 ${actualModel} 未找到，尝试降级到 ${fallbackStandard}`);
      result = await executeRequest(fallbackStandard);
      if (result.success) {
        result.usedFallbackModel = true;
      }
    }
    if (result.modelNotFound) {
      return failure(AI_ERROR_CODES.SERVER_ERROR, `模型不存在或未开通权限 (${result.status})`);
    }
  }

  return result;
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
 * 测试当前模型的识图能力：发送内置小图（红色圆形），要求模型描述。
 * 成功并返回有效描述 => 识图可用；返回 VISION_UNSUPPORTED/其他错误 => 不可用。
 */
export async function testVisionCapability(config) {
  const { VISION_TEST_IMAGE_DATA_URL } = require('./visionTestImage');
  const result = await sendChatCompletion({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '请用一句中文描述这张图片里的颜色和形状。' },
          { type: 'image_url', image_url: { url: VISION_TEST_IMAGE_DATA_URL } },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 80,
    overrideConfig: config,
    requiresVision: true,
  });
  return result;
}

/**
 * 食谱/菜谱图片 OCR 识别提取
 * @param {string} imageUri - 本地或网络图片 URI
 * @returns {Promise<{ success: boolean, text: string, error?: string, errorCode?: string }>}
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
    requiresVision: true,
  });
}
