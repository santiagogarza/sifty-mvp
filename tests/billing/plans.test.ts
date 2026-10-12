import {
  FREE_SIFTS_PER_DAY,
  PLANS,
  PRO_PRICES,
  PRO_TRIAL_DAYS,
  formatPrice,
  yearlySavingsPercent,
} from "@/lib/billing/plans";
import { TRIAL_DAYS } from "@/lib/entitlements/entitlements";
import { describe, expect, it } from "vitest";

describe("plan catalog", () => {
  it("carries the placeholder prices the pricing page and Stripe wiring share", () => {
    expect(PRO_PRICES.monthly.amountCents).toBe(1_000);
    expect(PRO_PRICES.yearly.amountCents).toBe(9_600);
    expect(formatPrice(PRO_PRICES.monthly)).toBe("$10");
    expect(formatPrice(PRO_PRICES.yearly)).toBe("$96");
  });

  it("formats non-whole amounts with cents", () => {
    expect(formatPrice({ cadence: "monthly", amountCents: 1_250, currency: "usd" })).toBe("$12.50");
  });

  it("derives the yearly saving from the two prices", () => {
    expect(yearlySavingsPercent()).toBe(20);
  });

  it("matches decision D3: 5 free sifts a day and the entitlement trial length", () => {
    expect(FREE_SIFTS_PER_DAY).toBe(5);
    expect(PRO_TRIAL_DAYS).toBe(TRIAL_DAYS);
    expect(PLANS.free.features.some((f) => f.label === "5 sifts a day")).toBe(true);
    expect(PLANS.pro.features.some((f) => f.label === "Unlimited sifting")).toBe(true);
  });

  it("labels unshipped Pro features honestly", () => {
    const rolling = PLANS.pro.features
      .filter((f) => f.status === "rolling-out")
      .map((f) => f.label);
    expect(rolling).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/autonomous/i),
        expect.stringMatching(/connector/i),
      ]),
    );
  });
});
