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
  DEEPSEEK_V41_FLASH_MODEL_ID,
  AI_CONFIG_STORAGE_KEY,
  getDefaultModel,
  getAIConfig,
  saveAIConfig,
  modelSupportsVision,
  getVisionFallbackModel,
} from '../aiConfig';

describe('aiConfig 大模型配置单元测试', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
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
    expect(getDefaultModel('deepseek')).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(getDefaultModel('glm')).toBe('GLM-5.3-Flash');

    const deepseek = PROVIDER_OPTIONS.find((p) => p.key === 'deepseek');
    expect(deepseek.recommended).toBe(true);
    expect(deepseek.supportsVision).toBe(true);
    expect(deepseek.visionFallbackModel).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(deepseek.suggestedModels[0]).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);

    const minimax = PROVIDER_OPTIONS.find((p) => p.key === 'minimax');
    expect(minimax.supportsVision).toBe(false);
    expect(minimax.visionFallbackModel).toBeNull();

    expect(DEFAULT_AI_CONFIG.provider).toBe('deepseek');
    expect(DEFAULT_AI_CONFIG.modelName).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(DEFAULT_AI_CONFIG.configVersion).toBe(2);
  });

  test('首次读取时返回默认配置（DeepSeek V4.1 Flash）', async () => {
    const config = await getAIConfig();
    expect(config.provider).toBe('deepseek');
    expect(config.apiKey).toBe('');
    expect(config.modelName).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(config.configVersion).toBe(2);
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
    expect(loaded.configVersion).toBe(2);
  });

  test('多厂商 API 配置独立保存不丢失', async () => {
    await saveAIConfig({
      provider: 'deepseek',
      apiKey: 'sk-deepseek-key-1',
      modelName: DEEPSEEK_V41_FLASH_MODEL_ID,
    });

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

  // ── v1 -> v2 存量迁移 ─────────────────────────────────

  test('迁移：旧默认 deepseek-flash 升级为 V4.1 Flash，未填 Key 的 GLM 用户切到 DeepSeek', async () => {
    // 模拟提示词3时代的存量配置（无 configVersion）
    store[AI_CONFIG_STORAGE_KEY] = JSON.stringify({
      provider: 'glm',
      apiKey: '',
      modelName: 'GLM-5.3-Flash',
      providers: {
        glm: { apiKey: '', modelName: 'GLM-5.3-Flash' },
        deepseek: { apiKey: '', modelName: 'deepseek-flash' },
        minimax: { apiKey: '', modelName: 'MiniMax M3' },
      },
    });

    const config = await getAIConfig();
    expect(config.provider).toBe('deepseek');
    expect(config.modelName).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(config.providers.deepseek.modelName).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    expect(config.configVersion).toBe(2);
  });

  test('迁移：GLM 已填 Key 的用户不被切换 provider', async () => {
    store[AI_CONFIG_STORAGE_KEY] = JSON.stringify({
      provider: 'glm',
      providers: {
        glm: { apiKey: 'sk-glm-real-key', modelName: 'GLM-5.3-Flash' },
        deepseek: { apiKey: '', modelName: 'deepseek-flash' },
      },
    });

    const config = await getAIConfig();
    expect(config.provider).toBe('glm');
    expect(config.apiKey).toBe('sk-glm-real-key');
    // deepseek 旧默认模型仍按规则 a 升级
    expect(config.providers.deepseek.modelName).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
  });

  test('迁移：用户手动改过的模型名不被覆盖', async () => {
    store[AI_CONFIG_STORAGE_KEY] = JSON.stringify({
      provider: 'deepseek',
      providers: {
        deepseek: { apiKey: 'sk-x', modelName: 'deepseek-chat' },
        glm: { apiKey: '', modelName: 'GLM-5.3-Flash' },
      },
    });

    const config = await getAIConfig();
    expect(config.provider).toBe('deepseek');
    expect(config.modelName).toBe('deepseek-chat');
    expect(config.configVersion).toBe(2);
  });

  test('迁移幂等：多次读取结果一致，且只在首次写回', async () => {
    store[AI_CONFIG_STORAGE_KEY] = JSON.stringify({
      provider: 'glm',
      providers: {
        glm: { apiKey: '', modelName: 'GLM-5.3-Flash' },
        deepseek: { apiKey: '', modelName: 'deepseek-flash' },
      },
    });

    const first = await getAIConfig();
    const writesAfterFirst = AsyncStorage.setItem.mock.calls.length;

    const second = await getAIConfig();
    const third = await getAIConfig();

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // 第一次触发迁移写回，后续读取不再写入
    expect(writesAfterFirst).toBeGreaterThan(0);
    expect(AsyncStorage.setItem.mock.calls.length).toBe(writesAfterFirst);
  });

  // ── 识图能力判定 ──────────────────────────────────────

  test('modelSupportsVision 正则判定', () => {
    expect(modelSupportsVision('deepseek', DEEPSEEK_V41_FLASH_MODEL_ID)).toBe(true);
    expect(modelSupportsVision('deepseek', 'deepseek-chat')).toBe(false);
    expect(modelSupportsVision('deepseek', 'deepseek-reasoner')).toBe(false);
    expect(modelSupportsVision('glm', 'glm-4v-flash')).toBe(true);
    expect(modelSupportsVision('glm', 'GLM-5.3-Flash')).toBe(false);
    expect(modelSupportsVision('minimax', 'MiniMax M3')).toBe(false);
    expect(modelSupportsVision('minimax', 'some-vision-model')).toBe(false); // provider 级否决
    expect(modelSupportsVision('deepseek', '')).toBe(false);
  });

  test('getVisionFallbackModel 仅在可降级时返回', () => {
    // deepseek 当前模型不支持识图时，可降级到 V4.1 Flash
    expect(getVisionFallbackModel('deepseek', 'deepseek-chat')).toBe(DEEPSEEK_V41_FLASH_MODEL_ID);
    // 当前已是降级模型本身时不再降级
    expect(getVisionFallbackModel('deepseek', DEEPSEEK_V41_FLASH_MODEL_ID)).toBeNull();
    // glm 可降级到 glm-4v-flash
    expect(getVisionFallbackModel('glm', 'GLM-5.3-Flash')).toBe('glm-4v-flash');
    // minimax 无视觉模型
    expect(getVisionFallbackModel('minimax', 'MiniMax M3')).toBeNull();
  });
});
