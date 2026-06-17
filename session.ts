import crypto from "node:crypto";

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production");
    }
    return "dev-session-secret-not-for-production";
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(googleUserId: string): string {
  const secret = getSecret();
  const payload = JSON.stringify({
    sub: googleUserId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, // 30 days
  });
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = sign(encoded, secret);
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token: string): string | null {
  const secret = getSecret();
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;
  const expected = sign(encoded, secret);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // expired
    }
    return payload.sub || null;
  } catch {
    return null;
  }
}

// CSRF state token for OAuth flow
export function createOAuthState(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function verifyOAuthState(state: string, expected: string): boolean {
  if (!state || !expected || state.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected));
}
