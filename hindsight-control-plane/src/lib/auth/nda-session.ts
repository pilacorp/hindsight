/**
 * Encrypted, request-scoped session for the NDA multi-user Control Plane.
 *
 * The session carries the caller's API key so each request authenticates to the
 * dataplane as that user or admin — there is no fixed server-side credential.
 * The cookie is encrypted with AES-256-GCM under HINDSIGHT_CP_SESSION_SECRET
 * (key = SHA-256 of the secret), so the key never leaves the server in a form
 * a browser or a tamperer can read. Uses Web Crypto, so it runs in both the
 * edge middleware and route handlers.
 */

export const SESSION_COOKIE = "hindsight_cp_session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export type SessionKind = "user" | "admin";

export interface SessionData {
  kind: SessionKind;
  handle: string | null; // user handle for a user session; null for admin
  apiKey: string;
  iat: number; // issued-at, unix seconds
}

const IV_BYTES = 12;

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSession(
  data: Omit<SessionData, "iat"> & { iat?: number },
  secret: string
): Promise<string> {
  if (!secret) throw new Error("session secret is required");
  const payload: SessionData = { ...data, iat: data.iat ?? Math.floor(Date.now() / 1000) };
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
  );
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, iv.length);
  return base64UrlEncode(out);
}

export async function decryptSession(
  token: string | undefined,
  secret: string
): Promise<SessionData | null> {
  if (!token || !secret) return null;
  try {
    const raw = base64UrlDecode(token);
    if (raw.length <= IV_BYTES) return null;
    const iv = raw.slice(0, IV_BYTES);
    const ciphertext = raw.slice(IV_BYTES);
    const key = await deriveKey(secret);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const data = JSON.parse(new TextDecoder().decode(plaintext)) as SessionData;
    if (data == null || typeof data.iat !== "number") return null;
    if (data.kind !== "user" && data.kind !== "admin") return null;
    if (typeof data.apiKey !== "string" || data.apiKey.length === 0) return null;
    const now = Math.floor(Date.now() / 1000);
    if (now - data.iat > SESSION_MAX_AGE_SECONDS) return null;
    return data;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
