import {
  TEMPLATE_NAMES,
  type TemplateName,
  type TemplateProps,
  renderEmail,
  sendTemplate,
} from "@/lib/email/templates";
import type { DigestTask } from "@/lib/notifications/digest";
import { describe, expect, it } from "vitest";
import { getTestOutbox } from "../setup";

const digestTask = (id: string, over: Partial<DigestTask> = {}): DigestTask => ({
  id,
  title: `Task ${id}`,
  nextAction: null,
  lifecycle: "active",
  effort: "small",
  priorityBucket: "schedule",
  due: null,
  dueState: null,
  url: `https://sifty.example/today?task=${id}`,
  ...over,
});

/**
 * Every template renders to HTML + plain text, carries its call-to-action
 * link in both, and gets the unsubscribe footer if and only if it is
 * non-transactional.
 */

const APP = "https://sifty.example";

const fixtures: { [K in TemplateName]: { props: TemplateProps<K>; link: string } } = {
  "verify-email": {
    props: { name: "Ana", verifyUrl: `${APP}/api/auth/verify-email?token=abc123` },
    link: `${APP}/api/auth/verify-email?token=abc123`,
  },
  "password-reset": {
    props: { name: "Ana", resetUrl: `${APP}/reset-password?token=r3set` },
    link: `${APP}/reset-password?token=r3set`,
  },
  "magic-link": {
    props: { magicLinkUrl: `${APP}/api/auth/magic-link/verify?token=m4gic` },
    link: `${APP}/api/auth/magic-link/verify?token=m4gic`,
  },
  welcome: {
    props: { name: "Ana", appUrl: APP, unsubscribeUrl: `${APP}/settings/notifications` },
    link: `${APP}/today`,
  },
  "digest-morning-plan": {
    props: {
      plan: {
        kind: "morning_plan",
        name: "Ana",
        dateKey: "2026-10-12",
        dateLabel: "Monday, October 12",
        overdue: [digestTask("t1", { due: "2026-10-09", dueState: "overdue" })],
        dueToday: [digestTask("t2", { due: "2026-10-12", dueState: "today" })],
        today: [digestTask("t3", { priorityBucket: "do_now", nextAction: "Call Ben" })],
        focus: [digestTask("t4")],
        inboxCount: 2,
        away: null,
        appUrl: APP,
      },
      unsubscribeUrl: `${APP}/api/notifications/unsubscribe?token=abc`,
      settingsUrl: `${APP}/settings/notifications`,
    },
    link: `${APP}/today`,
  },
  "digest-due-reminder": {
    props: {
      reminder: {
        kind: "due_reminder",
        name: "Ana",
        dateKey: "2026-10-12",
        overdue: [digestTask("t1", { due: "2026-10-09", dueState: "overdue" })],
        dueToday: [digestTask("t2", { due: "2026-10-12", dueState: "today" })],
        appUrl: APP,
      },
      unsubscribeUrl: `${APP}/api/notifications/unsubscribe?token=abc`,
      settingsUrl: `${APP}/settings/notifications`,
    },
    link: `${APP}/today`,
  },
  "digest-weekly-review": {
    props: {
      review: {
        kind: "weekly_review",
        name: "Ana",
        weekKey: "2026-W42",
        rangeLabel: "Oct 5 – Oct 11",
        completed: [digestTask("t5", { lifecycle: "done" })],
        completedCount: 1,
        overdue: [digestTask("t1", { due: "2026-10-09", dueState: "overdue" })],
        upcoming: [digestTask("t6", { due: "2026-10-15", dueState: "upcoming" })],
        inboxCount: 3,
        focusCount: 2,
        waitingCount: 1,
        appUrl: APP,
      },
      unsubscribeUrl: `${APP}/api/notifications/unsubscribe?token=abc`,
      settingsUrl: `${APP}/settings/notifications`,
    },
    link: `${APP}/inbox`,
  },
  "invite-redeemed": {
    props: { name: "Ana", grant: "Sifty Pro", expiresAt: "2027-01-15T00:00:00.000Z", appUrl: APP },
    link: `${APP}/settings/billing`,
  },
  "payment-failed": {
    props: {
      name: "Ana",
      amount: "$10.00",
      retryUntil: "2026-11-01T00:00:00.000Z",
      billingUrl: `${APP}/settings/billing`,
    },
    link: `${APP}/settings/billing`,
  },
};

