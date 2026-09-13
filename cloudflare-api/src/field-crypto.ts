import { fromBase64Url, toBase64Url } from "./security";

const PREFIX = "enc:v1:";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Encryption for the few columns that must not be readable at rest.
 *
 * A child's health notes are the most sensitive thing AIMZ holds. D1 already
 * encrypts its disks; this covers everything above the disk — an export, a
 * backup copied to a laptop, the importer's staging file, a query typed into
 * the dashboard. A value becomes `enc:v1:` followed by AES-256-GCM over a
 * random nonce, bound to its table and column so a ciphertext cannot be moved
 * into another field and still open.
 *
 * The FastAPI backend reads and writes the same format
 * (backend/app/core/field_crypto.py), so a D1 export imports into RDS still
 * encrypted and opens there with the same key.
 */
export const HEALTH_COLUMNS = ["medical_concerns", "medications"] as const;

let cachedKey: { secret: string; key: Promise<CryptoKey> } | undefined;

function fieldKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    const key = crypto.subtle.digest("SHA-256", encoder.encode(`aimz-field-encryption:v1:${secret}`))
      .then((material) => crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]));
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

/** True once a key long enough to be a real secret is configured. */
export function encryptionConfigured(env: Env): boolean {
  return typeof env.DATA_ENCRYPTION_KEY === "string" && env.DATA_ENCRYPTION_KEY.length >= 32;
}

export function isSealed(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * The value as it should be stored.
 *
 * Without a key it is stored as given: staging holds fictional data only, and
 * production refuses every request until the key is set (see src/index.ts), so
 * plaintext can only ever land where it was never real.
 */
export async function sealField(env: Env, column: string, value: string): Promise<string> {
  if (!encryptionConfigured(env)) return value;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(column) },
    await fieldKey(env.DATA_ENCRYPTION_KEY!),
    encoder.encode(value),
  ));
  const combined = new Uint8Array(iv.length + sealed.length);
  combined.set(iv);
  combined.set(sealed, iv.length);
  return `${PREFIX}${toBase64Url(combined)}`;
}

/**
 * The value as a person should read it.
 *
 * Anything not sealed — a row written before encryption was switched on, or a
 * redaction marker — comes back untouched. A sealed value that will not open
 * (a rotated key, a damaged row) comes back still sealed rather than failing
 * the whole screen it sits on: the reader sees an unreadable field, never
 * somebody else's plaintext.
 */
export async function openField(env: Env, column: string, value: string | null): Promise<string | null> {
  if (value === null || !isSealed(value) || !encryptionConfigured(env)) return value;
  try {
    const bytes = fromBase64Url(value.slice(PREFIX.length));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: encoder.encode(column) },
      await fieldKey(env.DATA_ENCRYPTION_KEY!),
      bytes.slice(12),
    );
    return decoder.decode(plain);
  } catch {
    console.error(JSON.stringify({ message: "sealed field did not open", column }));
    return value;
  }
}

/** A newcomer application with its health notes opened for an administrator. */
export async function openApplication<T extends Record<string, unknown>>(env: Env, row: T): Promise<T> {
  const opened: Record<string, unknown> = { ...row };
  for (const column of HEALTH_COLUMNS) {
    const value = row[column];
    if (typeof value === "string") opened[column] = await openField(env, `newcomer_applications.${column}`, value);
  }
  return opened as T;
}

/**
 * Seals health notes written before a key was configured, a batch at a time.
 *
 * Run from the nightly timer. The update only lands if the row still holds
 * the plaintext it was read with, so an edit in between is never overwritten.
 */
export async function sealLegacyHealthData(env: Env, batch = 200): Promise<number> {
  if (!encryptionConfigured(env)) return 0;
  const rows = await env.DB.prepare(
    `SELECT id, medical_concerns, medications FROM newcomer_applications
     WHERE medical_concerns NOT LIKE 'enc:v1:%' OR medications NOT LIKE 'enc:v1:%' LIMIT ?`,
  ).bind(batch).all<{ id: string; medical_concerns: string; medications: string }>();
  if (!rows.results.length) return 0;
  const statements = await Promise.all(rows.results.map(async (row) => env.DB.prepare(
    "UPDATE newcomer_applications SET medical_concerns=?, medications=? WHERE id=? AND medical_concerns=? AND medications=?",
  ).bind(
    isSealed(row.medical_concerns) ? row.medical_concerns : await sealField(env, "newcomer_applications.medical_concerns", row.medical_concerns),
    isSealed(row.medications) ? row.medications : await sealField(env, "newcomer_applications.medications", row.medications),
    row.id, row.medical_concerns, row.medications,
  )));
  const results = await env.DB.batch(statements);
  return results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
}
