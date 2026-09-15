// ═══════════════════════════════════════════════════════
// AI Provider 配置持久化管理 (aiConfig.js)
// 仅保存在本地 AsyncStorage，绝不上送云端服务器
// V2：DeepSeek V4.1 Flash 设为全局默认 + 识图能力元数据 + 存量用户幂等迁移
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';

export const AI_CONFIG_STORAGE_KEY = '@momi_ai_config';

// 配置结构当前版本号。每次调整默认值/结构时 +1，getAIConfig 内执行幂等迁移。
export const AI_CONFIG_VERSION = 2;

// DeepSeek V4.1 Flash 的 model id —— 全局唯一真相来源（单一修改点）。
// 【重要】官方 model 字符串若与此不完全一致，用户可在设置界面自由修改，
// 任何地方都不要把它做成不可改的枚举。
export const DEEPSEEK_V41_FLASH_MODEL_ID = 'deepseek-v4.1-flash';

// 识图能力判定正则：命中任一则认为该模型支持图片输入。
// 用正则而不用硬编码白名单，以适应后续新模型。
export const VISION_CAPABLE_MODEL_PATTERNS = [
  /v4\.1/i,
  /-vl/i,
  /4v/i,
  /vision/i,
  /omni/i,
];

export const PROVIDER_OPTIONS = [
  {
    key: 'deepseek',
    label: 'DeepSeek',
    defaultModel: DEEPSEEK_V41_FLASH_MODEL_ID,
    supportsVision: true,
    visionFallbackModel: DEEPSEEK_V41_FLASH_MODEL_ID,
    recommended: true,
    suggestedModels: [
      DEEPSEEK_V41_FLASH_MODEL_ID, // 支持识图，默认
      'deepseek-chat',
      'deepseek-reasoner',
      'deepseek-flash',
    ],
  },
  {
    key: 'glm',
    label: 'GLM (智谱 AI)',
    defaultModel: 'GLM-5.3-Flash',
    // 视具体模型而定：由 modelSupportsVision() 按模型名正则判定
    supportsVision: true,
    visionFallbackModel: 'glm-4v-flash',
    recommended: false,
    suggestedModels: ['GLM-5.3-Flash', 'glm-4v-flash', 'glm-4-flash', 'glm-4-plus'],
  },
  {
    key: 'minimax',
    label: 'MiniMax (小米)',
    defaultModel: 'MiniMax M3',
    supportsVision: false,
    visionFallbackModel: null,
    recommended: false,
    suggestedModels: ['MiniMax M3', 'abab6.5s-chat', 'abab6.5-chat'],
  },
];

export const PROVIDER_ENDPOINTS = {
  minimax: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
  deepseek: 'https://api.deepseek.com/chat/completions',
  glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
};

export const DEFAULT_AI_CONFIG = {
  configVersion: AI_CONFIG_VERSION,
  provider: 'deepseek',
  apiKey: '',
  modelName: DEEPSEEK_V41_FLASH_MODEL_ID,
  providers: {
    deepseek: { apiKey: '', modelName: DEEPSEEK_V41_FLASH_MODEL_ID },
    glm: { apiKey: '', modelName: 'GLM-5.3-Flash' },
    minimax: { apiKey: '', modelName: 'MiniMax M3' },
  },
};

/**
 * 获取对应 Provider 的推荐默认模型名
 */
export function getDefaultModel(provider) {
  const item = PROVIDER_OPTIONS.find((p) => p.key === provider);
  return item ? item.defaultModel : DEEPSEEK_V41_FLASH_MODEL_ID;
}

/**
 * 获取对应 Provider 的推荐模型列表
 */
export function getSuggestedModels(provider) {
  const item = PROVIDER_OPTIONS.find((p) => p.key === provider);
  return item ? item.suggestedModels : [];
}

/**
 * 获取 Provider 完整元数据
 */
export function getProviderOption(provider) {
  return PROVIDER_OPTIONS.find((p) => p.key === provider) || null;
}

/**
 * 判定指定 provider 的指定模型是否支持识图（图片输入）。
 * provider 级 supportsVision === false 直接判否（如无视觉模型的厂商）；
 * 其余按模型名命中 VISION_CAPABLE_MODEL_PATTERNS 判定。
 */
export function modelSupportsVision(provider, modelName) {
  const name = (modelName || '').trim();
  if (!name) return false;
  const meta = getProviderOption(provider);
  if (meta && meta.supportsVision === false) return false;
  return VISION_CAPABLE_MODEL_PATTERNS.some((re) => re.test(name));
}

/**
 * 返回该 provider 可用的识图降级模型。
 * 仅当配置了 visionFallbackModel、与当前模型不同、且该模型确实支持识图时返回。
 */
export function getVisionFallbackModel(provider, currentModelName) {
  const meta = getProviderOption(provider);
  if (!meta || !meta.visionFallbackModel) return null;
  const fallback = meta.visionFallbackModel;
  if (!fallback || fallback === (currentModelName || '').trim()) return null;
  if (!modelSupportsVision(provider, fallback)) return null;
  return fallback;
}

