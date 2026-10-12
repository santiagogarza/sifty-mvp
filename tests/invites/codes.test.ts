import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_PREFIX,
  InviteNotConfiguredError,
  generateInviteCode,
  getInvitePepper,
  hashInviteCode,
  isWellFormedInviteCode,
  normalizeInviteCode,
} from "@/lib/invites/codes";
import { describe, expect, it, vi } from "vitest";

describe("invite code format", () => {
  it("generates sifty- + 20 unambiguous characters", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateInviteCode();
      expect(code.startsWith(INVITE_CODE_PREFIX)).toBe(true);
      const body = code.slice(INVITE_CODE_PREFIX.length);
      expect(body).toHaveLength(20);
      for (const ch of body) expect(INVITE_CODE_ALPHABET).toContain(ch);
      expect(isWellFormedInviteCode(code)).toBe(true);
    }
  });

  it("alphabet has no 0/O/1/l/I and 57 symbols (~117 bits per code)", () => {
    for (const bad of ["0", "O", "1", "l", "I"]) expect(INVITE_CODE_ALPHABET).not.toContain(bad);
    expect(new Set(INVITE_CODE_ALPHABET).size).toBe(57);
    expect(INVITE_CODE_ALPHABET).toHaveLength(57);
    expect(20 * Math.log2(57)).toBeGreaterThan(116);
  });

  it("normalizes pasted variants to the canonical form", () => {
    const code = generateInviteCode();
    const body = code.slice(INVITE_CODE_PREFIX.length);
    expect(normalizeInviteCode(`  ${code}  `)).toBe(code);
    expect(normalizeInviteCode(`SIFTY-${body}`)).toBe(code);
    expect(normalizeInviteCode(body)).toBe(code);
    expect(normalizeInviteCode(`sifty- ${body.slice(0, 10)} ${body.slice(10)}`)).toBe(code);
    expect(normalizeInviteCode(`sifty-${body.slice(0, 5)}-${body.slice(5)}`)).toBe(code);
  });

  it("rejects malformed codes", () => {
    expect(isWellFormedInviteCode(normalizeInviteCode(""))).toBe(false);
    expect(isWellFormedInviteCode(normalizeInviteCode("sifty-tooshort"))).toBe(false);
    expect(isWellFormedInviteCode(normalizeInviteCode(`sifty-${"0".repeat(20)}`))).toBe(false);
    expect(isWellFormedInviteCode(normalizeInviteCode(`sifty-${"a".repeat(21)}`))).toBe(false);
    expect(isWellFormedInviteCode(`other-${"a".repeat(20)}`)).toBe(false);
  });
});

describe("invite code hashing", () => {
  it("is deterministic, hex SHA-256, and pepper-sensitive", () => {
    const code = generateInviteCode();
    const a = hashInviteCode(code, "pepper-one-is-long-enough");
    const b = hashInviteCode(code, "pepper-one-is-long-enough");
    const c = hashInviteCode(code, "pepper-two-is-long-enough");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different codes never share a hash", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      seen.add(hashInviteCode(generateInviteCode(), "pepper-one-is-long-enough"));
    }
    expect(seen.size).toBe(100);
  });

  it("reads INVITE_CODE_PEPPER from the environment and fails loudly without it", () => {
    vi.stubEnv("INVITE_CODE_PEPPER", "");
    expect(() => getInvitePepper()).toThrow(InviteNotConfiguredError);
    expect(() => hashInviteCode(generateInviteCode())).toThrow(/INVITE_CODE_PEPPER/);
    vi.stubEnv("INVITE_CODE_PEPPER", "short");
    expect(() => getInvitePepper()).toThrow(InviteNotConfiguredError);
    vi.stubEnv("INVITE_CODE_PEPPER", "a-real-pepper-with-enough-length");
    expect(getInvitePepper()).toBe("a-real-pepper-with-enough-length");
  });
});
