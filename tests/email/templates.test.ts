import {
  TEMPLATE_NAMES,
  type TemplateName,
  type TemplateProps,
  renderEmail,
  sendTemplate,
} from "@/lib/email/templates";
import { describe, expect, it } from "vitest";
import { getTestOutbox } from "../setup";

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
    props: { name: "Ana", appUrl: APP, unsubscribeUrl: `${APP}/settings#notifications` },
    link: `${APP}/today`,
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

  it("marks only welcome as non-transactional", async () => {
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
    });
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
    expect(outbox[0]!.headers?.["List-Unsubscribe"]).toContain("/settings#notifications");

    await sendTemplate("verify-email", {
      to: "ana@example.com",
      props: fixtures["verify-email"].props,
    });
    expect(getTestOutbox().outbox[1]!.headers).toBeUndefined();
  });
});
