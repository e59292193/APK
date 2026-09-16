// momi 前台定位 Provider：基于 expo-location 提供单次前台设备坐标获取
import * as Location from 'expo-location';

let permissionDeniedInSession = false;

/** 重置会话内的权限拒绝标记（如用户重新在设置页触发） */
export function resetLocationPermissionState() {
  permissionDeniedInSession = false;
}

/**
 * 创建前台天气定位 provider
 * 仅获取前台当前经纬度；若权限未开启或被拒绝，平滑回退，不循环弹权限提示。
 */
export function createWeatherLocationProvider() {
  return async function weatherLocationProvider() {
    // 若在当前会话中已被拒绝，直接返回 null，避免循环弹权限
    if (permissionDeniedInSession) {
      return null;
    }

    try {
      if (typeof Location.getForegroundPermissionsAsync !== 'function') {
        return null;
      }

      let permission = await Location.getForegroundPermissionsAsync();

      if (!permission.granted) {
        if (permission.canAskAgain) {
          permission = await Location.requestForegroundPermissionsAsync();
        }
        if (!permission.granted) {
          permissionDeniedInSession = true;
          console.warn('[weatherLocationProvider] 前台定位权限未授权，将回退手动城市');
          return null;
        }
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy?.Balanced ?? 3,
      });

      if (!position?.coords) return null;

      let cityName = '当前位置';
      try {
        if (typeof Location.reverseGeocodeAsync === 'function') {
          const places = await Location.reverseGeocodeAsync({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          const place = places?.[0];
          if (place) {
            cityName = place.city || place.subregion || place.district || place.name || '当前位置';
          }
        }
      } catch {
        // 逆地理编码失败不影响经纬度使用
      }

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        city: cityName,
      };
    } catch (err) {
      console.warn('[weatherLocationProvider] 获取定位异常:', err.message);
      return null;
    }
  };
}
