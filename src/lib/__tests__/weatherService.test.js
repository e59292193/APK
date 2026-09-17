jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => null),
}));

import { weatherCodeToChinese, getWeatherAlert } from '../weatherService';

describe('weatherService', () => {
  test('WMO 天气码转中文', () => {
    expect(weatherCodeToChinese(0)).toBe('晴');
    expect(weatherCodeToChinese(65)).toBe('大雨');
    expect(weatherCodeToChinese(95)).toBe('雷暴');
    expect(weatherCodeToChinese(999)).toBe('未知天气');
  });

  test('未来三小时降雨触发带伞提醒', () => {
    const now = new Date('2026-09-15T10:00:00');
    const alert = getWeatherAlert({
      location: '上海',
      hourly: [
        { time: '2026-09-15T10:00:00', temperature: 28, precipitationProbability: 10, code: 2 },
        { time: '2026-09-15T11:00:00', temperature: 27, precipitationProbability: 70, code: 61 },
      ],
    }, now);
    expect(alert.key).toContain('rain:');
    expect(alert.message).toContain('带伞');
  });

  test('12 小时降温 >=6℃ 触发添衣提醒', () => {
    const now = new Date('2026-09-15T10:00:00');
    const hourly = Array.from({ length: 8 }, (_, i) => ({
      time: `2026-09-15T${String(10 + i).padStart(2, '0')}:00:00`,
      temperature: 25 - i,
      precipitationProbability: 0,
      code: 2,
    }));
    const alert = getWeatherAlert({ location: '上海', hourly }, now);
    expect(alert.key).toContain('cooling:');
    expect(alert.message).toContain('多穿');
  });

  test('天气平稳时不提醒', () => {
    const now = new Date('2026-09-15T10:00:00');
    const hourly = Array.from({ length: 8 }, (_, i) => ({
      time: `2026-09-15T${String(10 + i).padStart(2, '0')}:00:00`,
      temperature: 25,
      precipitationProbability: 10,
      code: 1,
    }));
    expect(getWeatherAlert({ location: '上海', hourly }, now)).toBeNull();
  });
});
