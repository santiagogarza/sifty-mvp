import type { NotificationPreferencesInput } from "@/lib/db/repos/types";
import { setEmailProviderForTesting } from "@/lib/email";
import type { EmailMessage, EmailProvider } from "@/lib/email/types";
import { DEFAULT_PREFERENCES } from "@/lib/notifications/preferences";
import { setPushTransportForTesting } from "@/lib/notifications/push";
import { sendDueDigests } from "@/lib/notifications/send-digests";
import { verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe";
import { setErrorSink } from "@/lib/observability/report-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestOutbox, getTestRepos } from "../setup";

// Monday 2026-10-12 07:00 in Ljubljana.
const SEVEN_LJU = new Date("2026-10-12T05:00:00Z");
const APP = "https://sifty.example";

async function seedUser(
  email: string,
  prefs: Partial<NotificationPreferencesInput> | null = {},
  tasks: Array<{ text: string; due?: string | null; lifecycle?: "inbox" | "active" | "done" }> = [
    { text: "Pay the invoice", due: "2026-10-09" },
  ],
) {
  const repos = getTestRepos();
  const user = await repos.users.create({ email, displayName: "Ana", isCreator: false });
  if (prefs) {
    await repos.notificationPreferences.upsert(user.id, {
      ...DEFAULT_PREFERENCES,
      timezone: "Europe/Ljubljana",
      ...prefs,
    });
  }
  for (const t of tasks) {
    const created = await repos.tasks.create(user.id, { sourceText: t.text, sourceContext: null });
    await repos.tasks.update(user.id, created.id, {
      due: t.due ?? null,
      lifecycle: t.lifecycle ?? "active",
    });
  }
  return user;
}

describe("sendDueDigests", () => {
  beforeEach(() => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");
    setErrorSink(() => undefined);
  });
  afterEach(() => {
    setPushTransportForTesting(null);
    vi.unstubAllEnvs();
  });

  it("sends one morning plan per user and never again for the same day", async () => {
    const user = await seedUser("ana@example.com");
    const first = await sendDueDigests(getTestRepos(), { now: SEVEN_LJU, appUrl: APP });
    expect(first).toMatchObject({ users: 1, sent: 1, skipped: 0, failed: 0 });
    expect(first.byKind.morning_plan).toEqual({ sent: 1, skipped: 0, failed: 0 });

    const outbox = getTestOutbox().outbox;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      to: "ana@example.com",
      category: "notification",
      idempotencyKey: `digest:morning_plan:${user.id}:2026-10-12`,
    });
    expect(outbox[0]!.subject).toContain("1 overdue");
    expect(outbox[0]!.text).toContain("Pay the invoice");
    expect(outbox[0]!.text).toContain(`${APP}/today`);

    // The unsubscribe header carries a token that resolves to this user.
    const header = outbox[0]!.headers?.["List-Unsubscribe"] ?? "";
    const token = new URL(header.slice(1, -1)).searchParams.get("token");
    expect(verifyUnsubscribeToken(token)).toBe(user.id);

    // Rerun one hour later (still in the window): nothing new goes out.
    const rerun = await sendDueDigests(getTestRepos(), {
      now: new Date("2026-10-12T06:00:00Z"),
      appUrl: APP,
    });
    expect(rerun).toMatchObject({ users: 1, sent: 0, skipped: 1, failed: 0 });
    expect(getTestOutbox().outbox).toHaveLength(1);

    const ledger = await getTestRepos().notificationSends.listForUser(user.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      kind: "morning_plan",
      channel: "email",
      periodKey: "2026-10-12",
      status: "sent",
    });
    expect(ledger[0]!.sentAt).not.toBeNull();

    // The next day is a new period.
    const tomorrow = await sendDueDigests(getTestRepos(), {
      now: new Date("2026-10-13T05:00:00Z"),
      appUrl: APP,
    });
    expect(tomorrow.sent).toBe(1);
    expect(getTestOutbox().outbox).toHaveLength(2);
  });

  it("does nothing outside the send window, for users without saved preferences, or with every channel off", async () => {
    await seedUser("unsaved@example.com", null);
    await seedUser("silent@example.com", { emailEnabled: false, pushEnabled: false });
    await seedUser("early@example.com", { morningPlanHour: 9 });
    const result = await sendDueDigests(getTestRepos(), { now: SEVEN_LJU, appUrl: APP });
    expect(result).toMatchObject({ users: 2, sent: 0, skipped: 0, failed: 0 });
    expect(getTestOutbox().outbox).toHaveLength(0);
  });

  it("respects quiet hours by deferring, and records a quiet morning as skipped", async () => {
    await seedUser("quiet@example.com", { quietHoursStart: 22, quietHoursEnd: 8 });
    const empty = await seedUser("empty@example.com", {}, []);

    const atSeven = await sendDueDigests(getTestRepos(), { now: SEVEN_LJU, appUrl: APP });
    // quiet@ is deferred to 8; empty@ is due but has nothing to say.
    expect(atSeven).toMatchObject({ users: 2, sent: 0, skipped: 1, failed: 0 });
    expect(getTestOutbox().outbox).toHaveLength(0);
    const emptyLedger = await getTestRepos().notificationSends.listForUser(empty.id);
    expect(emptyLedger[0]).toMatchObject({ status: "skipped", kind: "morning_plan" });

    const atEight = await sendDueDigests(getTestRepos(), {
      now: new Date("2026-10-12T06:00:00Z"),
      appUrl: APP,
    });
    expect(atEight.sent).toBe(1);
    expect(getTestOutbox().outbox[0]!.to).toBe("quiet@example.com");
  });

  it("sends through each enabled channel independently and treats unconfigured push as skipped", async () => {
    const user = await seedUser("both@example.com", { pushEnabled: true });
    await getTestRepos().pushSubscriptions.upsert(user.id, {
      endpoint: "https://push.example/1",
      p256dh: "p",
      auth: "a",
      userAgent: null,
    });
    // No VAPID keys: push is a no-op, email still goes out.
    const noKeys = await sendDueDigests(getTestRepos(), { now: SEVEN_LJU, appUrl: APP });
    expect(noKeys).toMatchObject({ sent: 1, skipped: 1, failed: 0 });
    const ledger = await getTestRepos().notificationSends.listForUser(user.id);
    expect(ledger.map((l) => [l.channel, l.status]).sort()).toEqual([
      ["email", "sent"],
      ["push", "skipped"],
    ]);

    // With keys, a fresh period delivers both.
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.com");
    const pushed: string[] = [];
    setPushTransportForTesting(async (_sub, payload) => {
      pushed.push(payload.body);
      return "delivered";
    });
    const withKeys = await sendDueDigests(getTestRepos(), {
      now: new Date("2026-10-13T05:00:00Z"),
      appUrl: APP,
    });
    expect(withKeys).toMatchObject({ sent: 2, skipped: 0, failed: 0 });
    expect(pushed).toEqual(["1 overdue. First up: Pay the invoice"]);
  });

  it("records a failed send as failed, reports it, and does not retry within the period", async () => {
    await seedUser("fail@example.com");
    const reported: unknown[] = [];
    setErrorSink((err) => {
      reported.push(err);
    });
    let attempts = 0;
    const failing: EmailProvider = {
      name: "console",
      async send(_message: EmailMessage) {
        attempts += 1;
        throw new Error("smtp down");
      },
    };
    setEmailProviderForTesting(failing);

    const run = await sendDueDigests(getTestRepos(), { now: SEVEN_LJU, appUrl: APP });
    expect(run).toMatchObject({ sent: 0, skipped: 0, failed: 1 });
    expect(attempts).toBe(1);
    // sendEmail reports once, the digest runner once more with the digest context.
    expect(reported.length).toBeGreaterThanOrEqual(1);

    const rerun = await sendDueDigests(getTestRepos(), { now: SEVEN_LJU, appUrl: APP });
    expect(rerun).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
    expect(attempts).toBe(1);
  });

  it("adds the weekly review on the chosen day with its own ledger period", async () => {
    // Sunday 2026-10-11 07:00 Ljubljana.
    const sunday = new Date("2026-10-11T05:00:00Z");
    const user = await seedUser("weekly@example.com", { weeklyReviewDay: 0 });
    const result = await sendDueDigests(getTestRepos(), { now: sunday, appUrl: APP });
    expect(result.byKind.morning_plan.sent).toBe(1);
    expect(result.byKind.weekly_review.sent).toBe(1);
    const subjects = getTestOutbox().outbox.map((m) => m.subject);
    expect(subjects.some((s) => s.startsWith("Your week in review"))).toBe(true);
    const ledger = await getTestRepos().notificationSends.listForUser(user.id);
    expect(ledger.map((l) => l.periodKey).sort()).toEqual(["2026-10-11", "2026-W41"]);
  });

  it("walks users in pages", async () => {
    for (let i = 0; i < 7; i += 1) await seedUser(`u${i}@example.com`);
    const result = await sendDueDigests(getTestRepos(), {
      now: SEVEN_LJU,
      appUrl: APP,
      pageSize: 3,
    });
    expect(result).toMatchObject({ users: 7, sent: 7 });
    expect(getTestOutbox().outbox).toHaveLength(7);
  });
});
