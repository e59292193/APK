// 屏幕级按需加载。
//
// loader 只在该页面第一次真正参与渲染时执行，因此未访问页面不会增加启动阶段
// 的模块求值开销；成功后缓存在闭包中，之后直接渲染。
//
// 不能把 Metro require() 放进 useEffect 再用本地 state 补一次渲染：部分 Android
// release 环境会先提交空的全屏覆盖层，而模块解析异常又被吞掉，最终表现为点击入口
// 后仍看到聊天页或残缺控件。这里在首次导航的 render 中同步解析，让目标页面与覆盖层
// 在同一次提交中挂载；异常则抛给外层 ErrorBoundary，而不是永久显示空壳。
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

function ScreenFallback() {
  return (
    <View style={styles.fallback}>
      <ActivityIndicator size="small" color="#8C69CA" />
    </View>
  );
}

export function lazyScreen(loader, Fallback = ScreenFallback) {
  let Loaded = null;
  let loadError = null;

  function resolve() {
    if (Loaded || loadError) return;
    try {
      const mod = loader();
      Loaded = (mod && (mod.default || mod)) || null;
      if (!Loaded) {
        loadError = new Error('页面模块没有可渲染的默认导出');
      }
    } catch (error) {
      loadError = error instanceof Error ? error : new Error(String(error));
    }
  }

  function LazyScreen(props) {
    resolve();
    if (loadError) throw loadError;
    if (!Loaded) return <Fallback />;
    const Component = Loaded;
    return <Component {...props} />;
  }

  LazyScreen.displayName = 'LazyScreen';
  return LazyScreen;
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAF9FC',
  },
});

export default lazyScreen;
