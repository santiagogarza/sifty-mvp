import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption at rest for the few secrets Sifty must hold itself (a user's
 * Cursor API key, connector material a broker cannot keep, …).
 *
 * AES-256-GCM under `DATA_ENCRYPTION_KEY` (32 bytes, base64; generate with
 * `openssl rand -base64 32`). Each value gets a fresh 12-byte IV; the
 * ciphertext is `v1.<iv>.<ciphertext>.<tag>` in base64url, so a column
 * holding it is plain text and the version prefix leaves room for key
 * rotation. Optional associated data (`aad`, e.g. the owning user id)
 * binds a ciphertext to its row: moving it to another row fails to
 * decrypt.
 *
 * There is deliberately no development fallback key: a secret encrypted
 * under a well-known key is a secret stored in the clear. Callers check
 * `isDataEncryptionConfigured()` and fail loudly (503 with the message
 * below) when it is not.
 */

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class DataEncryptionNotConfiguredError extends Error {
  constructor() {
    super(
      "DATA_ENCRYPTION_KEY is not set (or is not 32 bytes of base64). Generate one with `openssl rand -base64 32` and add it to the environment before storing secrets.",
    );
    this.name = "DataEncryptionNotConfiguredError";
  }
}

export class SecretDecryptError extends Error {
  constructor(reason: string) {
    super(`Could not decrypt secret: ${reason}`);
    this.name = "SecretDecryptError";
  }
}

export function isDataEncryptionConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return loadKey(env) !== null;
}

function loadKey(env: NodeJS.ProcessEnv): Buffer | null {
  const raw = env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const candidates = [Buffer.from(raw, "base64"), Buffer.from(raw, "hex")];
  return candidates.find((b) => b.length === KEY_BYTES) ?? null;
}

function requireKey(env: NodeJS.ProcessEnv): Buffer {
  const key = loadKey(env);
  if (!key) throw new DataEncryptionNotConfiguredError();
  return key;
}

export interface SecretBoxOptions {
  /** Associated data bound to the ciphertext (not encrypted, must match on decrypt). */
  aad?: string;
  env?: NodeJS.ProcessEnv;
}

export function encryptSecret(plaintext: string, opts: SecretBoxOptions = {}): string {
  const key = requireKey(opts.env ?? process.env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (opts.aad) cipher.setAAD(Buffer.from(opts.aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64url(iv), b64url(ciphertext), b64url(tag)].join(".");
}

export function decryptSecret(token: string, opts: SecretBoxOptions = {}): string {
  const key = requireKey(opts.env ?? process.env);
  const parts = token.split(".");
  if (parts.length !== 4) throw new SecretDecryptError("malformed");
  const [version, ivPart, ctPart, tagPart] = parts as [string, string, string, string];
  if (version !== VERSION) throw new SecretDecryptError(`unsupported version ${version}`);
  const iv = fromB64url(ivPart);
  const tag = fromB64url(tagPart);
  if (iv.length !== IV_BYTES || tag.length !== 16) throw new SecretDecryptError("malformed");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  if (opts.aad) decipher.setAAD(Buffer.from(opts.aad, "utf8"));
  try {
    return Buffer.concat([decipher.update(fromB64url(ctPart)), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, tampered ciphertext, or associated data that does not match.
    throw new SecretDecryptError("authentication failed");
  }
}

/** True for strings produced by `encryptSecret` (shape only, not validity). */
export function looksEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}.`) && value.split(".").length === 4;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}
