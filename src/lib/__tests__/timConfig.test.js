import { toIMUserID, toAppUserID, getPartnerAppId } from '../timConfig';

describe('timConfig 身份映射', () => {
  test('App 昵称 ↔ IM userID 双向映射', () => {
    expect(toIMUserID('momo')).toBe('momo');
    expect(toIMUserID('苞米')).toBe('baomi');
    expect(toAppUserID('momo')).toBe('momo');
    expect(toAppUserID('baomi')).toBe('苞米');
  });

  test('未知身份原样返回', () => {
    expect(toIMUserID('someone')).toBe('someone');
    expect(toAppUserID('someone')).toBe('someone');
  });

  test('取对方身份', () => {
    expect(getPartnerAppId('momo')).toBe('苞米');
    expect(getPartnerAppId('苞米')).toBe('momo');
    expect(getPartnerAppId('intruder')).toBe('');
  });
});
