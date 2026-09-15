const store = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => store[key] || null),
  setItem: jest.fn(async (key, value) => { store[key] = value; }),
  clear: jest.fn(async () => { Object.keys(store).forEach((k) => delete store[k]); }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PROVIDER_OPTIONS, PROVIDER_ENDPOINTS, DEFAULT_AI_CONFIG,
  DEEPSEEK_V41_FLASH_MODEL_ID, AI_CONFIG_STORAGE_KEY, getDefaultModel,
  getAIConfig, saveAIConfig, modelSupportsVision, getVisionFallbackModel,
} from '../aiConfig';

describe('aiConfig', () => {
  beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });

  test('默认 DeepSeek V4.1 Flash 且推荐', async () => {
    const deepseek = PROVIDER_OPTIONS.find((p) => p.key === 'deepseek');
    expect(deepseek.recommended).toBe(true);
    expect(getDefaultModel('deepseek')).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(DEFAULT_AI_CONFIG.provider).toBe('deepseek');
    expect((await getAIConfig()).modelName).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(PROVIDER_ENDPOINTS.glm).toContain('bigmodel.cn');
  });

  test('多厂商配置独立保存', async () => {
    await saveAIConfig({ provider: 'deepseek', apiKey: 'sk-d', modelName: 'deepseek-chat' });
    await saveAIConfig({ provider: 'glm', apiKey: 'sk-g', modelName: 'glm-4v-flash' });
    const c = await getAIConfig();
    expect(c.provider).toBe('glm');
    expect(c.providers.deepseek.apiKey).toBe('sk-d');
    expect(c.providers.glm.apiKey).toBe('sk-g');
  });

  test('迁移旧默认模型并将未填Key的GLM切到DeepSeek', async () => {
    store[AI_CONFIG_STORAGE_KEY] = JSON.stringify({ provider: 'glm', providers: {
      glm: { apiKey: '', modelName: 'GLM-5.3-Flash' }, deepseek: { apiKey: '', modelName: 'deepseek-flash' },
    }});
    const c = await getAIConfig();
    expect(c.provider).toBe('deepseek');
    expect(c.modelName).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(c.configVersion).toBe(2);
  });

  test('迁移保留已有Key和手动模型', async () => {
    store[AI_CONFIG_STORAGE_KEY] = JSON.stringify({ provider: 'glm', providers: {
      glm: { apiKey: 'sk-real', modelName: 'glm-custom' }, deepseek: { apiKey: '', modelName: 'deepseek-chat' },
    }});
    const c = await getAIConfig();
    expect(c.provider).toBe('glm'); expect(c.modelName).toBe('glm-custom');
    expect(c.providers.deepseek.modelName).toBe('deepseek-chat');
  });

  test('回归：纯扁平旧配置迁移不丢手动模型和Key', async () => {
    store[AI_CONFIG_STORAGE_KEY] = JSON.stringify({ provider: 'deepseek', apiKey: 'sk-legacy', modelName: 'my-private-model' });
    const c = await getAIConfig();
    expect(c.provider).toBe('deepseek');
    expect(c.apiKey).toBe('sk-legacy');
    expect(c.modelName).toBe('my-private-model');
    expect(c.providers.deepseek.modelName).toBe('my-private-model');
    expect(c.configVersion).toBe(2);
  });

  test('迁移幂等，只首次写回', async () => {
    store[AI_CONFIG_STORAGE_KEY] = JSON.stringify({ provider: 'deepseek', modelName: 'deepseek-chat', apiKey: 'x' });
    const first = await getAIConfig(); const writes = AsyncStorage.setItem.mock.calls.length;
    expect(await getAIConfig()).toEqual(first);
    expect(AsyncStorage.setItem.mock.calls.length).toBe(writes);
  });

  test('识图能力与 fallback', () => {
    expect(modelSupportsVision('deepseek', DEEPSEEK_V41_FLASH_MODEL_ID)).toBe(true);
    expect(modelSupportsVision('deepseek', 'deepseek-chat')).toBe(false);
    expect(modelSupportsVision('glm', 'glm-4v-flash')).toBe(true);
    expect(modelSupportsVision('minimax', 'some-vision-model')).toBe(false);
    expect(getVisionFallbackModel('deepseek', 'deepseek-chat')).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(getVisionFallbackModel('minimax', 'MiniMax M3')).toBeNull();
  });
});
