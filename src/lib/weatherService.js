// momi 天气服务：Open-Meteo（无需 API Key）+ 中文天气码 + 30 分钟缓存
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = '@momi_weather:';
const CACHE_MS = 30 * 60 * 1000;
let locationProvider = null;

/** 注入设备定位适配器：async () => ({ latitude, longitude })。未注入时走手动城市。 */
export function setWeatherLocationProvider(provider) {
  locationProvider = provider;
}

export const WEATHER_CODE_ZH = {
  0: '晴', 1: '大致晴朗', 2: '局部多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '较强毛毛雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
  80: '小阵雨', 81: '阵雨', 82: '强阵雨', 85: '小阵雪', 86: '强阵雪',
  95: '雷暴', 96: '雷暴伴小冰雹', 99: '雷暴伴强冰雹',
};

export function weatherCodeToChinese(code) {
  return WEATHER_CODE_ZH[Number(code)] || '未知天气';
}

async function readCache(cacheKey) {
  try {
    const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${cacheKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Date.now() - parsed.savedAt < CACHE_MS ? parsed.value : null;
  } catch {
    return null;
  }
}

async function writeCache(cacheKey, value) {
  await AsyncStorage.setItem(`${CACHE_PREFIX}${cacheKey}`, JSON.stringify({ savedAt: Date.now(), value })).catch(() => {});
}

export async function geocodeCity(city) {
  const name = String(city || '').trim();
  if (!name) return null;
  const cached = await readCache(`geo:${name}`);
  if (cached) return cached;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=zh&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`城市查询失败 (${res.status})`);
  const json = await res.json();
  const first = json.results?.[0];
  if (!first) throw new Error(`没有找到城市“${name}”`);
  const result = {
    latitude: first.latitude,
    longitude: first.longitude,
    city: first.name,
    region: [first.admin1, first.country].filter(Boolean).join(' · '),
  };
  await writeCache(`geo:${name}`, result);
  return result;
}

export async function resolveWeatherCoordinates(settings = {}) {
  if (Number.isFinite(settings.latitude) && Number.isFinite(settings.longitude)) {
    return { latitude: settings.latitude, longitude: settings.longitude, city: settings.city || '当前位置' };
  }
  if (locationProvider) {
    try {
      const coords = await locationProvider();
      if (Number.isFinite(coords?.latitude) && Number.isFinite(coords?.longitude)) {
        return { ...coords, city: coords.city || '当前位置' };
      }
    } catch (err) {
      console.warn('[weatherService] 定位失败，尝试手动城市:', err.message);
    }
  }
  if (settings.city) return geocodeCity(settings.city);
  throw new Error('请在 momi 设置中填写城市，或安装并授权 expo-location');
}

export async function getWeather(settings = {}, { forceRefresh = false } = {}) {
  const coords = await resolveWeatherCoordinates(settings);
  const cacheKey = `forecast:${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)}`;
  if (!forceRefresh) {
    const cached = await readCache(cacheKey);
    if (cached) return cached;
  }
  const params = [
    `latitude=${coords.latitude}`,
    `longitude=${coords.longitude}`,
    'current=temperature_2m,apparent_temperature,weather_code,precipitation',
    'hourly=temperature_2m,precipitation_probability,weather_code',
    'forecast_days=2',
    'timezone=auto',
  ].join('&');
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`天气服务失败 (${res.status})`);
  const json = await res.json();
  const value = {
    location: coords.city,
    region: coords.region || '',
    current: {
      temperature: json.current?.temperature_2m,
      apparentTemperature: json.current?.apparent_temperature,
      precipitation: json.current?.precipitation,
      code: json.current?.weather_code,
      description: weatherCodeToChinese(json.current?.weather_code),
    },
    hourly: (json.hourly?.time || []).map((time, i) => ({
      time,
      temperature: json.hourly.temperature_2m?.[i],
      precipitationProbability: json.hourly.precipitation_probability?.[i] || 0,
      code: json.hourly.weather_code?.[i],
      description: weatherCodeToChinese(json.hourly.weather_code?.[i]),
    })),
    fetchedAt: new Date().toISOString(),
  };
  await writeCache(cacheKey, value);
  return value;
}

/** 未来 3 小时降雨概率>=60%，或 12 小时降温>=6℃时提醒。 */
export function getWeatherAlert(weather, now = new Date()) {
  const future = (weather?.hourly || []).filter((h) => new Date(h.time) >= now).slice(0, 12);
  const next3 = future.slice(0, 3);
  const rain = next3.find((h) => h.precipitationProbability >= 60 || [61, 63, 65, 80, 81, 82, 95, 96, 99].includes(Number(h.code)));
  if (rain) return { key: `rain:${rain.time}`, message: `看天气，${weather.location}接下来可能下雨，出门记得带伞呀 ☔` };
  if (future.length >= 6) {
    const first = Number(future[0].temperature);
    const min = Math.min(...future.map((h) => Number(h.temperature)).filter(Number.isFinite));
    if (Number.isFinite(first) && Number.isFinite(min) && first - min >= 6) {
      return { key: `cooling:${future[0].time.slice(0, 10)}`, message: `今天会明显降温，大约降 ${Math.round(first - min)}℃，记得多穿一点哦 🧥` };
    }
  }
  return null;
}
