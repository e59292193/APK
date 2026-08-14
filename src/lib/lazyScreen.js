// ═══════════════════════════════════════════════════════
// lazyScreen —— 屏幕级代码延迟求值（启动速度优化）
//
// 问题：App.js 顶部的 import 会被提升，启动时就把所有屏幕模块（聊天、
// 五子棋、你画我猜、旅行手账…，其中多个超过 50KB）全部求值一遂，
// 还连带拉起 svg / 图片处理 / IM 等重依赖，直接拖长白屏时间。
//
// 方案：把 require() 放到 useEffect 里。Metro 的 require 是同步的，但 useEffect
// 在首帧之后才执行，因此：
//   • 启动时只求值首屏真正用到的模块
//   • 未打开过的页面永远不求值
//   • 首次打开时先出现占位骨架（不阻塞手势/动画），下一帧换上真内容
//   • 模块实例缓存在闭包里，第二次打开零延迟（同步直出）
//
// 用法：
//   const ChatScreen = lazyScreen(() => require('./src/screens/ChatScreen'));
//   <ChatScreen {...props} />
// ═══════════════════════════════════════════════════════
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

function ScreenFallback() {
  return (
    <View style={styles.fallback}>
      <ActivityIndicator size="small" color="#8C69CA" />
    </View>
  );
}

export function lazyScreen(loader, Fallback = ScreenFallback) {
  // 模块级缓存：同一个屏幕只求值一次
  let Loaded = null;

  function resolve() {
    const mod = loader();
    return (mod && (mod.default || mod)) || null;
  }

  return function LazyScreen(props) {
    const [, forceRender] = useState(0);
    const mounted = useRef(true);

    useEffect(() => {
      mounted.current = true;
      if (!Loaded) {
        try {
          Loaded = resolve();
        } catch (e) {
          console.warn('[lazyScreen] 模块加载失败', e);
        }
        if (mounted.current) forceRender((n) => n + 1);
      }
      return () => {
        mounted.current = false;
      };
    }, []);

    if (!Loaded) return <Fallback />;
    const Component = Loaded;
    return <Component {...props} />;
  };
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAF9FC',
  },
});

export default lazyScreen;
