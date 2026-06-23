import bcrypt from "bcryptjs";

/**
 * Password hashing.
 *
 * bcrypt with a sane work factor. Anything pinning the value above 12 starts
 * to feel slow on serverless cold-starts; below 10 is too cheap.
 */

const ROUNDS = process.env.NODE_ENV === "test" ? 4 : 11;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}
