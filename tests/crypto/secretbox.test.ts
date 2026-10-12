import { randomBytes } from "node:crypto";
import {
  DataEncryptionNotConfiguredError,
  SecretDecryptError,
  decryptSecret,
  encryptSecret,
  isDataEncryptionConfigured,
  looksEncrypted,
} from "@/lib/crypto/secretbox";
import { describe, expect, it } from "vitest";

const key = randomBytes(32).toString("base64");
const env = { DATA_ENCRYPTION_KEY: key } as unknown as NodeJS.ProcessEnv;

describe("secretbox (AES-256-GCM under DATA_ENCRYPTION_KEY)", () => {
  it("round-trips, with a fresh IV per call", () => {
    const a = encryptSecret("cur_api_key_123", { env });
    const b = encryptSecret("cur_api_key_123", { env });
    expect(a).not.toBe(b);
    expect(looksEncrypted(a)).toBe(true);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain("cur_api_key");
    expect(decryptSecret(a, { env })).toBe("cur_api_key_123");
    expect(decryptSecret(b, { env })).toBe("cur_api_key_123");
    expect(decryptSecret(encryptSecret("", { env }), { env })).toBe("");
    expect(decryptSecret(encryptSecret("ünïcödé 🔐", { env }), { env })).toBe("ünïcödé 🔐");
  });

  it("binds a value to its associated data", () => {
    const token = encryptSecret("secret", { env, aad: "user_1" });
    expect(decryptSecret(token, { env, aad: "user_1" })).toBe("secret");
    expect(() => decryptSecret(token, { env, aad: "user_2" })).toThrow(SecretDecryptError);
    expect(() => decryptSecret(token, { env })).toThrow(SecretDecryptError);
  });

  it("rejects tampering, the wrong key, and malformed input", () => {
    const token = encryptSecret("secret", { env });
    const [v, iv, ct, tag] = token.split(".") as [string, string, string, string];
    const flipped = `${ct.slice(0, -1)}${ct.endsWith("A") ? "B" : "A"}`;
    expect(() => decryptSecret(`${v}.${iv}.${flipped}.${tag}`, { env })).toThrow(
      /authentication failed/,
    );
    const other = {
      DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    } as unknown as NodeJS.ProcessEnv;
    expect(() => decryptSecret(token, { env: other })).toThrow(SecretDecryptError);
    expect(() => decryptSecret("nonsense", { env })).toThrow(/malformed/);
    expect(() => decryptSecret(`v9.${iv}.${ct}.${tag}`, { env })).toThrow(/unsupported version/);
    expect(looksEncrypted("nonsense")).toBe(false);
  });

  it("fails loudly without a usable key — no development fallback", () => {
    const missing = {} as unknown as NodeJS.ProcessEnv;
    expect(isDataEncryptionConfigured(missing)).toBe(false);
    expect(() => encryptSecret("x", { env: missing })).toThrow(DataEncryptionNotConfiguredError);
    expect(() => encryptSecret("x", { env: missing })).toThrow(/openssl rand -base64 32/);
    const short = {
      DATA_ENCRYPTION_KEY: Buffer.from("short").toString("base64"),
    } as unknown as NodeJS.ProcessEnv;
    expect(isDataEncryptionConfigured(short)).toBe(false);
    expect(() => decryptSecret("v1.a.b.c", { env: short })).toThrow(
      DataEncryptionNotConfiguredError,
    );
    // Hex is accepted too.
    const hex = {
      DATA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    } as unknown as NodeJS.ProcessEnv;
    expect(isDataEncryptionConfigured(hex)).toBe(true);
    expect(decryptSecret(encryptSecret("hex", { env: hex }), { env: hex })).toBe("hex");
  });
});
