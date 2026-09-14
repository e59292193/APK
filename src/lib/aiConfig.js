// ═══════════════════════════════════════════════════════
// AI Provider 配置持久化管理 (aiConfig.js)
// 仅保存在本地 AsyncStorage，绝不上送云端服务器
// ═══════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';

export const AI_CONFIG_STORAGE_KEY = '@momi_ai_config';

export const PROVIDER_OPTIONS = [
  {
    key: 'minimax',
    label: 'MiniMax (小米)',
    defaultModel: 'MiniMax M3',
    suggestedModels: ['MiniMax M3', 'abab6.5s-chat', 'abab6.5-chat'],
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    defaultModel: 'deepseek-flash',
    suggestedModels: ['deepseek-flash', 'deepseek-chat', 'deepseek-v4-pro', 'deepseek-reasoner'],
  },
  {
    key: 'glm',
    label: 'GLM (智谱 AI)',
    defaultModel: 'GLM-5.3-Flash',
    suggestedModels: ['GLM-5.3-Flash', 'glm-4-flash', 'glm-4-plus'],
  },
];

export const PROVIDER_ENDPOINTS = {
  minimax: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
  deepseek: 'https://api.deepseek.com/chat/completions',
  glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
};

export const DEFAULT_AI_CONFIG = {
  provider: 'glm',
  apiKey: '',
  modelName: 'GLM-5.3-Flash',
  providers: {
    glm: { apiKey: '', modelName: 'GLM-5.3-Flash' },
    deepseek: { apiKey: '', modelName: 'deepseek-flash' },
    minimax: { apiKey: '', modelName: 'MiniMax M3' },
  },
};

/**
 * 获取对应 Provider 的推荐默认模型名
 */
export function getDefaultModel(provider) {
  const item = PROVIDER_OPTIONS.find((p) => p.key === provider);
  return item ? item.defaultModel : 'GLM-5.3-Flash';
}

/**
 * 获取对应 Provider 的推荐模型列表
 */
export function getSuggestedModels(provider) {
  const item = PROVIDER_OPTIONS.find((p) => p.key === provider);
  return item ? item.suggestedModels : [];
}

/**
 * 从本地 AsyncStorage 读取 AI 配置
 * @returns {Promise<{ provider: string, apiKey: string, modelName: string, providers: object }>}
 */
export async function getAIConfig() {
  try {
    const raw = await AsyncStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (!raw) {
      return JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
    }
    const parsed = JSON.parse(raw);
    const activeProvider = parsed.provider || DEFAULT_AI_CONFIG.provider;

    // 组合各 provider 独立的 key 与 modelName
    const providers = {
      glm: {
        apiKey: '',
        modelName: getDefaultModel('glm'),
        ...(parsed.providers?.glm || {}),
      },
      deepseek: {
        apiKey: '',
        modelName: getDefaultModel('deepseek'),
        ...(parsed.providers?.deepseek || {}),
      },
      minimax: {
        apiKey: '',
        modelName: getDefaultModel('minimax'),
        ...(parsed.providers?.minimax || {}),
      },
    };

    // 兼容历史扁平结构
    if (parsed.apiKey && activeProvider && providers[activeProvider]) {
      if (!providers[activeProvider].apiKey) {
        providers[activeProvider].apiKey = parsed.apiKey;
      }
      if (!providers[activeProvider].modelName && parsed.modelName) {
        providers[activeProvider].modelName = parsed.modelName;
      }
    }

    const currentProviderData = providers[activeProvider] || {
      apiKey: '',
      modelName: getDefaultModel(activeProvider),
    };

    return {
      provider: activeProvider,
      apiKey: currentProviderData.apiKey || '',
      modelName: currentProviderData.modelName || getDefaultModel(activeProvider),
      providers,
    };
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
    const activeProvider = config.provider || existing.provider || 'glm';
    const activeApiKey = (config.apiKey !== undefined ? config.apiKey : existing.apiKey || '').trim();
    const activeModelName = (config.modelName !== undefined ? config.modelName : existing.modelName || '').trim() || getDefaultModel(activeProvider);

    const mergedProviders = {
      ...existing.providers,
      ...(config.providers || {}),
    };

    mergedProviders[activeProvider] = {
      apiKey: activeApiKey,
      modelName: activeModelName,
    };

    const toSave = {
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

