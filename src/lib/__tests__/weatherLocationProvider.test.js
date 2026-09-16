jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

import * as Location from 'expo-location';
import {
  createWeatherLocationProvider,
  resetLocationPermissionState,
} from '../weatherLocationProvider';

describe('weatherLocationProvider 前台定位服务', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetLocationPermissionState();
    Location.getForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: true,
      status: 'granted',
    });
    Location.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 31.2304, longitude: 121.4737 },
    });
    Location.reverseGeocodeAsync.mockResolvedValue([
      { city: '上海市', subregion: '黄浦区' },
    ]);
  });

  test('权限已授权时成功返回经纬度与城市名', async () => {
    const provider = createWeatherLocationProvider();
    const result = await provider();
    expect(result).toEqual({
      latitude: 31.2304,
      longitude: 121.4737,
      city: '上海市',
    });
    expect(Location.getCurrentPositionAsync).toHaveBeenCalled();
  });

  test('未授权但可询问时，申请权限并成功获取', async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
      status: 'undetermined',
    });
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({
      granted: true,
      status: 'granted',
    });

    const provider = createWeatherLocationProvider();
    const result = await provider();
    expect(result).toEqual(expect.objectContaining({ latitude: 31.2304 }));
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
  });

  test('权限被拒绝后返回 null 并避免在同一会话中重复弹窗', async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
      status: 'undetermined',
    });
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      status: 'denied',
    });

    const provider = createWeatherLocationProvider();
    const result1 = await provider();
    expect(result1).toBeNull();

    // 第二次调用不应再次触发 requestForegroundPermissionsAsync
    const result2 = await provider();
    expect(result2).toBeNull();
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  test('resetLocationPermissionState 后允许再次尝试', async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
      status: 'undetermined',
    });
    Location.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      status: 'denied',
    });

    const provider = createWeatherLocationProvider();
    await provider();
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);

    resetLocationPermissionState();
    await provider();
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
  });

  test('底层抛出异常时安全返回 null 不导致崩溃', async () => {
    Location.getCurrentPositionAsync.mockRejectedValueOnce(new Error('GPS 信号弱'));
    const provider = createWeatherLocationProvider();
    const result = await provider();
    expect(result).toBeNull();
  });
});
