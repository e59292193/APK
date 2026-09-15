// AI Provider 配置：本地持久化 / DeepSeek V4.1 Flash 默认 / 幂等迁移
import AsyncStorage from '@react-native-async-storage/async-storage';

export const AI_CONFIG_STORAGE_KEY = '@momi_ai_config';
export const AI_CONFIG_VERSION = 2;
export const DEEPSEEK_V41_FLASH_MODEL_ID = 'deepseek-v4.1-flash';
export const VISION_CAPABLE_MODEL_PATTERNS = [/v4\.1/i, /-vl/i, /4v/i, /vision/i, /omni/i];

export const PROVIDER_OPTIONS = [
  { key: 'deepseek', label: 'DeepSeek', defaultModel: DEEPSEEK_V41_FLASH_MODEL_ID, supportsVision: true, visionFallbackModel: DEEPSEEK_V41_FLASH_MODEL_ID, recommended: true, suggestedModels: [DEEPSEEK_V41_FLASH_MODEL_ID, 'deepseek-chat', 'deepseek-reasoner', 'deepseek-flash'] },
  { key: 'glm', label: 'GLM (智谱 AI)', defaultModel: 'GLM-5.3-Flash', supportsVision: true, visionFallbackModel: 'glm-4v-flash', recommended: false, suggestedModels: ['GLM-5.3-Flash', 'glm-4v-flash', 'glm-4-flash', 'glm-4-plus'] },
  { key: 'minimax', label: 'MiniMax (小米)', defaultModel: 'MiniMax M3', supportsVision: false, visionFallbackModel: null, recommended: false, suggestedModels: ['MiniMax M3', 'abab6.5s-chat', 'abab6.5-chat'] },
];

export const PROVIDER_ENDPOINTS = {
  minimax: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
  deepseek: 'https://api.deepseek.com/chat/completions',
  glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
};

export const DEFAULT_AI_CONFIG = {
  configVersion: AI_CONFIG_VERSION,
  provider: 'deepseek', apiKey: '', modelName: DEEPSEEK_V41_FLASH_MODEL_ID,
  providers: {
    deepseek: { apiKey: '', modelName: DEEPSEEK_V41_FLASH_MODEL_ID },
    glm: { apiKey: '', modelName: 'GLM-5.3-Flash' },
    minimax: { apiKey: '', modelName: 'MiniMax M3' },
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

/** 兼容 providers 结构与历史纯扁平 {provider,apiKey,modelName}。 */
function buildConfigFromParsed(parsed) {
  const activeProvider = parsed.provider || DEFAULT_AI_CONFIG.provider;
  const hasNestedBucket = Boolean(parsed.providers && parsed.providers[activeProvider]);
  const providers = {};
  for (const option of PROVIDER_OPTIONS) {
    const stored = parsed.providers?.[option.key] || {};
    providers[option.key] = {
      apiKey: stored.apiKey || '',
      modelName: stored.modelName || getDefaultModel(option.key),
    };
  }
  // 只有 active provider 没有嵌套 bucket 时，顶层值才是旧结构的真值。
  // 这一步必须覆盖刚填入的默认 model，否则用户手动模型会丢失。
  if (!hasNestedBucket && providers[activeProvider]) {
    if (parsed.apiKey !== undefined) providers[activeProvider].apiKey = parsed.apiKey || '';
    if (parsed.modelName) providers[activeProvider].modelName = parsed.modelName;
  }
  const bucket = providers[activeProvider] || { apiKey: parsed.apiKey || '', modelName: parsed.modelName || getDefaultModel(activeProvider) };
  return {
    configVersion: typeof parsed.configVersion === 'number' ? parsed.configVersion : 1,
    provider: activeProvider,
    apiKey: bucket.apiKey || '',
    modelName: bucket.modelName || getDefaultModel(activeProvider),
    providers,
  };
}

async function migrateConfigToV2(config) {
  const next = JSON.parse(JSON.stringify(config));
  if (next.providers.deepseek?.modelName === 'deepseek-flash') next.providers.deepseek.modelName = DEEPSEEK_V41_FLASH_MODEL_ID;
  const glmKey = String(next.providers.glm?.apiKey || '').trim();
  if (next.provider === 'glm' && !glmKey) next.provider = 'deepseek';
  const bucket = next.providers[next.provider] || { apiKey: '', modelName: getDefaultModel(next.provider) };
  next.apiKey = bucket.apiKey || '';
  next.modelName = bucket.modelName || getDefaultModel(next.provider);
  next.configVersion = AI_CONFIG_VERSION;
  try { await AsyncStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(next)); }
  catch (err) { console.warn('[aiConfig] 迁移写回失败（下次重试）:', err.message); }
  return next;
}

export async function getAIConfig() {
  try {
    const raw = await AsyncStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
    const config = buildConfigFromParsed(JSON.parse(raw));
    return (config.configVersion || 1) < AI_CONFIG_VERSION ? migrateConfigToV2(config) : config;
  } catch (err) {
    console.warn('[aiConfig] 读取失败，使用默认配置:', err.message);
    return JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
  }
}

export async function saveAIConfig(config) {
  if (!config) return null;
  const existing = await getAIConfig();
  const provider = config.provider || existing.provider || 'deepseek';
  const apiKey = String(config.apiKey !== undefined ? config.apiKey : existing.apiKey || '').trim();
  const modelName = String(config.modelName !== undefined ? config.modelName : existing.modelName || '').trim() || getDefaultModel(provider);
  const providers = { ...existing.providers, ...(config.providers || {}), [provider]: { apiKey, modelName } };
  const saved = { configVersion: AI_CONFIG_VERSION, provider, apiKey, modelName, providers };
  await AsyncStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(saved));
  return saved;
}
