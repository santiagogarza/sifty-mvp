import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { ArrowRight, Check, Circle } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A static before/after: what you type, and what Sifty makes of it.
 * Intentionally not the real task components — those change with the app;
 * this is a picture of the idea, built from tokens only.
 */
export function SiftIllustration() {
  const t = useTranslations("marketing.illustration");
  return (
    <figure
      aria-label={t("label")}
      className="grid gap-3 md:grid-cols-[1fr_auto_1.25fr] md:items-stretch"
    >
      <div className="surface-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-eyebrow">{t("youType")}</span>
          <span className="flex items-center gap-1 text-[11.5px] text-[var(--fg-subtle)]">
            {t.rich("toCapture", { key: (chunks) => <Kbd>{chunks}</Kbd> })}
          </span>
        </div>
        <p className="text-[15px] leading-[1.5] text-[var(--fg)]">{t("rawNote")}</p>
        <div className="mt-auto flex items-center gap-1.5 text-[12px] text-[var(--fg-subtle)]">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
          <span>{t("moveOn")}</span>
        </div>
      </div>

      <div className="hidden md:flex items-center justify-center text-[var(--fg-subtle)]">
        <ArrowRight size={18} aria-hidden="true" />
      </div>

      <div className="surface-card p-4 flex flex-col gap-3 border-[var(--ai)]/30">
        <div className="flex items-center justify-between">
          <span className="text-eyebrow">{t("siftyFillsIn")}</span>
          <Badge tone="mist">{t("sifted")}</Badge>
        </div>
        <div>
          <div className="text-[15px] text-[var(--fg)]">{t("title")}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="ember">{t("urgent")}</Badge>
            <Badge tone="sand">{t("home")}</Badge>
            <Badge tone="neutral">{t("due")}</Badge>
          </div>
        </div>
        <ul className="flex flex-col gap-1.5 text-[13.5px] text-[var(--fg-muted)]">
          <li className="flex items-center gap-2">
            <Check size={14} className="text-[var(--done)]" aria-hidden="true" />
            <span>{t("step1")}</span>
          </li>
          <li className="flex items-center gap-2">
            <Check size={14} className="text-[var(--done)]" aria-hidden="true" />
            <span>{t("step2")}</span>
          </li>
          <li className="flex items-center gap-2">
            <Circle size={14} className="text-[var(--fg-subtle)]" aria-hidden="true" />
            <span>{t("step3")}</span>
          </li>
        </ul>
        <p className="mt-auto text-[12.5px] leading-[1.5] text-[var(--fg-subtle)]">{t("why")}</p>
      </div>
    </figure>
  );
}
