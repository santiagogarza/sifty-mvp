import { createHash } from "node:crypto";
import { customAlphabet } from "nanoid";

/**
 * Invite code format and hashing.
 *
 * Codes look like `sifty-` + 20 characters from an alphabet without the
 * glyphs people misread (0/O, 1/l/I): 57 symbols, so ~117 bits of entropy.
 * Only the SHA-256 of `pepper + code` is stored. A leaked table therefore
 * yields nothing usable without the pepper, and a leaked pepper yields
 * nothing without the table.
 */

export const INVITE_CODE_PREFIX = "sifty-";
export const INVITE_CODE_BODY_LENGTH = 20;
export const INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const BODY_PATTERN = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_BODY_LENGTH}}$`);

const randomBody = customAlphabet(INVITE_CODE_ALPHABET, INVITE_CODE_BODY_LENGTH);

export function generateInviteCode(): string {
  return `${INVITE_CODE_PREFIX}${randomBody()}`;
}

/**
 * Accepts what a person pastes: surrounding whitespace, a missing or
 * differently-cased prefix, inner spaces or dashes from copy/paste. The
 * body is case-sensitive and untouched.
 */
export function normalizeInviteCode(raw: string): string {
  let s = raw.trim().replace(/\s+/g, "");
  if (s.slice(0, INVITE_CODE_PREFIX.length).toLowerCase() === INVITE_CODE_PREFIX) {
    s = s.slice(INVITE_CODE_PREFIX.length);
  }
  s = s.replace(/-/g, "");
  return `${INVITE_CODE_PREFIX}${s}`;
}

export function isWellFormedInviteCode(normalized: string): boolean {
  if (!normalized.startsWith(INVITE_CODE_PREFIX)) return false;
  return BODY_PATTERN.test(normalized.slice(INVITE_CODE_PREFIX.length));
}

export class InviteNotConfiguredError extends Error {
  constructor() {
    super(
      "INVITE_CODE_PEPPER is not configured. Generate one with `openssl rand -hex 32` and set it in the environment.",
    );
    this.name = "InviteNotConfiguredError";
  }
}

export function getInvitePepper(): string {
  const pepper = process.env.INVITE_CODE_PEPPER;
  if (!pepper || pepper.length < 16) throw new InviteNotConfiguredError();
  return pepper;
}

export function hashInviteCode(normalized: string, pepper: string = getInvitePepper()): string {
  return createHash("sha256").update(`${pepper}:${normalized}`).digest("hex");
}
