import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { ArrowRight, Check, Circle } from "lucide-react";

/**
 * A static before/after: what you type, and what Sifty makes of it.
 * Intentionally not the real task components — those change with the app;
 * this is a picture of the idea, built from tokens only.
 */
export function SiftIllustration() {
  return (
    <figure
      aria-label="Example: a rough note on the left becomes a prioritized, broken-down task on the right"
      className="grid gap-3 md:grid-cols-[1fr_auto_1.25fr] md:items-stretch"
    >
      <div className="surface-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-eyebrow">You type</span>
          <span className="flex items-center gap-1 text-[11.5px] text-[var(--fg-subtle)]">
            <Kbd>c</Kbd> to capture
          </span>
        </div>
        <p className="text-[15px] leading-[1.5] text-[var(--fg)]">
          landlord about the kitchen leak before friday, he never answers email
        </p>
        <div className="mt-auto flex items-center gap-1.5 text-[12px] text-[var(--fg-subtle)]">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
          <span>and move on</span>
        </div>
      </div>

      <div className="hidden md:flex items-center justify-center text-[var(--fg-subtle)]">
        <ArrowRight size={18} aria-hidden="true" />
      </div>

      <div className="surface-card p-4 flex flex-col gap-3 border-[var(--ai)]/30">
        <div className="flex items-center justify-between">
          <span className="text-eyebrow">Sifty fills in</span>
          <Badge tone="mist">sifted</Badge>
        </div>
        <div>
          <div className="text-[15px] text-[var(--fg)]">
            Call the landlord about the kitchen leak
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="ember">Urgent</Badge>
            <Badge tone="sand">Home</Badge>
            <Badge tone="neutral">Due Fri</Badge>
          </div>
        </div>
        <ul className="flex flex-col gap-1.5 text-[13.5px] text-[var(--fg-muted)]">
          <li className="flex items-center gap-2">
            <Check size={14} className="text-[var(--done)]" aria-hidden="true" />
            <span>Find the landlord's phone number in last lease email</span>
          </li>
          <li className="flex items-center gap-2">
            <Check size={14} className="text-[var(--done)]" aria-hidden="true" />
            <span>Draft what to say: leak since Tue, photos attached</span>
          </li>
          <li className="flex items-center gap-2">
            <Circle size={14} className="text-[var(--fg-subtle)]" aria-hidden="true" />
            <span>Call Thu 9am, before he leaves for the day</span>
          </li>
        </ul>
        <p className="mt-auto text-[12.5px] leading-[1.5] text-[var(--fg-subtle)]">
          Why urgent: active water damage and a hard deadline. Phone over email because you said he
          never answers.
        </p>
      </div>
    </figure>
  );
}
