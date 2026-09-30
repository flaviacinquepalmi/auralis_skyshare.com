import { createHash } from "node:crypto";
import { env } from "../config/env";

const CACHE_LIMIT = 500;
const verifiedEmailCache = new Map<string, { email: string; expiresAt: number }>();
const pendingLookups = new Map<string, Promise<string | null>>();

function normalizedVerifiedEmail(profile: { sub?: unknown; email?: unknown; email_verified?: unknown }, sub: string) {
  if (profile.sub !== sub || profile.email_verified !== true || typeof profile.email !== "string") return null;
  const email = profile.email.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// Call only after requireAuth validates the access token. Never trust body/query email.
export async function verifiedIdentityEmail(authorization: string, sub: string, claims?: Record<string, unknown>): Promise<string | null> {
  if (claims) {
    const claimed = normalizedVerifiedEmail(claims, sub);
    if (claimed) return claimed;
  }
  if (!/^Bearer\s+\S+$/i.test(authorization)) return null;
  // Cache a digest, never the bearer token, and isolate it by verified subject.
  const key = createHash("sha256").update(`${sub}\n${authorization}`).digest("hex");
  const cached = verifiedEmailCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.email;
  verifiedEmailCache.delete(key);
  const pending = pendingLookups.get(key);
  if (pending) return pending;
  if (pendingLookups.size >= CACHE_LIMIT) throw new Error("Verifica identità temporaneamente occupata");
  const request = (async () => {
    const issuer = new URL(env.auth0IssuerBaseUrl.replace(/\/?$/, "/"));
    if (issuer.protocol !== "https:" || issuer.username || issuer.password) throw new Error("Issuer Auth0 non valido");
    const response = await fetch(new URL("userinfo", issuer), {
      headers: { Authorization: authorization }, signal: AbortSignal.timeout(8000), redirect: "error",
    });
    if (!response.ok) throw new Error("Auth0 userinfo non disponibile");
    const profile = await response.json() as { sub?: unknown; email?: unknown; email_verified?: unknown };
    const email = normalizedVerifiedEmail(profile, sub);
    if (email) {
      if (verifiedEmailCache.size >= CACHE_LIMIT) verifiedEmailCache.delete(verifiedEmailCache.keys().next().value!);
      verifiedEmailCache.set(key, { email, expiresAt: Date.now() + 60_000 });
    }
    return email;
  })();
  pendingLookups.set(key, request);
  try { return await request; } finally { pendingLookups.delete(key); }
}

export function isPlaceholderEmail(email: string) {
  return email.endsWith("@placeholder.local");
}
