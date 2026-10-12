import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { isVercelProduction } from "@/lib/env/production-guards";

/**
 * Encryption at rest for the few secrets Sifty must hold itself.
 *
 * Third-party OAuth tokens live in the credential broker (Vercel Connect),
 * never here. What remains — the mock connector's fake credential, a
 * per-user Cursor API key later — is sealed with AES-256-GCM under
 * `DATA_ENCRYPTION_KEY` before it reaches Postgres, so a database dump or
 * a misrouted log line never contains a usable secret.
 *
 * Envelope format: `v1.<iv>.<ciphertext>.<tag>` (base64url). The version
 * prefix is what lets a future key rotation decrypt old rows with the old
 * key and re-seal them with the new one; `aad` binds a ciphertext to its
 * row (e.g. the connection id) so one user's sealed secret cannot be
 * copied onto another row and decrypted there.
 *
 * Key: 32 bytes, base64 or base64url (`openssl rand -base64 32`). Outside
 * Vercel production a missing key falls back to a fixed development key
 * so the keyless local setup and CI keep working; production refuses.
 */

const ENVELOPE_VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class DataEncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataEncryptionKeyError";
  }
}

export class DecryptionError extends Error {
  constructor(message = "Could not decrypt the stored secret.") {
    super(message);
    this.name = "DecryptionError";
  }
}

const DEV_FALLBACK_KEY = Buffer.alloc(KEY_BYTES, "sifty-dev-data-encryption-key");

/** Resolve and validate the key. Exported for the health check and tests. */
export function resolveDataEncryptionKey(
  env: Record<string, string | undefined> = process.env,
): Buffer {
  const raw = env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (isVercelProduction(env)) {
      throw new DataEncryptionKeyError(
        "DATA_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to the Vercel project (Production scope).",
      );
    }
    return DEV_FALLBACK_KEY;
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new DataEncryptionKeyError(
      `DATA_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  return key;
}

export function isDataEncryptionKeyConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !!env.DATA_ENCRYPTION_KEY?.trim();
}

/**
 * Seal `plaintext`. `aad` (additional authenticated data) is not encrypted
 * but is required, byte for byte, to decrypt — pass the owning row's id.
 */
export function encryptSecret(
  plaintext: string,
  aad: string,
  key = resolveDataEncryptionKey(),
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, b64(iv), b64(ciphertext), b64(tag)].join(".");
}

/** Open an envelope produced by `encryptSecret`. Throws `DecryptionError` on any mismatch. */
export function decryptSecret(
  envelope: string,
  aad: string,
  key = resolveDataEncryptionKey(),
): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new DecryptionError("Unrecognized secret envelope.");
  }
  const [, ivPart, ctPart, tagPart] = parts as [string, string, string, string];
  const iv = unb64(ivPart);
  const tag = unb64(tagPart);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new DecryptionError("Malformed secret envelope.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(unb64(ctPart)), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptionError();
  }
}

/** True when `value` looks like one of our envelopes (never a raw secret). */
export function isSealed(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(".");
  return parts.length === 4 && parts[0] === ENVELOPE_VERSION;
}

/** Constant-time string equality for comparing decrypted secrets. */
export function secretsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function b64(buf: Buffer): string {
  return buf.toString("base64url");
}

function unb64(s: string): Buffer {
  return Buffer.from(s, "base64url");
}
