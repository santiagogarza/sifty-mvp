import { WorkflowPing } from "@/components/admin/workflow-ping";
import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import {
  type CostReport,
  type CostReportRow,
  buildCostReport,
  formatTokens,
  formatUsd,
} from "@/lib/ai/cost-report";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

type Translate = Awaited<ReturnType<typeof getTranslations<"account.admin">>>;

export async function generateMetadata() {
  const t = await getTranslations("account.admin");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

/**
 * Creator-only spend dashboard. Non-creators get the 404 page so the route
 * does not advertise itself; signed-out visitors go to sign-in like every
 * other app page.
 */
export default async function AdminCostsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/admin/costs");
  if (!session.user.isCreator) notFound();

  const report = await buildCostReport(getRepos());
  const t = await getTranslations("account.admin");

  return (
    <PageShell title={t("title")}>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description", { days: report.days })}
      />

      <Totals t={t} report={report} />

      <Section title={t("sections.byDay")}>
        <RollupTable t={t} rows={report.byDay} keyHeader={t("columns.day")} />
      </Section>
      <Section title={t("sections.byStage")}>
        <RollupTable t={t} rows={report.byStage} keyHeader={t("columns.stage")} />
      </Section>
      <Section title={t("sections.byModel")}>
        <RollupTable t={t} rows={report.byModel} keyHeader={t("columns.model")} />
      </Section>
      <Section title={t("sections.byAccount")}>
        <RollupTable t={t} rows={report.byUser} keyHeader={t("columns.account")} />
      </Section>

      <Section title={t("sections.workflow")}>
        <WorkflowPing />
      </Section>
    </PageShell>
  );
}

function Totals({ t, report }: { t: Translate; report: CostReport }) {
  const totals = report.totals;
  const stats: Array<[string, string]> = [
    [t("totals.spend"), formatUsd(totals.costCents)],
    [t("totals.runs"), String(totals.runs)],
    [t("totals.failed"), String(totals.failed)],
    [t("totals.tokensIn"), formatTokens(totals.inputTokens)],
    [t("totals.tokensOut"), formatTokens(totals.outputTokens)],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2" data-testid="cost-totals">
      {stats.map(([label, value]) => (
        <div
          key={label}
          className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5"
        >
          <div className="text-eyebrow">{label}</div>
          <div className="text-[18px] text-[var(--fg)] tabular-nums mt-0.5">{value}</div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <div className="text-eyebrow mb-2">{title}</div>
      {children}
    </section>
  );
}

function RollupTable({
  t,
  rows,
  keyHeader,
}: {
  t: Translate;
  rows: CostReportRow[];
  keyHeader: string;
}) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-[var(--fg-muted)]">{t("empty")}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full text-[13px] tabular-nums">
        <thead>
          <tr className="text-left text-[var(--fg-muted)] border-b border-[var(--border)]">
            <th className="font-normal px-3 py-2">{keyHeader}</th>
            <th className="font-normal px-3 py-2 text-right">{t("columns.runs")}</th>
            <th className="font-normal px-3 py-2 text-right">{t("columns.failed")}</th>
            <th className="font-normal px-3 py-2 text-right">{t("columns.in")}</th>
            <th className="font-normal px-3 py-2 text-right">{t("columns.out")}</th>
            <th className="font-normal px-3 py-2 text-right">{t("columns.cost")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-[var(--border)] last:border-b-0">
              <td className="px-3 py-1.5 text-[var(--fg)] max-w-[260px] truncate">{row.label}</td>
              <td className="px-3 py-1.5 text-right">{row.runs}</td>
              <td className="px-3 py-1.5 text-right">
                {row.failed > 0 ? (
                  <span className="text-[var(--warn)]">{row.failed}</span>
                ) : (
                  <span className="text-[var(--fg-subtle)]">0</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right">{formatTokens(row.inputTokens)}</td>
              <td className="px-3 py-1.5 text-right">{formatTokens(row.outputTokens)}</td>
              <td className="px-3 py-1.5 text-right">{formatUsd(row.costCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
