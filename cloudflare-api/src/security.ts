import type { UserRead } from "../../mobile/src/types/contract";
import type { UserRole, UserRow } from "./types";
import { timingSafeEqual } from "node:crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * How much work a stolen hash costs to guess against.
 *
 * OWASP asks 600,000 rounds of PBKDF2-HMAC-SHA256. Cloudflare's production
 * runtime refuses any one PBKDF2 call above 100,000 — and local workerd does not
 * enforce that ceiling, so no test run here would notice a larger count — so the
 * work is done in stages of 100,000, each stage's output the next stage's key. A
 * guess has to pay for every round of every stage; none can be skipped.
 *
 * Hashes made before the stages (`pbkdf2_sha256$100000$…`) still verify, and are
 * rewritten in the staged form at their account's next successful sign-in.
 */
export const PBKDF2_ROUNDS_PER_CALL = 100_000;
const PASSWORD_STAGES = 6;
const STAGED_SCHEME = "pbkdf2_sha256_staged";
const STAGED_WORK = `${PASSWORD_STAGES}x${PBKDF2_ROUNDS_PER_CALL}`;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
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

async function pbkdf2(secret: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", secret, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function stagedDerive(password: string, salt: Uint8Array<ArrayBuffer>, stages: number): Promise<Uint8Array<ArrayBuffer>> {
  let derived: Uint8Array<ArrayBuffer> = encoder.encode(password);
  for (let stage = 0; stage < stages; stage += 1) derived = await pbkdf2(derived, salt, PBKDF2_ROUNDS_PER_CALL);
  return derived;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await stagedDerive(password, salt, PASSWORD_STAGES);
  return `${STAGED_SCHEME}$${STAGED_WORK}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, work, rawSalt, rawHash] = stored.split("$");
  if (!rawSalt || !rawHash) return false;
  let actual: Uint8Array<ArrayBuffer>;
  if (scheme === STAGED_SCHEME) {
    const [stages, rounds] = (work ?? "").split("x").map(Number);
    if (!Number.isInteger(stages) || stages < 1 || stages > 2 * PASSWORD_STAGES || rounds !== PBKDF2_ROUNDS_PER_CALL) return false;
    actual = await stagedDerive(password, fromBase64Url(rawSalt), stages);
  } else if (scheme === "pbkdf2_sha256") {
    // A single call, so a count the production runtime would refuse is refused
    // here instead of failing the sign-in with a server error.
    const iterations = Number(work);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ROUNDS_PER_CALL) return false;
    actual = await pbkdf2(encoder.encode(password), fromBase64Url(rawSalt), iterations);
  } else {
    return false;
  }
  const expected = fromBase64Url(rawHash);
  if (actual.byteLength !== expected.byteLength) return false;
  return timingSafeEqual(actual, expected);
}

export function passwordNeedsRehash(stored: string): boolean {
  const [scheme, work] = stored.split("$");
  return scheme !== STAGED_SCHEME || work !== STAGED_WORK;
}

let decoyHash: Promise<string> | undefined;

/**
 * A hash nobody knows the password to, for signing in to an account that does
 * not exist.
 *
 * Verifying against it costs the same configured work as a real
 * account, so a missing email is refused in the time a wrong password would
 * be, and the response time cannot be used to find out who has an account.
 */
export function decoyPasswordHash(): Promise<string> {
  decoyHash ??= hashPassword(newToken());
  return decoyHash;
}

export async function hashSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newToken(): string {
  return toBase64Url(randomBytes(32));
}

export interface AccessPayload {
  sub: string;
  sid: string;
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

/**
 * The roles a token may carry, as a set rather than a chain of comparisons:
 * a role added to the schema and forgotten here signs in and is then refused
 * on every request, which reads as a broken account rather than a missing case.
 */
const ROLES = new Set<string>(["admin", "player", "parent", "coach"]);

export async function createAccessToken(
  userId: string,
  role: UserRole,
  sessionFamilyId: string,
  secret: string,
  expiresIn: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload: AccessPayload = { sub: userId, sid: sessionFamilyId, role, type: "access", exp: now + expiresIn, iat: now };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessPayload | null> {
  try {
    if (token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !part || !/^[A-Za-z0-9_-]+$/u.test(part))) return null;
    const [headerPart, payloadPart, signaturePart] = parts;
    const header: unknown = JSON.parse(decoder.decode(fromBase64Url(headerPart)));
    if (!header || typeof header !== "object" || (header as { alg?: unknown }).alg !== "HS256" || (header as { typ?: unknown }).typ !== "JWT") return null;
    const key = await importHmacKey(secret, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(signaturePart).buffer, encoder.encode(`${headerPart}.${payloadPart}`));
    if (!valid) return null;
    const value: unknown = JSON.parse(decoder.decode(fromBase64Url(payloadPart)));
    if (!value || typeof value !== "object") return null;
    const payload = value as Partial<AccessPayload>;
    if (
      typeof payload.sub !== "string" ||
      !payload.sub || payload.sub.length > 128 ||
      typeof payload.sid !== "string" ||
      !payload.sid || payload.sid.length > 128 ||
      !ROLES.has(payload.role as string) ||
      payload.type !== "access" ||
      typeof payload.iat !== "number" || !Number.isInteger(payload.iat) ||
      typeof payload.exp !== "number" || !Number.isInteger(payload.exp) ||
      payload.iat > Math.floor(Date.now() / 1000) + 60 ||
      payload.exp <= Math.floor(Date.now() / 1000) ||
      payload.exp <= payload.iat || payload.exp - payload.iat > 3600
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

export function publicUser(user: UserRow): UserRead {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    player_id: user.player_id,
    onboarding_status: user.onboarding_status ?? "approved",
    expires_at: user.expires_at ?? null,
    created_at: user.created_at,
  };
}
