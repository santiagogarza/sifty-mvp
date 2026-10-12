import {
  DataEncryptionKeyError,
  DecryptionError,
  decryptSecret,
  encryptSecret,
  isDataEncryptionKeyConfigured,
  isSealed,
  resolveDataEncryptionKey,
  secretsEqual,
} from "@/lib/crypto/aes-gcm";
import { describe, expect, it } from "vitest";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("aes-gcm envelope", () => {
  it("round-trips and never stores the plaintext", () => {
    const sealed = encryptSecret("mock-token-abc123", "conn_1", Buffer.from(KEY, "base64"));
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain("mock-token");
    expect(sealed.split(".")).toHaveLength(4);
    expect(decryptSecret(sealed, "conn_1", Buffer.from(KEY, "base64"))).toBe("mock-token-abc123");
  });

  it("uses a fresh IV per call", () => {
    const key = Buffer.from(KEY, "base64");
    expect(encryptSecret("same", "row", key)).not.toBe(encryptSecret("same", "row", key));
  });

  it("refuses a ciphertext moved to another row (AAD mismatch)", () => {
    const key = Buffer.from(KEY, "base64");
    const sealed = encryptSecret("secret", "conn_a", key);
    expect(() => decryptSecret(sealed, "conn_b", key)).toThrow(DecryptionError);
  });

  it("refuses tampering and the wrong key", () => {
    const key = Buffer.from(KEY, "base64");
    const sealed = encryptSecret("secret", "row", key);
    const [v, iv, ct, tag] = sealed.split(".") as [string, string, string, string];
    const flipped = `${ct.slice(0, -1)}${ct.endsWith("A") ? "B" : "A"}`;
    expect(() => decryptSecret([v, iv, flipped, tag].join("."), "row", key)).toThrow(
      DecryptionError,
    );
    expect(() => decryptSecret(sealed, "row", Buffer.alloc(32, 9))).toThrow(DecryptionError);
    expect(() => decryptSecret("v0.a.b.c", "row", key)).toThrow(DecryptionError);
    expect(() => decryptSecret("not an envelope", "row", key)).toThrow(DecryptionError);
  });

  it("validates the key length", () => {
    expect(() => resolveDataEncryptionKey({ DATA_ENCRYPTION_KEY: "dG9vc2hvcnQ=" })).toThrow(
      DataEncryptionKeyError,
    );
    expect(resolveDataEncryptionKey({ DATA_ENCRYPTION_KEY: KEY })).toHaveLength(32);
  });

  it("falls back to a dev key off production and refuses on Vercel production", () => {
    expect(resolveDataEncryptionKey({})).toHaveLength(32);
    expect(isDataEncryptionKeyConfigured({})).toBe(false);
    expect(() => resolveDataEncryptionKey({ VERCEL_ENV: "production" })).toThrow(
      /DATA_ENCRYPTION_KEY is not set/,
    );
  });

  it("compares secrets in constant time by length and content", () => {
    expect(secretsEqual("abc", "abc")).toBe(true);
    expect(secretsEqual("abc", "abd")).toBe(false);
    expect(secretsEqual("abc", "abcd")).toBe(false);
  });
});
