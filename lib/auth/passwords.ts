import bcrypt from "bcryptjs";
import { verifyPassword as verifyScrypt } from "better-auth/crypto";

/**
 * Password verification.
 *
 * New passwords are hashed by Better Auth (scrypt). Accounts imported from
 * the hand-rolled auth still carry bcrypt hashes (`$2a$` / `$2b$` / `$2y$`);
 * those keep verifying, so nobody has to reset a password because of the
 * migration. A legacy hash is replaced with scrypt the next time the user
 * changes or resets their password.
 */

const BCRYPT_PREFIX = /^\$2[aby]\$/;

export function isBcryptHash(hash: string): boolean {
  return BCRYPT_PREFIX.test(hash);
}

export async function verifyPasswordHash(data: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (isBcryptHash(data.hash)) return bcrypt.compare(data.password, data.hash);
  return verifyScrypt(data);
}
