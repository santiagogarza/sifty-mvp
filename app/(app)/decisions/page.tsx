"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { DecisionsEmptyState } from "@/components/decisions/decisions-empty-state";
import { DecisionsInbox } from "@/components/decisions/decisions-inbox";
import { toast } from "@/components/ui/toast";
import { useDecisionsStore } from "@/lib/decisions/client";
import { EMPTY_WAITING_LINE, countByKind, describeWaiting } from "@/lib/decisions/copy";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

/**
 * `/decisions` — one inbox for everything waiting on the human.
 *
 * v1 carries clarifying questions from the sift. Memory proposals (2.4)
 * and approvals / draft reviews (Phase 3) land in the same list with the
 * same answer / dismiss contract.
 */
export default function DecisionsPage() {
  return (
    <PageShell title="Decisions">
      <React.Suspense fallback={null}>
        <DecisionsView />
      </React.Suspense>
    </PageShell>
  );
}

/** What `/api/decisions/link` says about the tap that brought the user here. */
const LINK_MESSAGES: Record<string, string> = {
  answered: "Done — Sifty has your answer.",
  approved: "Approved — Sifty is on it.",
  rejected: "Rejected — Sifty stopped.",
  dismissed: "Dismissed.",
  used: "That question was already answered.",
  gone: "That question is no longer open.",
  busy: "Too many taps in a minute — the question is still open below.",
  expired: "That link expired. Anything still open is listed here.",
  invalid: "That link is not valid. Anything still open is listed here.",
  malformed: "That link is not valid. Anything still open is listed here.",
};

function DecisionsView() {
  const { serverReady } = useFrame();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const decisions = useDecisionsStore((s) => s.decisions);
  const tasks = useDecisionsStore((s) => s.tasks);
  const loaded = useDecisionsStore((s) => s.loaded);
  const error = useDecisionsStore((s) => s.error);
  const refresh = useDecisionsStore((s) => s.refresh);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // A one-tap link redirects here with `?link=`; say what happened once,
  // then drop the param so a reload does not repeat it.
  const link = search.get("link");
  React.useEffect(() => {
    if (!link) return;
    const message = LINK_MESSAGES[link];
    if (message) toast(message);
    const params = new URLSearchParams(search.toString());
    params.delete("link");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [link, pathname, router, search]);

  const focusId = search.get("focus");
  const count = decisions.length;
  const byKind = countByKind(decisions);

  return (
    <>
      <PageHeader
        eyebrow="Waiting on you"
        title="Decisions"
        description={count === 0 ? EMPTY_WAITING_LINE : describeWaiting(byKind)}
      />
      {error && loaded ? (
        <p role="status" className="mb-3 text-[13px] text-[var(--warn)]">
          Could not load decisions — {error}
        </p>
      ) : null}
      {loaded && serverReady ? (
        <DecisionsInbox
          decisions={decisions}
          tasks={tasks}
          focusId={focusId}
          emptyState={<DecisionsEmptyState />}
        />
      ) : null}
    </>
  );
}
