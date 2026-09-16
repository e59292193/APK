const store = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => store[key] || null),
  setItem: jest.fn(async (key, value) => { store[key] = value; }),
  clear: jest.fn(async () => { Object.keys(store).forEach((k) => delete store[k]); }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PROVIDER_OPTIONS,
  PROVIDER_ENDPOINTS,
  DEFAULT_AI_CONFIG,
  DEEPSEEK_V41_FLASH_MODEL_ID,
  QWEN_38_FLASH_MODEL_ID,
  AI_CONFIG_STORAGE_KEY,
  getDefaultModel,
  getAIConfig,
  saveAIConfig,
  modelSupportsVision,
  getVisionFallbackModel,
} from '../aiConfig';

describe('aiConfig', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  test('仅支持 DeepSeek 与 Qwen，且默认 DeepSeek V4.1 Flash', async () => {
    expect(PROVIDER_OPTIONS.map((p) => p.key)).toEqual(['deepseek', 'qwen']);

    const deepseek = PROVIDER_OPTIONS.find((p) => p.key === 'deepseek');
    expect(deepseek.recommended).toBe(true);
    expect(getDefaultModel('deepseek')).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(DEFAULT_AI_CONFIG.provider).toBe('deepseek');
    expect((await getAIConfig()).modelName).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(PROVIDER_ENDPOINTS.deepseek).toBe('https://api.deepseek.com/chat/completions');

    const qwen = PROVIDER_OPTIONS.find((p) => p.key === 'qwen');
    expect(qwen).toBeDefined();
    expect(qwen.recommended).toBe(false);
    expect(getDefaultModel('qwen')).toBe(QWEN_38_FLASH_MODEL_ID);
    expect(PROVIDER_ENDPOINTS.qwen).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  });

  test('多厂商配置独立保存', async () => {
    await saveAIConfig({ provider: 'deepseek', apiKey: 'sk-d', modelName: 'deepseek-chat' });
    await saveAIConfig({ provider: 'qwen', apiKey: 'sk-q', modelName: 'qwen-max' });
    const c = await getAIConfig();
    expect(c.provider).toBe('qwen');
    expect(c.providers.deepseek.apiKey).toBe('sk-d');
    expect(c.providers.deepseek.modelName).toBe('deepseek-chat');
    expect(c.providers.qwen.apiKey).toBe('sk-q');
    expect(c.providers.qwen.modelName).toBe('qwen-max');
  });

  test('迁移旧版本配置（如 GLM/旧模型名）切到 DeepSeek/Qwen 并升级至 v3', async () => {
    store[AI_CONFIG_STORAGE_KEY] = JSON.stringify({
      configVersion: 2,
      provider: 'glm',
      providers: {
        glm: { apiKey: 'sk-old', modelName: 'GLM-5.3-Flash' },
        deepseek: { apiKey: '', modelName: 'deepseek-flash' },
      },
    });
    const c = await getAIConfig();
    expect(c.provider).toBe('deepseek');
    expect(c.modelName).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(c.providers.deepseek.modelName).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(c.providers.qwen).toBeDefined();
    expect(c.providers.glm).toBeUndefined();
    expect(c.configVersion).toBe(3);
  });

  test('迁移保留已有 DeepSeek Key 与手动模型', async () => {
    store[AI_CONFIG_STORAGE_KEY] = JSON.stringify({
      configVersion: 2,
      provider: 'deepseek',
      providers: {
        deepseek: { apiKey: 'sk-real-deepseek', modelName: 'deepseek-reasoner' },
      },
    });
    const c = await getAIConfig();
    expect(c.provider).toBe('deepseek');
    expect(c.apiKey).toBe('sk-real-deepseek');
    expect(c.modelName).toBe('deepseek-reasoner');
    expect(c.providers.deepseek.apiKey).toBe('sk-real-deepseek');
    expect(c.configVersion).toBe(3);
  });

  test('回归：纯扁平旧配置迁移不丢手动模型和Key', async () => {
    store[AI_CONFIG_STORAGE_KEY] = JSON.stringify({
      provider: 'deepseek',
      apiKey: 'sk-legacy',
      modelName: 'my-private-model',
    });
    const c = await getAIConfig();
    expect(c.provider).toBe('deepseek');
    expect(c.apiKey).toBe('sk-legacy');
    expect(c.modelName).toBe('my-private-model');
    expect(c.providers.deepseek.modelName).toBe('my-private-model');
    expect(c.configVersion).toBe(3);
  });

  test('迁移幂等，只首次写回', async () => {
    store[AI_CONFIG_STORAGE_KEY] = JSON.stringify({
      configVersion: 3,
      provider: 'deepseek',
      modelName: 'deepseek-chat',
      apiKey: 'x',
      providers: {
        deepseek: { apiKey: 'x', modelName: 'deepseek-chat' },
        qwen: { apiKey: '', modelName: QWEN_38_FLASH_MODEL_ID },
      },
    });
    const first = await getAIConfig();
    const writes = AsyncStorage.setItem.mock.calls.length;
    expect(await getAIConfig()).toEqual(first);
    expect(AsyncStorage.setItem.mock.calls.length).toBe(writes);
  });

  test('识图能力与 fallback', () => {
    expect(modelSupportsVision('deepseek', DEEPSEEK_V41_FLASH_MODEL_ID)).toBe(true);
    expect(modelSupportsVision('deepseek', 'deepseek-chat')).toBe(false);
    expect(modelSupportsVision('qwen', QWEN_38_FLASH_MODEL_ID)).toBe(true);
    expect(modelSupportsVision('qwen', 'qwen-vl-plus')).toBe(true);
    expect(modelSupportsVision('qwen', 'qwen-vl-max')).toBe(true);
    expect(modelSupportsVision('qwen', 'qwen-plus')).toBe(false);
    expect(modelSupportsVision('qwen', 'qwen-turbo')).toBe(false);
    expect(getVisionFallbackModel('deepseek', 'deepseek-chat')).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(getVisionFallbackModel('qwen', 'qwen-plus')).toBe('qwen-vl-plus');
  });
});
