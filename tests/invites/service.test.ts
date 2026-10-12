import { applyStripeEvent } from "@/lib/billing/events";
import {
  PRO_FAIR_USE_SIFTS_PER_DAY,
  canRunAi,
  deriveEntitlement,
  emptySnapshot,
  trialSnapshot,
} from "@/lib/entitlements/entitlements";
import { hashInviteCode, isWellFormedInviteCode } from "@/lib/invites/codes";
import {
  extendComp,
  mintInviteCode,
  redeemInviteCode,
  revokeInviteCode,
} from "@/lib/invites/service";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestRepos } from "../setup";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.stubEnv("INVITE_CODE_PEPPER", "test-pepper-with-enough-length-0123");
});

async function makeUser(email: string, isCreator = false) {
  const repos = getTestRepos();
  const user = await repos.users.create({ email, passwordHash: null, displayName: "U", isCreator });
  // Lapsed trial → free, so a comp is visible as a tier change.
  await repos.entitlements.upsert(
    user.id,
    isCreator
      ? { ...emptySnapshot(), tier: "creator" }
      : { ...trialSnapshot(30, new Date(Date.now() - 45 * DAY)), tier: "free" },
  );
  return user;
}

async function entitlementFor(userId: string, isCreator = false) {
  const repos = getTestRepos();
  const snap = await repos.entitlements.get(userId);
  return deriveEntitlement({ profile: { isCreator }, snapshot: snap });
}

describe("mintInviteCode", () => {
  it("stores only the hash, with the requested limits", async () => {
    const repos = getTestRepos();
    const { code, record } = await mintInviteCode(repos, {
      durationMonths: 6,
      maxRedemptions: 3,
      note: "  Ana  ",
    });
    expect(isWellFormedInviteCode(code)).toBe(true);
    expect(record.codeHash).toBe(hashInviteCode(code));
    expect(record.codeHash).not.toContain(code.slice(6));
    expect(record.grants).toBe("pro");
    expect(record.durationMonths).toBe(6);
    expect(record.maxRedemptions).toBe(3);
    expect(record.redemptionCount).toBe(0);
    expect(record.note).toBe("Ana");
    expect(record.revokedAt).toBeNull();
    expect(await repos.inviteCodes.findByHash(record.codeHash)).toEqual(record);
  });

  it("defaults to a single-use forever code and validates inputs", async () => {
    const repos = getTestRepos();
    const { record } = await mintInviteCode(repos);
    expect(record.maxRedemptions).toBe(1);
    expect(record.durationMonths).toBeNull();
    expect(record.expiresAt).toBeNull();
    await expect(mintInviteCode(repos, { maxRedemptions: 0 })).rejects.toThrow(/maxRedemptions/);
    await expect(mintInviteCode(repos, { durationMonths: 1.5 })).rejects.toThrow(/durationMonths/);
    await expect(mintInviteCode(repos, { expiresAt: "not a date" })).rejects.toThrow(/expiresAt/);
  });
});

