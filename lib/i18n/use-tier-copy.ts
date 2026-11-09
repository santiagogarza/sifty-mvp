import type { Entitlement, Tier } from "@/lib/domain/types";
import { FREE_SIFTS_PER_DAY } from "@/lib/entitlements/entitlements";
import { useFormatter, useTranslations } from "next-intl";

/**
 * Localized `tierLabel` / `tierSummary` for client components. Billing days
 * are pinned to UTC for the same reason as `formatBillingDay`: server render,
 * hydration, and email must all name the same day.
 */
export function useTierCopy() {
  const t = useTranslations("common.tiers");
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { month: "long", day: "numeric", timeZone: "UTC" });

  return {
    label: (tier: Tier) => t(`label.${tier}`),
    summary: (ent: Pick<Entitlement, "tier" | "trialEndsAt" | "compedUntil">) => {
      switch (ent.tier) {
        case "creator":
          return t("summary.creator");
        case "comped":
          return ent.compedUntil
            ? t("summary.compedUntil", { date: day(ent.compedUntil) })
            : t("summary.comped");
        case "pro":
          return t("summary.pro");
        case "trialing":
          return ent.trialEndsAt
            ? t("summary.trialingUntil", { date: day(ent.trialEndsAt) })
            : t("summary.trialing");
        case "free":
          return t("summary.free", { count: FREE_SIFTS_PER_DAY });
      }
    },
  };
}
