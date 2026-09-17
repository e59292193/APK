// AI Provider 配置：本地持久化 / DeepSeek 与 Qwen / 默认 Flash 模型 / 幂等迁移
import AsyncStorage from '@react-native-async-storage/async-storage';

export const AI_CONFIG_STORAGE_KEY = '@momi_ai_config';
export const AI_CONFIG_VERSION = 3;
export const DEEPSEEK_V41_FLASH_MODEL_ID = 'DeepSeek V4.1 Flash';
export const QWEN_38_FLASH_MODEL_ID = 'Qwen3.8-Flash';
export const VISION_CAPABLE_MODEL_PATTERNS = [
  /v4\.1/i,
  /-vl/i,
  /vl-/i,
  /4v/i,
  /vision/i,
  /omni/i,
  /3\.8/i,
  /flash/i,
];

export const PROVIDER_OPTIONS = [
  {
    key: 'deepseek',
    label: 'DeepSeek',
    defaultModel: DEEPSEEK_V41_FLASH_MODEL_ID,
    supportsVision: true,
    visionFallbackModel: DEEPSEEK_V41_FLASH_MODEL_ID,
    recommended: true,
    suggestedModels: [DEEPSEEK_V41_FLASH_MODEL_ID, 'deepseek-chat', 'deepseek-reasoner'],
  },
  {
    key: 'qwen',
    label: 'Qwen (通义千问)',
    defaultModel: QWEN_38_FLASH_MODEL_ID,
    supportsVision: true,
    visionFallbackModel: 'qwen-vl-plus',
    recommended: false,
    suggestedModels: [
      QWEN_38_FLASH_MODEL_ID,
      'qwen-plus',
      'qwen-turbo',
      'qwen-max',
      'qwen-vl-plus',
      'qwen-vl-max',
    ],
  },
];

export const PROVIDER_ENDPOINTS = {
  deepseek: 'https://api.deepseek.com/chat/completions',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
};

export const DEFAULT_AI_CONFIG = {
  configVersion: AI_CONFIG_VERSION,
  provider: 'deepseek',
  apiKey: '',
  modelName: DEEPSEEK_V41_FLASH_MODEL_ID,
  providers: {
    deepseek: { apiKey: '', modelName: DEEPSEEK_V41_FLASH_MODEL_ID },
    qwen: { apiKey: '', modelName: QWEN_38_FLASH_MODEL_ID },
  },
};

export function getDefaultModel(provider) {
  return PROVIDER_OPTIONS.find((p) => p.key === provider)?.defaultModel || DEEPSEEK_V41_FLASH_MODEL_ID;
}

export function getSuggestedModels(provider) {
  return PROVIDER_OPTIONS.find((p) => p.key === provider)?.suggestedModels || [];
}

export function getProviderOption(provider) {
  return PROVIDER_OPTIONS.find((p) => p.key === provider) || null;
}

export function modelSupportsVision(provider, modelName) {
  const name = String(modelName || '').trim();
  if (!name) return false;
  if (getProviderOption(provider)?.supportsVision === false) return false;
  return VISION_CAPABLE_MODEL_PATTERNS.some((re) => re.test(name));
}

export function getVisionFallbackModel(provider, currentModelName) {
  const fallback = getProviderOption(provider)?.visionFallbackModel;
  if (!fallback || fallback === String(currentModelName || '').trim()) return null;
  return modelSupportsVision(provider, fallback) ? fallback : null;
}

function normalizeModelName(provider, rawModel) {
  const name = String(rawModel || '').trim();
  if (!name) return getDefaultModel(provider);
  if (provider === 'deepseek') {
    if (name === 'deepseek-flash' || name === 'deepseek-v4.1-flash' || name.toLowerCase() === 'deepseek v4.1 flash') {
      return DEEPSEEK_V41_FLASH_MODEL_ID;
    }
  }
  if (provider === 'qwen') {
    if (name === 'qwen3.8-flash' || name.toLowerCase() === 'qwen3.8-flash' || name.toLowerCase() === 'qwen 3.8-flash') {
      return QWEN_38_FLASH_MODEL_ID;
    }
  }
  return name;
}