describe("redeemInviteCode", () => {
  it("a redeemed forever code yields comped entitlements with Pro caps", async () => {
    const repos = getTestRepos();
    const user = await makeUser("ana@example.com");
    expect((await entitlementFor(user.id)).tier).toBe("free");

    const { code, record } = await mintInviteCode(repos, { note: "Ana" });
    const result = await redeemInviteCode(repos, {
      userId: user.id,
      isCreator: false,
      code: `  ${code.toUpperCase().slice(0, 6)}${code.slice(6)} `,
    });
    expect(result).toEqual({ ok: true, tier: "comped", compedUntil: null });

    const ent = await entitlementFor(user.id);
    expect(ent.tier).toBe("comped");
    expect(ent.compedUntil).toBeNull();
    expect(ent.caps.siftsPerDay).toBe(PRO_FAIR_USE_SIFTS_PER_DAY);
    expect(ent.caps.connectorsAllowed).toBe(true);
    expect(canRunAi({ ...ent, siftsToday: 50 })).toEqual({ ok: true });

    const stored = await repos.inviteCodes.getById(record.id);
    expect(stored?.redemptionCount).toBe(1);
    const redemptions = await repos.inviteCodes.listRedemptions(record.id);
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]?.userId).toBe(user.id);
    expect(redemptions[0]?.compedUntil).toBeNull();
    expect(await repos.inviteCodes.listRedemptionsForUser(user.id)).toHaveLength(1);
  });

  it("a timed code comps for N months from now", async () => {
    const repos = getTestRepos();
    const user = await makeUser("tim@example.com");
    const now = new Date("2026-10-12T00:00:00.000Z");
    const { code } = await mintInviteCode(repos, { durationMonths: 3 });
    const result = await redeemInviteCode(repos, { userId: user.id, isCreator: false, code, now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compedUntil).toBe("2027-01-12T00:00:00.000Z");
    const snap = await repos.entitlements.get(user.id);
    expect(snap?.compedAt).toBe(now.toISOString());
    expect(snap?.compedUntil).toBe("2027-01-12T00:00:00.000Z");
    expect(deriveEntitlement({ profile: { isCreator: false }, snapshot: snap, now }).tier).toBe(
      "comped",
    );
    const later = new Date("2027-02-01T00:00:00.000Z");
    expect(
      deriveEntitlement({ profile: { isCreator: false }, snapshot: snap, now: later }).tier,
    ).toBe("free");
  });

  it("stacking a second timed code extends from the current comp end", async () => {
    const repos = getTestRepos();
    const user = await makeUser("stack@example.com");
    const now = new Date("2026-10-12T00:00:00.000Z");
    const a = await mintInviteCode(repos, { durationMonths: 3 });
    const b = await mintInviteCode(repos, { durationMonths: 3 });
    await redeemInviteCode(repos, { userId: user.id, isCreator: false, code: a.code, now });
    const second = await redeemInviteCode(repos, {
      userId: user.id,
      isCreator: false,
      code: b.code,
      now: new Date("2026-11-01T00:00:00.000Z"),
    });
    expect(second.ok && second.compedUntil).toBe("2027-04-12T00:00:00.000Z");
  });

  it("rejects malformed and unknown codes without touching the entitlement", async () => {
    const repos = getTestRepos();
    const user = await makeUser("nope@example.com");
    const before = await repos.entitlements.get(user.id);
    expect(
      await redeemInviteCode(repos, { userId: user.id, isCreator: false, code: "sifty-abc" }),
    ).toEqual({ ok: false, reason: "malformed" });
    expect(
      await redeemInviteCode(repos, {
        userId: user.id,
        isCreator: false,
        code: `sifty-${"a".repeat(20)}`,
      }),
    ).toEqual({ ok: false, reason: "unknown" });
    expect(await repos.entitlements.get(user.id)).toEqual(before);
  });

  it("enforces max_redemptions across users and once-per-user", async () => {
    const repos = getTestRepos();
    const u1 = await makeUser("one@example.com");
    const u2 = await makeUser("two@example.com");
    const u3 = await makeUser("three@example.com");
    const { code } = await mintInviteCode(repos, { maxRedemptions: 2 });

    expect((await redeemInviteCode(repos, { userId: u1.id, isCreator: false, code })).ok).toBe(
      true,
    );
    expect(await redeemInviteCode(repos, { userId: u1.id, isCreator: false, code })).toEqual({
      ok: false,
      reason: "already_redeemed",
    });
    expect((await redeemInviteCode(repos, { userId: u2.id, isCreator: false, code })).ok).toBe(
      true,
    );
    expect(await redeemInviteCode(repos, { userId: u3.id, isCreator: false, code })).toEqual({
      ok: false,
      reason: "exhausted",
    });
    expect((await entitlementFor(u3.id)).tier).toBe("free");
  });

  it("rejects expired codes (expires_at) but honors them a second before", async () => {
    const repos = getTestRepos();
    const user = await makeUser("late@example.com");
    const expiresAt = new Date("2026-12-31T23:59:59.000Z").toISOString();
    const { code } = await mintInviteCode(repos, { expiresAt });

    const tooLate = await redeemInviteCode(repos, {
      userId: user.id,
      isCreator: false,
      code,
      now: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(tooLate).toEqual({ ok: false, reason: "expired" });

    const inTime = await redeemInviteCode(repos, {
      userId: user.id,
      isCreator: false,
      code,
      now: new Date("2026-12-31T23:59:58.000Z"),
    });
    expect(inTime.ok).toBe(true);
  });

  it("rejects revoked codes; revoke by plaintext or by id", async () => {
    const repos = getTestRepos();
    const user = await makeUser("rev@example.com");
    const { code, record } = await mintInviteCode(repos);
    const revoked = await revokeInviteCode(repos, code);
    expect(revoked?.code.id).toBe(record.id);
    expect(revoked?.code.revokedAt).toBeTruthy();
    expect(await redeemInviteCode(repos, { userId: user.id, isCreator: false, code })).toEqual({
      ok: false,
      reason: "revoked",
    });

    const other = await mintInviteCode(repos);
    expect((await revokeInviteCode(repos, other.record.id))?.code.revokedAt).toBeTruthy();
    expect(await revokeInviteCode(repos, "inv_does_not_exist")).toBeNull();
  });

  it("revoke --cascade ends the comp for everyone who redeemed that code", async () => {
    const repos = getTestRepos();
    const u1 = await makeUser("c1@example.com");
    const u2 = await makeUser("c2@example.com");
    const { code } = await mintInviteCode(repos, { maxRedemptions: 5 });
    await redeemInviteCode(repos, { userId: u1.id, isCreator: false, code });
    await redeemInviteCode(repos, { userId: u2.id, isCreator: false, code });
    expect((await entitlementFor(u1.id)).tier).toBe("comped");

    const plain = await revokeInviteCode(repos, code);
    expect(plain?.compsEnded).toBe(0);
    expect((await entitlementFor(u1.id)).tier).toBe("comped");

    const cascaded = await revokeInviteCode(repos, code, { cascade: true });
    expect(cascaded?.compsEnded).toBe(2);
    expect((await entitlementFor(u1.id)).tier).toBe("free");
    expect((await entitlementFor(u2.id)).tier).toBe("free");
  });

  it("precedence: creator stays creator; comped survives a Stripe cancellation", async () => {
    const repos = getTestRepos();
    const santi = await makeUser("s.gonzalez.garza@gmail.com", true);
    const { code } = await mintInviteCode(repos, { maxRedemptions: 2 });
    const r = await redeemInviteCode(repos, { userId: santi.id, isCreator: true, code });
    expect(r).toEqual({ ok: true, tier: "creator", compedUntil: null });

    const payer = await makeUser("payer@example.com");
    await redeemInviteCode(repos, { userId: payer.id, isCreator: false, code });
    const snap = (await repos.entitlements.get(payer.id))!;
    const cancelled = applyStripeEvent(
      { ...snap, subscriptionActive: true, tier: "comped" },
      {
        type: "customer.subscription.deleted",
        data: {
          object: { id: "sub_1", status: "canceled", current_period_end: 0, customer: "cus_1" },
        },
      },
    );
    expect(cancelled.tier).toBe("comped");
  });
});

describe("extendComp", () => {
  const now = new Date("2026-10-12T00:00:00.000Z");
  it("forever wins, active comps extend from their end, lapsed comps start from now", () => {
    expect(extendComp({ compedAt: null, compedUntil: null }, null, now)).toBeNull();
    expect(
      extendComp({ compedAt: "2026-01-01T00:00:00.000Z", compedUntil: null }, 3, now),
    ).toBeNull();
    expect(
      extendComp(
        { compedAt: "2026-10-01T00:00:00.000Z", compedUntil: "2026-12-01T00:00:00.000Z" },
        1,
        now,
      ),
    ).toBe("2027-01-01T00:00:00.000Z");
    expect(
      extendComp(
        { compedAt: "2026-01-01T00:00:00.000Z", compedUntil: "2026-02-01T00:00:00.000Z" },
        1,
        now,
      ),
    ).toBe("2026-11-12T00:00:00.000Z");
  });
});
