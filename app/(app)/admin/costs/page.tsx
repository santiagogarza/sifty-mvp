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
import { notFound, redirect } from "next/navigation";

export const metadata = { title: "AI costs" };
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

  return (
    <PageShell title="AI costs">
      <PageHeader
        eyebrow="Admin"
        title="AI costs"
        description={`Every AI run across all accounts in the last ${report.days} days, priced from the model registry. Creator-only.`}
      />

      <Totals report={report} />

      <Section title="By day">
        <RollupTable rows={report.byDay} keyHeader="Day" />
      </Section>
      <Section title="By stage">
        <RollupTable rows={report.byStage} keyHeader="Stage" />
      </Section>
      <Section title="By model">
        <RollupTable rows={report.byModel} keyHeader="Model" />
      </Section>
      <Section title="By account">
        <RollupTable rows={report.byUser} keyHeader="Account" />
      </Section>

      <Section title="Workflow runtime">
        <WorkflowPing />
      </Section>
    </PageShell>
  );
}

function Totals({ report }: { report: CostReport }) {
  const t = report.totals;
  const stats: Array<[string, string]> = [
    ["Spend", formatUsd(t.costCents)],
    ["Runs", String(t.runs)],
    ["Failed", String(t.failed)],
    ["Tokens in", formatTokens(t.inputTokens)],
    ["Tokens out", formatTokens(t.outputTokens)],
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

function RollupTable({ rows, keyHeader }: { rows: CostReportRow[]; keyHeader: string }) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-[var(--fg-muted)]">No runs in this window.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full text-[13px] tabular-nums">
        <thead>
          <tr className="text-left text-[var(--fg-muted)] border-b border-[var(--border)]">
            <th className="font-normal px-3 py-2">{keyHeader}</th>
            <th className="font-normal px-3 py-2 text-right">Runs</th>
            <th className="font-normal px-3 py-2 text-right">Failed</th>
            <th className="font-normal px-3 py-2 text-right">In</th>
            <th className="font-normal px-3 py-2 text-right">Out</th>
            <th className="font-normal px-3 py-2 text-right">Cost</th>
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
