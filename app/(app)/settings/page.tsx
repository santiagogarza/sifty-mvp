"use client";

import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { useTheme } from "@/components/app-shell/theme-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from "@/lib/ai/models";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { Check, Cpu, Monitor, Moon, Sun } from "lucide-react";
import * as React from "react";

const CREATOR_EMAIL = "s.gonzalez.garza@gmail.com";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const preferredModelId = useStore((s) => s.preferredModelId);
  const setPreferredModelId = useStore((s) => s.setPreferredModelId);
  const hydrated = useStore((s) => s.hydrated);
  const activeModelId = hydrated ? preferredModelId : DEFAULT_MODEL_ID;
  const activeModel = MODEL_OPTIONS.find((m) => m.id === activeModelId) ?? MODEL_OPTIONS[0]!;

  return (
    <PageShell title="Settings">
      <PageHeader
        title="Settings"
        description="A small set of controls. The rest of Sifty stays out of your way."
      />

      <SectionCard
        title="Appearance"
        description="Sifty looks best in the dark, but it's your call."
      >
        <div className="grid grid-cols-3 gap-2 max-w-md">
          {(
            [
              { key: "system", label: "System", icon: Monitor },
              { key: "light", label: "Light", icon: Sun },
              { key: "dark", label: "Dark", icon: Moon },
            ] as const
          ).map((opt) => {
            const Icon = opt.icon;
            const active = theme === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setTheme(opt.key)}
                className={cn(
                  "rounded-[var(--radius-md)] border px-3 py-3",
                  "flex flex-col items-start gap-2 text-left transition-colors",
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
                )}
              >
                <Icon
                  size={16}
                  className={active ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"}
                />
                <span className="flex items-center gap-1.5 text-[13.5px] text-[var(--fg)]">
                  {opt.label}
                  {active ? <Check size={12} className="text-[var(--accent)]" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Account"
        description="Sifty's MVP runs without sign-in. The creator account is permanently free; everyone else gets a 30-day trial."
      >
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13.5px] text-[var(--fg)]">{CREATOR_EMAIL}</div>
              <div className="text-[12px] text-[var(--fg-muted)] mt-0.5">
                Creator — unlimited AI usage
              </div>
            </div>
            <Badge tone="ember">Creator</Badge>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="AI model"
        description="Triage runs through the AI Gateway. Pick a model that matches your trade-off between speed and depth. Edits you make are protected from being overwritten."
      >
        <div className="grid sm:grid-cols-2 gap-2 max-w-2xl">
          {MODEL_OPTIONS.map((m) => {
            const active = m.id === activeModelId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setPreferredModelId(m.id)}
                aria-pressed={active}
                data-testid={`model-option-${m.id}`}
                className={cn(
                  "rounded-[var(--radius-md)] border px-3.5 py-3 text-left transition-colors",
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Cpu
                      size={14}
                      className={active ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"}
                    />
                    <div className="text-[13.5px] text-[var(--fg)]">{m.label}</div>
                  </div>
                  <Badge tone={m.provider === "anthropic" ? "ember" : "mist"}>{m.provider}</Badge>
                </div>
                <div className="text-[12px] text-[var(--fg-muted)] mt-1.5 leading-[1.5]">
                  {m.description}
                </div>
                <div className="text-[11px] text-[var(--fg-subtle)] mt-1">{m.gatewaySlug}</div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="AI behavior"
        description="Provider keys come from the server environment (AI_GATEWAY_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY). Sifty never asks for a key in the browser."
      >
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <Stat label="Prompt version" value="triage.v1" />
          <Stat label="Active model" value={activeModel.label} />
          <Stat label="Min visible delay" value="450 ms" />
          <Stat label="Edited fields protected" value="Yes" />
        </div>
      </SectionCard>

      <SectionCard
        title="Data"
        description="Tasks and labels persist locally in this browser. Clearing site data resets the demo."
      >
        <Button
          variant="ghost"
          onClick={() => {
            if (confirm("Reset all local Sifty data? This cannot be undone.")) {
              window.localStorage.removeItem("sifty-store-v1");
              window.location.reload();
            }
          }}
        >
          Reset local data
        </Button>
      </SectionCard>
    </PageShell>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="text-eyebrow mb-1.5">{title}</div>
      {description ? (
        <p className="text-[13px] text-[var(--fg-muted)] leading-[1.5] mb-3 max-w-prose">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
      <div className="text-eyebrow">{label}</div>
      <div className="text-[13.5px] text-[var(--fg)] mt-0.5">{value}</div>
    </div>
  );
}