/**
 * 从持久化 JSON 组装配置对象（兼容历史扁平结构）
 */
function buildConfigFromParsed(parsed) {
  const activeProvider = parsed.provider || DEFAULT_AI_CONFIG.provider;

  // 组合各 provider 独立的 key 与 modelName
  const providers = {};
  for (const p of PROVIDER_OPTIONS) {
    providers[p.key] = {
      apiKey: '',
      modelName: getDefaultModel(p.key),
      ...((parsed.providers && parsed.providers[p.key]) || {}),
    };
  }

  // 兼容历史扁平结构（apiKey/modelName 在顶层）
  if (parsed.apiKey && providers[activeProvider] && !providers[activeProvider].apiKey) {
    providers[activeProvider].apiKey = parsed.apiKey;
  }
  if (parsed.modelName && providers[activeProvider] && !providers[activeProvider].modelName) {
    providers[activeProvider].modelName = parsed.modelName;
  }

  const bucket = providers[activeProvider] || {
    apiKey: '',
    modelName: getDefaultModel(activeProvider),
  };

  return {
    configVersion: typeof parsed.configVersion === 'number' ? parsed.configVersion : 1,
    provider: activeProvider,
    apiKey: bucket.apiKey || '',
    modelName: bucket.modelName || getDefaultModel(activeProvider),
    providers,
  };
}

/**
 * v1 -> v2 迁移（幂等）：DeepSeek V4.1 Flash 成为全局默认。
 * 规则（严格按提示词 2.2）：
 *   a) providers.deepseek.modelName 仍为旧默认 'deepseek-flash' => 升级为 V4.1 Flash；
 *      用户曾手动改成其他值 => 尊重，不覆盖。
 *   b) provider 仍为 'glm' 且 GLM 未填 Key（说明没真正在用）=> 切换为 'deepseek'；
 *      GLM 已填 Key => 不动，尊重用户。
 *   c) 写回 configVersion = 2。
 */
async function migrateConfigToV2(config) {
  const next = JSON.parse(JSON.stringify(config));

  if (next.providers.deepseek && next.providers.deepseek.modelName === 'deepseek-flash') {
    next.providers.deepseek.modelName = DEEPSEEK_V41_FLASH_MODEL_ID;
  }

  const glmKey = ((next.providers.glm && next.providers.glm.apiKey) || '').trim();
  if (next.provider === 'glm' && !glmKey) {
    next.provider = 'deepseek';
  }

  const bucket = next.providers[next.provider] || {
    apiKey: '',
    modelName: getDefaultModel(next.provider),
  };
  next.apiKey = bucket.apiKey || '';
  next.modelName = bucket.modelName || getDefaultModel(next.provider);
  next.configVersion = AI_CONFIG_VERSION;

  try {
    await AsyncStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('[aiConfig] 迁移配置写回失败（下次启动会重试）:', err.message);
  }
  return next;
}

/**
 * 从本地 AsyncStorage 读取 AI 配置（含幂等迁移）
 * @returns {Promise<{ configVersion: number, provider: string, apiKey: string, modelName: string, providers: object }>}
 */
export async function getAIConfig() {
  try {
    const raw = await AsyncStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (!raw) {
      return JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
    }
    const config = buildConfigFromParsed(JSON.parse(raw));
    if ((config.configVersion || 1) < AI_CONFIG_VERSION) {
      return await migrateConfigToV2(config);
    }
    return config;
  } catch (err) {
    console.warn('[aiConfig] 读取 AI 配置失败，使用默认配置:', err.message);
    return JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
  }
}

/**
 * 保存 AI 配置到本地 AsyncStorage
 * @param {object} config - { provider, apiKey, modelName, providers? }
 */
export async function saveAIConfig(config) {
  if (!config) return null;

  try {
    // 先读出现有配置以支持增量合并
    const existing = await getAIConfig();
    const activeProvider = config.provider || existing.provider || 'deepseek';
    const activeApiKey = (config.apiKey !== undefined ? config.apiKey : existing.apiKey || '').trim();
    const activeModelName =
      (config.modelName !== undefined ? config.modelName : existing.modelName || '').trim() ||
      getDefaultModel(activeProvider);

    const mergedProviders = {
      ...existing.providers,
      ...(config.providers || {}),
    };

    mergedProviders[activeProvider] = {
      apiKey: activeApiKey,
      modelName: activeModelName,
    };

    const toSave = {
      configVersion: AI_CONFIG_VERSION,
      provider: activeProvider,
      apiKey: activeApiKey,
      modelName: activeModelName,
      providers: mergedProviders,
    };

    await AsyncStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(toSave));
    return toSave;
  } catch (err) {
    console.warn('[aiConfig] 保存 AI 配置失败:', err.message);
    throw err;
  }
}
