"use client";

import { setLocale } from "@/lib/i18n/actions";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils/cn";
import { Check, Languages } from "lucide-react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * English / Español. The choice is stored in a cookie by a server action,
 * then a refresh re-renders the server tree in the new language without a
 * full reload, so local state (open sheets, drafts) survives the switch.
 */
export function LanguagePicker() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [chosen, setChosen] = React.useState<Locale>(locale);
  const active = pending ? chosen : locale;

  const choose = (next: Locale) => {
    if (next === active) return;
    setChosen(next);
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  };

  return (
    <div className="grid grid-cols-2 gap-2 max-w-md">
      {LOCALES.map((option) => {
        const isActive = option === active;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            onClick={() => choose(option)}
            aria-pressed={isActive}
            disabled={pending}
            data-testid={`locale-option-${option}`}
            className={cn(
              "rounded-[var(--radius-md)] border px-3 py-3",
              "flex flex-col items-start gap-2 text-left transition-colors",
              "disabled:cursor-progress",
              isActive
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
            )}
          >
            <Languages
              size={16}
              className={isActive ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"}
            />
            <span className="flex items-center gap-1.5 text-[13.5px] text-[var(--fg)]">
              {LOCALE_NAMES[option]}
              {isActive ? <Check size={12} className="text-[var(--accent)]" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
