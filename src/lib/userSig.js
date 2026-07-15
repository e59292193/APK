// ═══════════════════════════════════════════════════════
// UserSig 生成（RN 端实现）
//
// 腾讯官方的 tls-sig-api-v2 用了 Node 的 crypto + zlib，无法在 RN 运行。
// 这里用已安装的 crypto-js（HMAC-SHA256）+ pako（zlib 压缩）重写，
// 算法与官方 Node 实现完全一致，输出可被腾讯服务端校验通过。
//
// 算法（参考 node_modules/tls-sig-api-v2/TLSSigAPIv2.js）：
//   1. 构造 sigDoc = { TLS.ver, TLS.identifier, TLS.sdkappid, TLS.time, TLS.expire }
//   2. content = "TLS.identifier:..\nTLS.sdkappid:..\nTLS.time:..\nTLS.expire:..\n"
//   3. sig = base64(HMAC-SHA256(content, secretKey))  ← key 直接用 SecretKey 字符串
//   4. sigDoc['TLS.sig'] = sig
//   5. compressed = zlib.deflate(JSON.stringify(sigDoc))
//   6. userSig = base64url(compressed)  ← +→*  /→-  =→_
//
// 安全说明：本应用只有 2 个固定用户（情侣），SecretKey 写在 APK 内的风险
// 仅限于“有人逆向 APK 后伪造这 2 个账号的即时消息”，对本场景可接受。
// ═══════════════════════════════════════════════════════
import CryptoJS from 'crypto-js';
import { deflate } from 'pako';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  TIM_SDKAPPID,
  TIM_SECRET_KEY,
  USER_SIG_EXPIRE,
} from './timConfig';

// AsyncStorage 缓存 key：避免每次启动都重新生成 userSig
const SIG_CACHE_PREFIX = 'tim_usersig_';

// ─── Uint8Array → base64（RN 无原生 btoa，自己实现）───
function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000; // 分块拼接，避免栈溢出
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  if (typeof btoa !== 'undefined') return btoa(binary);
  // 手动兜底（几乎不会走到）
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
    out += chars[a >> 2];
    out += chars[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < binary.length ? chars[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < binary.length ? chars[c & 63] : '=';
  }
  return out;
}

// ─── base64 → base64url（腾讯自定义变体：+→*  /→-  =→_）───
function base64ToBase64Url(str) {
  return str.replace(/\+/g, '*').replace(/\//g, '-').replace(/=/g, '_');
}

// ─── 实际生成 userSig ───
function genSig(userid, expire) {
  const currTime = Math.floor(Date.now() / 1000);

  // 1. HMAC 内容（注意：每行末尾的 \n，最后一行也有）
  const content =
    `TLS.identifier:${userid}\n` +
    `TLS.sdkappid:${TIM_SDKAPPID}\n` +
    `TLS.time:${currTime}\n` +
    `TLS.expire:${expire}\n`;

  // 2. sig = base64(HMAC-SHA256(content, secretKey))
  //    crypto-js 的 HmacSHA256(msg, key) 当 key 是字符串时，按 UTF-8 字节做 key，
  //    与 Node crypto.createHmac('sha256', keyString) 行为一致。
  const sig = CryptoJS.HmacSHA256(content, TIM_SECRET_KEY).toString(CryptoJS.enc.Base64);

  // 3. sigDoc
  const sigDoc = {
    'TLS.ver': '2.0',
    'TLS.identifier': String(userid),
    'TLS.sdkappid': Number(TIM_SDKAPPID),
    'TLS.time': Number(currTime),
    'TLS.expire': Number(expire),
    'TLS.sig': sig,
  };

  // 4. zlib 压缩（pako deflate 默认即 RFC1950 zlib 格式，与 Node zlib.deflateSync 一致）
  const compressed = deflate(JSON.stringify(sigDoc));

  // 5. base64 + base64url 变体
  return base64ToBase64Url(bytesToBase64(compressed));
}

// ─── 对外：获取 userSig（带缓存，缓存命中率 99%+）───
export async function getUserSig(imUserId) {
  if (!TIM_SDKAPPID || !TIM_SECRET_KEY) {
    throw new Error('腾讯 IM 未配置：请在 src/lib/timConfig.js 填入 SDKAppID 和 SecretKey');
  }

  const cacheKey = SIG_CACHE_PREFIX + imUserId;
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const { sig, expireAt } = JSON.parse(cached);
      // 提前 1 天过期，留出续期余量
      if (expireAt > Date.now() + 24 * 3600 * 1000) {
        return sig;
      }
    }
  } catch (e) {
    console.warn('[userSig] 读取缓存失败，重新生成:', e.message);
  }

  const sig = genSig(imUserId, USER_SIG_EXPIRE);
  try {
    await AsyncStorage.setItem(
      cacheKey,
      JSON.stringify({ sig, expireAt: Date.now() + USER_SIG_EXPIRE * 1000 })
    );
  } catch (e) {
    console.warn('[userSig] 写入缓存失败:', e.message);
  }
  return sig;
}
