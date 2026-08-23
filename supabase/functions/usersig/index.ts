// ═══════════════════════════════════════════════════════
// UserSig 签发 Edge Function（腾讯云 IM）
//
// 部署：supabase functions deploy usersig
// 密钥：supabase secrets set TIM_SECRET_KEY=<64位密钥> TIM_SDKAPPID=<数字>
//
// 安全模型：
//   1. 只接受携带有效 Supabase Auth JWT 的请求（Authorization: Bearer）。
//   2. 从 profiles 表推导调用者的 App 身份（momo / 苞米），
//      不接受客户端随意指定他人 userID。
//   3. 签名有效期 24 小时，客户端缓存并自动续期。
// ═══════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPIRE_SECONDS = 24 * 3600;

const APP_TO_IM: Record<string, string> = {
  "momo": "momo",
  "苞米": "baomi",
};

function b64encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBase64Url(str: string): string {
  return str.replace(/\+/g, "*").replace(/\//g, "-").replace(/=/g, "_");
}

async function hmacSha256Base64(secret: string, content: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(content));
  return b64encode(new Uint8Array(sig));
}

// 腾讯 UserSig v2：zlib(RFC1950) 压缩 —— CompressionStream("deflate") 即该格式
async function zlibDeflate(data: string): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function genUserSig(sdkAppId: number, secretKey: string, identifier: string): Promise<string> {
  const currTime = Math.floor(Date.now() / 1000);
  const content =
    `TLS.identifier:${identifier}\n` +
    `TLS.sdkappid:${sdkAppId}\n` +
    `TLS.time:${currTime}\n` +
    `TLS.expire:${EXPIRE_SECONDS}\n`;

  const sig = await hmacSha256Base64(secretKey, content);
  const sigDoc = {
    "TLS.ver": "2.0",
    "TLS.identifier": identifier,
    "TLS.sdkappid": sdkAppId,
    "TLS.time": currTime,
    "TLS.expire": EXPIRE_SECONDS,
    "TLS.sig": sig,
  };
  const compressed = await zlibDeflate(JSON.stringify(sigDoc));
  return base64ToBase64Url(b64encode(compressed));
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const secretKey = Deno.env.get("TIM_SECRET_KEY");
  const sdkAppId = Number(Deno.env.get("TIM_SDKAPPID"));
  if (!secretKey || !sdkAppId) {
    return json({ error: "UserSig 服务未配置（缺 TIM_SECRET_KEY / TIM_SDKAPPID）" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "unauthorized" }, 401);

  // 从 profiles 推导身份；迁移前回退 user_metadata
  let appUsername: string | null = null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("auth_uid", userData.user.id)
    .maybeSingle();
  if (profile?.username && profile.username in APP_TO_IM) {
    appUsername = profile.username;
  } else {
    const meta = userData.user.user_metadata?.app_username;
    if (typeof meta === "string" && meta in APP_TO_IM) appUsername = meta;
  }
  if (!appUsername) return json({ error: "该账号未绑定 App 身份" }, 403);

  const imUserId = APP_TO_IM[appUsername];
  const userSig = await genUserSig(sdkAppId, secretKey, imUserId);

  return json({
    userId: imUserId,
    userSig,
    expireAt: Date.now() + EXPIRE_SECONDS * 1000,
  });
});