/** 兼容 providers 结构与历史纯扁平 {provider,apiKey,modelName} */
function buildConfigFromParsed(parsed) {
  let activeProvider = parsed.provider || DEFAULT_AI_CONFIG.provider;
  if (activeProvider !== 'deepseek' && activeProvider !== 'qwen') {
    activeProvider = 'deepseek';
  }

  const hasNestedBucket = Boolean(parsed.providers && parsed.providers[activeProvider]);
  const providers = {};
  for (const option of PROVIDER_OPTIONS) {
    const stored = parsed.providers?.[option.key] || {};
    providers[option.key] = {
      apiKey: stored.apiKey || '',
      modelName: normalizeModelName(option.key, stored.modelName || getDefaultModel(option.key)),
    };
  }

  // 只有 active provider 没有嵌套 bucket 时，顶层值才是旧结构的真值
  if (!hasNestedBucket && providers[activeProvider]) {
    if (parsed.apiKey !== undefined) providers[activeProvider].apiKey = parsed.apiKey || '';
    if (parsed.modelName) {
      providers[activeProvider].modelName = normalizeModelName(activeProvider, parsed.modelName);
    }
  }

  const bucket = providers[activeProvider] || {
    apiKey: parsed.apiKey || '',
    modelName: normalizeModelName(activeProvider, parsed.modelName || getDefaultModel(activeProvider)),
  };

  return {
    configVersion: typeof parsed.configVersion === 'number' ? parsed.configVersion : 1,
    provider: activeProvider,
    apiKey: bucket.apiKey || '',
    modelName: bucket.modelName || getDefaultModel(activeProvider),
    providers,
  };
}

async function migrateConfigToV3(config) {
  const next = JSON.parse(JSON.stringify(config));

  // 确保 provider 只能是 deepseek 或 qwen
  if (next.provider !== 'deepseek' && next.provider !== 'qwen') {
    next.provider = 'deepseek';
  }

  if (!next.providers) {
    next.providers = {};
  }
  if (!next.providers.deepseek) {
    next.providers.deepseek = { apiKey: '', modelName: DEEPSEEK_V41_FLASH_MODEL_ID };
  }
  if (!next.providers.qwen) {
    next.providers.qwen = { apiKey: '', modelName: QWEN_38_FLASH_MODEL_ID };
  }

  next.providers.deepseek.modelName = normalizeModelName('deepseek', next.providers.deepseek.modelName);
  next.providers.qwen.modelName = normalizeModelName('qwen', next.providers.qwen.modelName);

  // 清理不再支持的旧厂商
  delete next.providers.glm;
  delete next.providers.minimax;

  const bucket = next.providers[next.provider] || { apiKey: '', modelName: getDefaultModel(next.provider) };
  next.apiKey = bucket.apiKey || '';
  next.modelName = bucket.modelName || getDefaultModel(next.provider);
  next.configVersion = AI_CONFIG_VERSION;

  try {
    await AsyncStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('[aiConfig] 迁移写回失败（下次重试）:', err.message);
  }
  return next;
}

export async function getAIConfig() {
  try {
    const raw = await AsyncStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
    const config = buildConfigFromParsed(JSON.parse(raw));
    return (config.configVersion || 1) < AI_CONFIG_VERSION ? migrateConfigToV3(config) : config;
  } catch (err) {
    console.warn('[aiConfig] 读取失败，使用默认配置:', err.message);
    return JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
  }
}

export async function saveAIConfig(config) {
  if (!config) return null;
  const existing = await getAIConfig();
  const provider = (config.provider === 'qwen' || config.provider === 'deepseek')
    ? config.provider
    : (existing.provider || 'deepseek');
  const apiKey = String(config.apiKey !== undefined ? config.apiKey : existing.apiKey || '').trim();
  const modelName = normalizeModelName(
    provider,
    String(config.modelName !== undefined ? config.modelName : existing.modelName || '').trim() || getDefaultModel(provider)
  );
  const providers = {
    ...existing.providers,
    ...(config.providers || {}),
    [provider]: { apiKey, modelName },
  };

  const sanitizedProviders = {
    deepseek: {
      apiKey: providers.deepseek?.apiKey || '',
      modelName: normalizeModelName('deepseek', providers.deepseek?.modelName || DEEPSEEK_V41_FLASH_MODEL_ID),
    },
    qwen: {
      apiKey: providers.qwen?.apiKey || '',
      modelName: normalizeModelName('qwen', providers.qwen?.modelName || QWEN_38_FLASH_MODEL_ID),
    },
  };

  const saved = {
    configVersion: AI_CONFIG_VERSION,
    provider,
    apiKey,
    modelName,
    providers: sanitizedProviders,
  };
  await AsyncStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(saved));
  return saved;
}
