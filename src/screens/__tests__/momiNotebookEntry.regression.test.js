// momi 小本本入口回归测试：顶栏入口隐藏，但路由、设置页入口与长按保存必须完整保留。
// 仓库当前没有 react-native 渲染测试依赖，因此用静态源码契约守住这三条边界，不引入新依赖。
const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '../../..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function componentRoute(source, componentName) {
  const compactSource = source.replace(/\s+/g, ' ');
  const match = compactSource.match(new RegExp(`<${componentName}\\b.*?/>`));
  if (!match) throw new Error(`未找到 ${componentName} 的路由入口`);
  return match[0];
}

const appSource = readSource('App.js');
const assistantSource = readSource('src/screens/MomiAssistantScreen.js');
const settingsSource = readSource('src/screens/MomiAISettingsScreen.js');

describe('momi 小本本入口回归边界', () => {
  test('助手页不再暴露小本本入口', () => {
    const assistantRoute = componentRoute(appSource, 'MomiAssistantScreen');
    const headerButtons =
      assistantSource.match(/styles\.headerButton\b/g) || [];

    expect(assistantRoute).not.toContain('onOpenNotebook');
    expect(assistantSource).not.toContain('onOpenNotebook');
    expect(headerButtons).toHaveLength(1);
    expect(assistantSource).toContain(
      '<TouchableOpacity style={styles.headerButton} onPress={handleOpenSettings}>',
    );
    expect(assistantSource).toContain('<Ionicons name="settings-outline"');
    expect(assistantSource).not.toMatch(
      /name="(?:book|book-outline|journal|journal-outline)"/,
    );
  });

  test('小本本页面、路由与设置页入口仍然保留', () => {
    const notebookRoute = componentRoute(appSource, 'MomiNotebookScreen');
    const settingsRoute = componentRoute(appSource, 'MomiAISettingsScreen');

    expect(appSource).toContain(
      "const MomiNotebookScreen = lazyScreen(() => require('./src/screens/MomiNotebookScreen'));",
    );
    expect(appSource).toContain(
      "{full.screen === 'MomiNotebook' ? <MomiNotebookScreen",
    );
    expect(notebookRoute).toContain(
      "onBack={() => openFullscreen('MomiAssistant')}",
    );
    expect(settingsRoute).toContain(
      "onOpenNotebook={() => openFullscreen('MomiNotebook')}",
    );
    expect(settingsSource).toMatch(
      /export default function MomiAISettingsScreen\(\{[^)]*onOpenNotebook[^)]*\}\)/,
    );
    expect(settingsSource).toMatch(/\{onOpenNotebook\s*\?/);
    expect(settingsSource).toContain('onPress={onOpenNotebook}');
    expect(settingsSource).toContain('momi 的小本本');
  });

  test('助手消息长按写进小本本的链路仍然保留', () => {
    expect(assistantSource).toContain('const rememberText = (item) => {');
    expect(assistantSource).toContain('onLongPress={() => rememberText(item)}');
    expect(assistantSource).toContain('const row = await createManualMemory({');
    expect(assistantSource).toContain("setToast(row ? '已经写进小本本啦 🐾'");
    expect(assistantSource).toContain(
      "import { createManualMemory, runMemoryMaintenance } from '../lib/momiMemory';",
    );
  });
});
