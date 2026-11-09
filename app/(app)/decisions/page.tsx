"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { DecisionsEmptyState } from "@/components/decisions/decisions-empty-state";
import { DecisionsInbox } from "@/components/decisions/decisions-inbox";
import { toast } from "@/components/ui/toast";
import { useDecisionsStore } from "@/lib/decisions/client";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("decisions");
  return (
    <PageShell title={t("title")}>
      <React.Suspense fallback={null}>
        <DecisionsView />
      </React.Suspense>
    </PageShell>
  );
}

/** `?link=` outcomes from `/api/decisions/link`, mapped to `decisions.link.*`. */
const LINK_KEYS = {
  answered: "answered",
  dismissed: "dismissed",
  used: "used",
  gone: "gone",
  busy: "busy",
  expired: "expired",
  invalid: "invalid",
  malformed: "invalid",
} as const;

function DecisionsView() {
  const t = useTranslations("decisions");
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
    const key = Object.hasOwn(LINK_KEYS, link) ? LINK_KEYS[link as keyof typeof LINK_KEYS] : null;
    if (key) toast(t(`link.${key}`));
    const params = new URLSearchParams(search.toString());
    params.delete("link");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [link, pathname, router, search, t]);

  const focusId = search.get("focus");
  const count = decisions.length;
  const proposals = decisions.filter((d) => d.kind === "memory_proposal").length;
  const questions = count - proposals;

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={
          questions && proposals
            ? t("waiting.both", { questions, proposals })
            : questions
              ? t("waiting.questions", { questions })
              : proposals
                ? t("waiting.proposals", { proposals })
                : t("description")
        }
      />
      {error && loaded ? (
        <p role="status" className="mb-3 text-[13px] text-[var(--warn)]">
          {t("loadError", { error })}
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
