// momi 天气服务：Open-Meteo（无需 API Key）+ 中文天气码 + 30 分钟缓存
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = '@momi_weather:';
const CACHE_MS = 30 * 60 * 1000;
const OPEN_METEO_GEOCODING = 'https:' + '//geocoding-api.open-meteo.com/v1/search';
const OPEN_METEO_FORECAST = 'https:' + '//api.open-meteo.com/v1/forecast';
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
  const url = `${OPEN_METEO_GEOCODING}?name=${encodeURIComponent(name)}&count=5&language=zh&format=json`;
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
    'daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max',
    'forecast_days=2',
    'timezone=auto',
  ].join('&');
  const res = await fetch(`${OPEN_METEO_FORECAST}?${params}`);
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
    daily: {
      temperatureMax: json.daily?.temperature_2m_max || [],
      temperatureMin: json.daily?.temperature_2m_min || [],
      code: json.daily?.weather_code || [],
      precipitationProbabilityMax: json.daily?.precipitation_probability_max || [],
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

/**
 * momi 专用天气数据聚合接口
 * 超时上限 8 秒，失败时明确区分 reason: no_city | no_permission | network | api_error
 */
export async function getWeatherForMomi({ userId } = {}) {
  try {
    const { getEffectiveProactiveSettings } = require('./momiProactiveSettings');
    const settings = await getEffectiveProactiveSettings(userId);

    const hasCoords = Number.isFinite(settings?.latitude) && Number.isFinite(settings?.longitude);
    const hasCity = Boolean(settings?.city && settings.city !== '当前位置');

    if (!hasCoords && !hasCity && !locationProvider) {
      return { error: 'WEATHER_UNAVAILABLE', reason: 'no_city' };
    }

    // 8 秒超时保护
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('TIMEOUT')), 8000);
    });

    const weatherPromise = getWeather(settings).finally(() => {
      clearTimeout(timeoutId);
    });

    const data = await Promise.race([weatherPromise, timeoutPromise]);

    const currentTemp = data.current?.temperature != null ? Math.round(data.current.temperature) : '--';
    const feelsLike = data.current?.apparentTemperature != null ? Math.round(data.current.apparentTemperature) : currentTemp;
    const currentDesc = data.current?.description || '晴';

    let todayMin = data.daily?.temperatureMin?.[0];
    let todayMax = data.daily?.temperatureMax?.[0];
    let todayDesc = weatherCodeToChinese(data.daily?.code?.[0]) || currentDesc;
    let todayRainProb = data.daily?.precipitationProbabilityMax?.[0] || 0;

    let tomorrowMin = data.daily?.temperatureMin?.[1];
    let tomorrowMax = data.daily?.temperatureMax?.[1];
    let tomorrowDesc = weatherCodeToChinese(data.daily?.code?.[1]) || '多云';
    let tomorrowRainProb = data.daily?.precipitationProbabilityMax?.[1] || 0;

    // 兜底：若 daily 缺失，从 hourly 聚合
    if (todayMin == null && data.hourly?.length) {
      const todayHourly = data.hourly.slice(0, 24);
      const temps = todayHourly.map((h) => h.temperature).filter(Number.isFinite);
      if (temps.length) {
        todayMin = Math.min(...temps);
        todayMax = Math.max(...temps);
      }
      const rains = todayHourly.map((h) => h.precipitationProbability).filter(Number.isFinite);
      if (rains.length) todayRainProb = Math.max(...rains);
    }
    if (tomorrowMin == null && data.hourly?.length > 24) {
      const tomorrowHourly = data.hourly.slice(24, 48);
      const temps = tomorrowHourly.map((h) => h.temperature).filter(Number.isFinite);
      if (temps.length) {
        tomorrowMin = Math.min(...temps);
        tomorrowMax = Math.max(...temps);
      }
      const rains = tomorrowHourly.map((h) => h.precipitationProbability).filter(Number.isFinite);
      if (rains.length) tomorrowRainProb = Math.max(...rains);
    }

    let advice = '体感舒适，适合出门走走或在窗边喝杯热茶 🐾';
    if (todayRainProb >= 60 || /雨|雷/.test(currentDesc) || /雨|雷/.test(todayDesc)) {
      advice = '今天有降雨可能，出门请带好雨伞，注意路滑 ☔';
    } else if (Number.isFinite(Number(currentTemp)) && Number(currentTemp) <= 8) {
      advice = '气温较低，出门记得穿厚外套，注意防寒保暖 🧣';
    } else if (Number.isFinite(Number(currentTemp)) && Number(currentTemp) >= 30) {
      advice = '天气比较炎热，外出请做好防晒，多补充水分 🥤';
    } else if (todayMax != null && todayMin != null && todayMax - todayMin >= 8) {
      advice = '早晚温差较大，建议随身备一件薄外套，避免着凉 🧥';
    }

    return {
      location: data.location || '当前位置',
      updatedAt: data.fetchedAt || new Date().toISOString(),
      current: {
        temp: currentTemp,
        feelsLike,
        desc: currentDesc,
      },
      today: {
        min: todayMin != null ? Math.round(todayMin) : '--',
        max: todayMax != null ? Math.round(todayMax) : '--',
        desc: todayDesc,
        rainProb: todayRainProb,
      },
      tomorrow: {
        min: tomorrowMin != null ? Math.round(tomorrowMin) : '--',
        max: tomorrowMax != null ? Math.round(tomorrowMax) : '--',
        desc: tomorrowDesc,
        rainProb: tomorrowRainProb,
      },
      advice,
    };
  } catch (err) {
    console.warn('[weatherService] getWeatherForMomi 失败:', err.message);
    const msg = String(err.message || '').toLowerCase();
    let reason = 'api_error';
    if (msg.includes('city') || msg.includes('城市')) {
      reason = 'no_city';
    } else if (msg.includes('permission') || msg.includes('授权') || msg.includes('定位')) {
      reason = 'no_permission';
    } else if (msg.includes('timeout') || msg.includes('network') || msg.includes('fetch') || msg.includes('超时')) {
      reason = 'network';
    }
    return { error: 'WEATHER_UNAVAILABLE', reason };
  }
}

/** 未来 3 小时降雨概率>=60%，或 12 小时降温>=6℃时提醒。 */
export function getWeatherAlert(weather, now = new Date()) {
  const future = (weather?.hourly || []).filter((h) => new Date(h.time) >= now).slice(0, 12);
  const next3 = future.slice(0, 3);
  const rain = next3.find((h) => h.precipitationProbability >= 60 || [61, 63, 65, 80, 81, 82, 95, 96, 99].includes(Number(h.code)));
  if (rain) return { key: `rain:${rain.time}`, message: `看天气，${weather.location}接下来可能下雨，出门记得带伞呀 ☔` };
  if (future.length >= 6) {
    const first = Number(future[0].temperature);
    const temps = future.map((h) => Number(h.temperature)).filter(Number.isFinite);
    const min = temps.length ? Math.min(...temps) : first;
    if (Number.isFinite(first) && Number.isFinite(min) && first - min >= 6) {
      return { key: `cooling:${future[0].time.slice(0, 10)}`, message: `今天会明显降温，大约降 ${Math.round(first - min)}℃，记得多穿一点哦 🧥` };
    }
  }
  return null;
}