describe("email templates", () => {
  it("has a fixture for every registered template", () => {
    expect(Object.keys(fixtures).sort()).toEqual([...TEMPLATE_NAMES].sort());
  });

  for (const name of TEMPLATE_NAMES) {
    it(`renders ${name} with subject, html, text, and the action link`, async () => {
      const { props, link } = fixtures[name];
      const rendered = await renderEmail(name, props as never);

      expect(rendered.subject.length).toBeGreaterThan(5);
      expect(rendered.html).toContain("<!DOCTYPE html");
      expect(rendered.html).toContain("Sifty");
      expect(rendered.html).toContain(`href="${link}"`);
      expect(rendered.text).toContain(link);
      expect(rendered.text).not.toMatch(/<[a-z][\s\S]*>/i);

      if (rendered.category === "notification") {
        expect(rendered.html).toContain("unsubscribe");
        expect(rendered.headers["List-Unsubscribe"]).toMatch(/^<https?:\/\//);
        expect(rendered.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      } else {
        expect(rendered.html.toLowerCase()).not.toContain("unsubscribe");
        expect(rendered.headers).toEqual({});
      }
    });
  }

  it("marks welcome and the digests as non-transactional", async () => {
    const categories = Object.fromEntries(
      await Promise.all(
        TEMPLATE_NAMES.map(async (name) => [
          name,
          (await renderEmail(name, fixtures[name].props as never)).category,
        ]),
      ),
    );
    expect(categories).toEqual({
      "verify-email": "transactional",
      "password-reset": "transactional",
      "magic-link": "transactional",
      welcome: "notification",
      "invite-redeemed": "transactional",
      "payment-failed": "transactional",
      "digest-morning-plan": "notification",
      "digest-due-reminder": "notification",
      "digest-weekly-review": "notification",
    });
  });

  it("digest emails list every task with its deep link and the overdue marker", async () => {
    const plan = await renderEmail("digest-morning-plan", fixtures["digest-morning-plan"].props);
    expect(plan.subject).toBe("Your plan for Monday, October 12 — 1 overdue");
    expect(plan.text).toContain("Task t1");
    expect(plan.text).toContain("overdue since Oct 9");
    expect(plan.text).toContain("Call Ben");
    expect(plan.text).toContain("2 captures are waiting in Inbox");
    expect(plan.html).toContain(`href="${APP}/today?task=t3"`);
    expect(plan.html).not.toContain("while you were away");

    const nudge = await renderEmail("digest-due-reminder", fixtures["digest-due-reminder"].props);
    expect(nudge.subject).toBe("1 still due today, 1 overdue");

    const review = await renderEmail(
      "digest-weekly-review",
      fixtures["digest-weekly-review"].props,
    );
    expect(review.subject).toBe("Your week in review — 1 done, 1 coming up");
    expect(review.text).toContain("Inbox 3 · Focus 2 · Waiting on 1");
    expect(review.text).toContain("1 task finished, 1 slipped.");
    expect(review.text).toContain("Oct 15");

    const idle = await renderEmail("digest-weekly-review", {
      ...fixtures["digest-weekly-review"].props,
      review: {
        ...fixtures["digest-weekly-review"].props.review,
        completed: [],
        completedCount: 0,
      },
    });
    expect(idle.text).toContain("Nothing finished, 1 slipped.");
  });

  it("refuses to render a notification without an unsubscribe link", async () => {
    await expect(
      renderEmail("welcome", { name: "Ana", appUrl: APP, unsubscribeUrl: "" }),
    ).rejects.toThrow(/unsubscribeUrl/);
  });

  it("interpolates props into subject and body", async () => {
    const rendered = await renderEmail("invite-redeemed", fixtures["invite-redeemed"].props);
    expect(rendered.subject).toBe("Your invite code unlocked Sifty Pro");
    expect(rendered.text).toContain("until January 15, 2027");

    const forever = await renderEmail("invite-redeemed", {
      ...fixtures["invite-redeemed"].props,
      expiresAt: null,
    });
    expect(forever.text).toContain("with no end date");

    const failed = await renderEmail("payment-failed", fixtures["payment-failed"].props);
    expect(failed.subject).toBe("Your Sifty payment didn't go through");
    expect(failed.text).toContain("$10.00");
    expect(failed.text).toContain("before November 1");
    expect(failed.text).toContain("Nothing changes yet");

    const paused = await renderEmail("payment-failed", {
      ...fixtures["payment-failed"].props,
      retryUntil: null,
      accessPaused: true,
    });
    expect(paused.subject).toMatch(/Pro is paused/);
    expect(paused.text).toContain("Pro is paused");
    expect(paused.text).not.toContain("Nothing changes yet");
    expect(paused.text).toContain(fixtures["payment-failed"].link);
  });

  it("sendTemplate delivers through the configured provider with headers", async () => {
    const sent = await sendTemplate("welcome", {
      to: "ana@example.com",
      props: fixtures.welcome.props,
      idempotencyKey: "welcome:user_1",
    });
    expect(sent.provider).toBe("console");

    const outbox = getTestOutbox().outbox;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      to: "ana@example.com",
      subject: "Welcome to Sifty",
      category: "notification",
      idempotencyKey: "welcome:user_1",
    });
    expect(outbox[0]!.headers?.["List-Unsubscribe"]).toContain("/settings/notifications");

    await sendTemplate("verify-email", {
      to: "ana@example.com",
      props: fixtures["verify-email"].props,
    });
    expect(getTestOutbox().outbox[1]!.headers).toBeUndefined();
  });
});
