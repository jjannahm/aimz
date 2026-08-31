import type { UserRole, UserRow } from "./types";
import { timingSafeEqual } from "node:crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PASSWORD_ITERATIONS = 100_000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

async function derivePassword(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, rawIterations, rawSalt, rawHash] = stored.split("$");
  const iterations = Number(rawIterations);
  if (scheme !== "pbkdf2_sha256" || !Number.isInteger(iterations) || !rawSalt || !rawHash) return false;
  const actual = await derivePassword(password, fromBase64Url(rawSalt), iterations);
  const expected = fromBase64Url(rawHash);
  if (actual.byteLength !== expected.byteLength) return false;
  return timingSafeEqual(actual, expected);
}

export async function hashSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newToken(): string {
  return toBase64Url(randomBytes(32));
}

interface AccessPayload {
  sub: string;
  role: UserRole;
  type: "access";
  exp: number;
  iat: number;
}

async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

export async function createAccessToken(
  userId: string,
  role: UserRole,
  secret: string,
  expiresIn: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload: AccessPayload = { sub: userId, role, type: "access", exp: now + expiresIn, iat: now };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payloadPart, signaturePart] = parts;
  const key = await importHmacKey(secret, ["verify"]);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(signaturePart).buffer,
    encoder.encode(`${header}.${payloadPart}`),
  );
  if (!valid) return null;
  try {
    const value: unknown = JSON.parse(decoder.decode(fromBase64Url(payloadPart)));
    if (!value || typeof value !== "object") return null;
    const payload = value as Partial<AccessPayload>;
    if (
      typeof payload.sub !== "string" ||
      (payload.role !== "admin" && payload.role !== "player" && payload.role !== "parent") ||
      payload.type !== "access" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) return null;
    return payload as AccessPayload;
  } catch {
    return null;
  }
}

interface UploadPayload {
  /** The object key the holder of this token is allowed to write. */
  key: string;
  content_type: string;
  exp: number;
}

/**
 * R2 has no presigned POST of its own, so an upload is authorised by a
 * short-lived token the admin endpoint mints and the upload endpoint checks.
 * It travels in the multipart body, which is where the client already puts the
 * fields an S3 presigned POST hands back.
 */
export async function createUploadToken(
  objectKey: string,
  contentType: string,
  secret: string,
  expiresIn: number,
): Promise<string> {
  const payload: UploadPayload = {
    key: objectKey,
    content_type: contentType,
    exp: Math.floor(Date.now() / 1000) + expiresIn,
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyUploadToken(token: string, secret: string): Promise<UploadPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signaturePart] = parts;
  const key = await importHmacKey(secret, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(signaturePart).buffer, encoder.encode(body));
  if (!valid) return null;
  try {
    const value: unknown = JSON.parse(decoder.decode(fromBase64Url(body)));
    if (!value || typeof value !== "object") return null;
    const payload = value as Partial<UploadPayload>;
    if (
      typeof payload.key !== "string" ||
      typeof payload.content_type !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) return null;
    return payload as UploadPayload;
  } catch {
    return null;
  }
}

export function publicUser(user: UserRow): Record<string, unknown> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    player_id: user.player_id,
    expires_at: user.expires_at ?? null,
    created_at: user.created_at,
  };
}
