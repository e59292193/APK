const store = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => store[key] || null),
  setItem: jest.fn(async (key, value) => { store[key] = value; }),
  clear: jest.fn(async () => {
    Object.keys(store).forEach((k) => delete store[k]);
  }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PROVIDER_OPTIONS,
  PROVIDER_ENDPOINTS,
  DEFAULT_AI_CONFIG,
  getDefaultModel,
  getAIConfig,
  saveAIConfig,
} from '../aiConfig';

describe('aiConfig 大模型配置单元测试', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('预设供应商及端点定义完整', () => {
    const keys = PROVIDER_OPTIONS.map((p) => p.key);
    expect(keys).toContain('minimax');
    expect(keys).toContain('deepseek');
    expect(keys).toContain('glm');

    expect(PROVIDER_ENDPOINTS.minimax).toContain('minimax.chat');
    expect(PROVIDER_ENDPOINTS.deepseek).toContain('deepseek.com');
    expect(PROVIDER_ENDPOINTS.glm).toContain('bigmodel.cn');

    expect(getDefaultModel('minimax')).toBe('MiniMax M3');
    expect(getDefaultModel('deepseek')).toBe('deepseek-flash');
    expect(getDefaultModel('glm')).toBe('GLM-5.3-Flash');
  });

  test('首次读取时返回默认配置', async () => {
    const config = await getAIConfig();
    expect(config.provider).toBe(DEFAULT_AI_CONFIG.provider);
    expect(config.apiKey).toBe('');
    expect(config.modelName).toBe(DEFAULT_AI_CONFIG.modelName);
  });

  test('保存并读取自定义配置', async () => {
    const customConfig = {
      provider: 'deepseek',
      apiKey: 'sk-test-deepseek-123456',
      modelName: 'deepseek-coder',
    };

    const saved = await saveAIConfig(customConfig);
    expect(saved.provider).toBe('deepseek');
    expect(saved.apiKey).toBe('sk-test-deepseek-123456');

    const loaded = await getAIConfig();
    expect(loaded.provider).toBe('deepseek');
    expect(loaded.apiKey).toBe('sk-test-deepseek-123456');
    expect(loaded.modelName).toBe('deepseek-coder');
  });

  test('多厂商 API 配置独立保存不丢失', async () => {
    // 1. 保存 deepseek 配置
    await saveAIConfig({
      provider: 'deepseek',
      apiKey: 'sk-deepseek-key-1',
      modelName: 'deepseek-flash',
    });

    // 2. 保存 glm 配置
    await saveAIConfig({
      provider: 'glm',
      apiKey: 'sk-glm-key-2',
      modelName: 'GLM-5.3-Flash',
    });

    const config = await getAIConfig();
    expect(config.provider).toBe('glm');
    expect(config.apiKey).toBe('sk-glm-key-2');
    expect(config.providers.deepseek.apiKey).toBe('sk-deepseek-key-1');
    expect(config.providers.glm.apiKey).toBe('sk-glm-key-2');
  });
});

