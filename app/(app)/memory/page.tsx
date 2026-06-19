"use client";

import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { Memory } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { id as makeId } from "@/lib/utils/ids";
import { Brain, Pin, Plus, Trash2 } from "lucide-react";
import * as React from "react";

/**
 * Memory & Preferences page.
 *
 * The user must always be able to see and correct what Sifty believes about
 * them. Memory is short, editable, and pinnable. Pinned memories are the
 * ones the AI may include in triage context.
 */
export default function MemoryPage() {
  const memories = useStore((s) => s.memories);
  const hydrated = useStore((s) => s.hydrated);

  return (
    <PageShell title="Memory">
      <PageHeader
        eyebrow="Sifty's memory of you"
        title="What Sifty assumes"
        description="Pinned notes are included in AI context when triaging. Anything here is editable. Sifty never invents memory — you write it."
      />
      {hydrated ? <MemoryList memories={memories} /> : null}
    </PageShell>
  );
}

function MemoryList({ memories }: { memories: Memory[] }) {
  const [draft, setDraft] = React.useState("");
  const set = useStore.setState;

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    const m: Memory = {
      id: makeId("mem"),
      text,
      kind: "preference",
      pinned: false,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ ...s, memories: [m, ...s.memories] }));
    setDraft("");
  };

  const update = (id: string, patch: Partial<Memory>) => {
    set((s) => ({
      ...s,
      memories: s.memories.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  };

  const remove = (id: string) => {
    set((s) => ({ ...s, memories: s.memories.filter((m) => m.id !== id) }));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="surface-card p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="A preference, a fact, or a piece of context Sifty should remember…"
          className="bg-transparent border-transparent text-[14px]"
          rows={2}
        />
        <div className="flex items-center justify-end mt-2">
          <Button variant="primary" size="sm" onClick={add} disabled={!draft.trim()}>
            <Plus size={13} /> Add memory
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {memories.length === 0 ? (
          <div className="text-[13px] text-[var(--fg-subtle)] py-6 text-center">
            No memories yet.
          </div>
        ) : null}
        {memories.map((m) => (
          <div
            key={m.id}
            className={cn(
              "group rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]",
              "px-3.5 py-3 flex items-start gap-3 transition-colors",
              m.pinned && "border-[var(--accent)]/40",
            )}
          >
            <Brain size={14} className="text-[var(--ai)] mt-0.5" />
            <textarea
              value={m.text}
              onChange={(e) => update(m.id, { text: e.target.value })}
              className="flex-1 bg-transparent text-[13.5px] leading-[1.5] text-[var(--fg)] focus:outline-none resize-none"
              rows={Math.min(5, Math.max(1, m.text.split("\n").length))}
            />
            <div className="flex items-center gap-1 shrink-0">
              <Badge
                tone={m.kind === "preference" ? "ember" : m.kind === "fact" ? "mist" : "neutral"}
              >
                {m.kind}
              </Badge>
              <button
                type="button"
                onClick={() => update(m.id, { pinned: !m.pinned })}
                className={cn(
                  "size-7 inline-flex items-center justify-center rounded-[var(--radius-sm)]",
                  "text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
                  m.pinned && "text-[var(--accent)]",
                )}
                aria-label={m.pinned ? "Unpin" : "Pin"}
              >
                <Pin size={12} />
              </button>
              <button
                type="button"
                onClick={() => remove(m.id)}
                className="size-7 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--warn)]"
                aria-label="Delete memory"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
