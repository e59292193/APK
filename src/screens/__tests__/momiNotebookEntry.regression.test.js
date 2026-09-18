// momi 小本本入口回归测试：
//   1) 助手界面不得再有任何小本本入口（顶栏按钮与气泡长按写入均已删除）
//   2) 小本本页面、路由与设置页入口必须完整保留
// V6 变更：原第三条用例断言「长按写进小本本的链路仍然保留」，与用户报的「小本本入口依然
//          存在」是同一件事，等于把缺陷写成了验收标准，故反转为断言入口已移除。
// 注意：只断言「不存在入口代码」，不断言「文件里不出现小本本三个字」——注释说明为何删除反而应该保留。
// 仓库当前没有 react-native 渲染测试依赖，因此用静态源码契约守住这些边界，不引入新依赖。
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

  test('助手消息长按写进小本本的入口已彻底移除', () => {
    // 长按手势、弹窗、手写写入调用与成功文案全部不再存在
    expect(assistantSource).not.toContain('rememberText');
    expect(assistantSource).not.toContain('onLongPress');
    expect(assistantSource).not.toContain('createManualMemory');
    expect(assistantSource).not.toContain('写进 momi 的小本本？');
    expect(assistantSource).not.toContain('已经写进小本本啦');

    // 记忆模块仍被引用，但仅用于后台维护，不再导入手写写入接口
    expect(assistantSource).toContain(
      "import { runMemoryMaintenance } from '../lib/momiMemory';",
    );
    expect(assistantSource).toContain('runMemoryMaintenance()');
  });
});
