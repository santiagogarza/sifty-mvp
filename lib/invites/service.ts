import type { Repos } from "@/lib/db/repos";
import type { InviteCode, InviteGrant } from "@/lib/db/repos/types";
import type { Tier } from "@/lib/domain/types";
import { emptySnapshot, isCompActive, resolveTier } from "@/lib/entitlements/entitlements";
import {
  generateInviteCode,
  hashInviteCode,
  isWellFormedInviteCode,
  normalizeInviteCode,
} from "./codes";

/**
 * Invite codes: mint, redeem, revoke.
 *
 * Redeeming writes the `comped` facts onto the user's entitlement; the tier
 * itself comes from `resolveTier`, so a creator redeeming a code stays
 * creator and a paying user keeps their Stripe facts untouched.
 */

export interface MintInput {
  grants?: InviteGrant;
  /** Months of Pro per redemption; null = forever. */
  durationMonths?: number | null;
  maxRedemptions?: number;
  expiresAt?: string | null;
  note?: string | null;
}

export async function mintInviteCode(
  repos: Repos,
  input: MintInput = {},
): Promise<{ code: string; record: InviteCode }> {
  const maxRedemptions = input.maxRedemptions ?? 1;
  if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1) {
    throw new Error("maxRedemptions must be a positive integer");
  }
  const durationMonths = input.durationMonths ?? null;
  if (durationMonths !== null && (!Number.isInteger(durationMonths) || durationMonths < 1)) {
    throw new Error("durationMonths must be a positive integer or null");
  }
  if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) {
    throw new Error("expiresAt must be an ISO date");
  }
  const code = generateInviteCode();
  const record = await repos.inviteCodes.create({
    codeHash: hashInviteCode(code),
    grants: input.grants ?? "pro",
    durationMonths,
    maxRedemptions,
    expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
    note: input.note?.trim() || null,
  });
  return { code, record };
}

export type RedeemFailure =
  | "malformed"
  | "unknown"
  | "revoked"
  | "expired"
  | "exhausted"
  | "already_redeemed";

export type RedeemResult =
  | { ok: true; tier: Tier; compedUntil: string | null }
  | { ok: false; reason: RedeemFailure };

export const REDEEM_MESSAGES: Record<RedeemFailure, string> = {
  malformed:
    "That doesn't look like a Sifty invite code. Codes start with sifty- and have 20 characters.",
  unknown: "We don't recognize that invite code. Check it for typos.",
  revoked: "That invite code has been revoked.",
  expired: "That invite code has expired.",
  exhausted: "That invite code has already been used the maximum number of times.",
  already_redeemed: "You've already redeemed this code.",
};

export async function redeemInviteCode(
  repos: Repos,
  input: { userId: string; isCreator: boolean; code: string; now?: Date },
): Promise<RedeemResult> {
  const now = input.now ?? new Date();
  const normalized = normalizeInviteCode(input.code);
  if (!isWellFormedInviteCode(normalized)) return { ok: false, reason: "malformed" };

  const code = await repos.inviteCodes.findByHash(hashInviteCode(normalized));
  if (!code) return { ok: false, reason: "unknown" };
  // Pre-checks give precise feedback; `consume` re-checks atomically.
  if (code.revokedAt) return { ok: false, reason: "revoked" };
  if (code.expiresAt && Date.parse(code.expiresAt) <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  // The grant is derived from the entitlement row *as locked inside the
  // consume transaction*, so a Stripe write landing between our read and
  // our write cannot be clobbered, and the comp commits with the redemption.
  const consumed = await repos.inviteCodes.consume(code.id, input.userId, {
    now,
    grant: (current) => {
      const base = current ?? emptySnapshot();
      const compedAt = now.toISOString();
      const compedUntil = extendComp(base, code.durationMonths, now);
      return {
        compedAt,
        compedUntil,
        tier: resolveTier({ ...base, compedAt, compedUntil, isCreator: input.isCreator }, now),
      };
    },
  });
  if (!consumed.ok) return { ok: false, reason: consumed.reason };
  return {
    ok: true,
    tier: consumed.entitlement.tier,
    compedUntil: consumed.entitlement.compedUntil,
  };
}

/**
 * `--expires` on the CLI: a bare calendar date means "valid through that
 * day", so it becomes the last instant of the day in UTC; a full timestamp
 * is taken as given.
 */
export function parseExpiresInput(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const end = new Date(`${trimmed}T23:59:59.999Z`);
    if (Number.isNaN(end.getTime())) throw new Error("expiresAt must be a date like 2027-01-31");
    return end.toISOString();
  }
  const ts = Date.parse(trimmed);
  if (Number.isNaN(ts)) throw new Error("expiresAt must be a date like 2027-01-31");
  return new Date(ts).toISOString();
}

/**
 * Comp end after applying a code on top of the user's existing comp:
 * a forever grant (null) wins; otherwise months are added to the later of
 * now and the current comp end, so stacking two 3-month codes gives 6 months.
 */
export function extendComp(
  current: { compedAt: string | null; compedUntil: string | null },
  durationMonths: number | null,
  now: Date,
): string | null {
  const active = isCompActive(current, now);
  if (durationMonths === null) return null;
  if (active && current.compedUntil === null) return null;
  const base = active && current.compedUntil ? new Date(current.compedUntil) : new Date(now);
  return addMonthsClamped(base, durationMonths).toISOString();
}

/** `Date.setMonth` rolls Jan 31 + 1 into March; clamp to the target month's last day instead. */
export function addMonthsClamped(from: Date, months: number): Date {
  const end = new Date(from);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return end;
}

export interface RevokeOptions {
  /** Also end the comp for everyone who redeemed this code. */
  cascade?: boolean;
  now?: Date;
}

export async function revokeInviteCode(
  repos: Repos,
  codeOrId: string,
  opts: RevokeOptions = {},
): Promise<{ code: InviteCode; compsEnded: number } | null> {
  const now = opts.now ?? new Date();
  const normalized = normalizeInviteCode(codeOrId);
  const record = isWellFormedInviteCode(normalized)
    ? await repos.inviteCodes.findByHash(hashInviteCode(normalized))
    : await repos.inviteCodes.getById(codeOrId);
  if (!record) return null;

  const code = (await repos.inviteCodes.revoke(record.id, now)) ?? record;
  let compsEnded = 0;
  if (opts.cascade) {
    for (const redemption of await repos.inviteCodes.listRedemptions(record.id)) {
      const ent = await repos.entitlements.get(redemption.userId);
      if (!ent || !isCompActive(ent, now)) continue;
      const user = await repos.users.getById(redemption.userId);
      const stripped = { ...ent, compedAt: null, compedUntil: null };
      await repos.entitlements.upsert(redemption.userId, {
        ...stripped,
        tier: resolveTier({ ...stripped, isCreator: user?.isCreator ?? false }, now),
      });
      compsEnded += 1;
    }
  }
  return { code, compsEnded };
}
