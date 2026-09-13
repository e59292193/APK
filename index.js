// 性能打点：记录应用初始化冷启动起始时间戳
if (typeof global !== 'undefined' && !global.__APP_START_TIME__) {
  global.__APP_START_TIME__ = Date.now();
}

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
