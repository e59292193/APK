jest.mock('../supabase', () => ({ supabase: {} }));

import { normalizeToPhotosPath } from '../mediaResolver';

const BASE = 'https://kotakqdxwvienrmbcrnk.supabase.co';

describe('mediaResolver 路径归一化', () => {
  test('bucket 路径原样返回（去 query）', () => {
    expect(normalizeToPhotosPath('uploads/photo_1.jpg')).toBe('uploads/photo_1.jpg');
    expect(normalizeToPhotosPath('drawguess/dg_1_r2_3.png?x=1')).toBe('drawguess/dg_1_r2_3.png');
  });

  test('旧公开 URL 转为路径', () => {
    expect(
      normalizeToPhotosPath(`${BASE}/storage/v1/object/public/photos/uploads/a.jpg`)
    ).toBe('uploads/a.jpg');
  });

  test('旧签名 / authenticated URL 转为路径并剥离 query', () => {
    expect(
      normalizeToPhotosPath(`${BASE}/storage/v1/object/sign/photos/uploads/b.jpg?token=secret`)
    ).toBe('uploads/b.jpg');
    expect(
      normalizeToPhotosPath(`${BASE}/storage/v1/object/authenticated/photos/c.jpg`)
    ).toBe('c.jpg');
  });

  test('外链与 data URI 不处理（返回 null 由调用方原样使用）', () => {
    expect(normalizeToPhotosPath('https://example.com/x.jpg')).toBeNull();
    expect(normalizeToPhotosPath('data:image/png;base64,xxx')).toBeNull();
  });

  test('空值安全', () => {
    expect(normalizeToPhotosPath(null)).toBeNull();
    expect(normalizeToPhotosPath('')).toBeNull();
    expect(normalizeToPhotosPath(undefined)).toBeNull();
  });
});
