// @vitest-environment jsdom
import { PaymentFailedBanner } from "@/components/billing/payment-failed-banner";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

describe("PaymentFailedBanner", () => {
  it("names the grace deadline and links to billing", () => {
    render(
      createElement(PaymentFailedBanner, {
        problem: { kind: "grace", graceEndsAt: "2026-10-19T12:00:00.000Z" },
      }),
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/didn't go through/);
    expect(alert).toHaveTextContent(/by October 19 to keep Pro/);
    expect(screen.getByRole("link", { name: /update payment method/i })).toHaveAttribute(
      "href",
      "/settings/billing",
    );
  });

  it("names the UTC calendar day, matching the email, whatever the local timezone", () => {
    // 03:00Z on the 19th is still the 18th in the Americas; the email says the 19th.
    render(
      createElement(PaymentFailedBanner, {
        problem: { kind: "grace", graceEndsAt: "2026-10-19T03:00:00.000Z" },
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/by October 19 to keep Pro/);
  });

  it("says Pro is paused once the grace period lapsed", () => {
    render(createElement(PaymentFailedBanner, { problem: { kind: "lapsed" } }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Pro is paused/);
  });
});
