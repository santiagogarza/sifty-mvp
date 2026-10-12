import type { MorningPlan } from "@/lib/notifications/digest";
import { Heading, Text } from "react-email";
import { OpenAppButton, TaskRows } from "./digest-shared";
import { EmailLayout, styles } from "./layout";

export interface DigestMorningPlanProps {
  plan: MorningPlan;
  unsubscribeUrl: string;
  settingsUrl: string;
}

export const digestMorningPlanSubject = ({ plan }: DigestMorningPlanProps) => {
  const due = plan.overdue.length + plan.dueToday.length;
  if (plan.overdue.length)
    return `Your plan for ${plan.dateLabel} — ${plan.overdue.length} overdue`;
  if (due) return `Your plan for ${plan.dateLabel} — ${due} due today`;
  return `Your plan for ${plan.dateLabel}`;
};

export function DigestMorningPlan({ plan, unsubscribeUrl, settingsUrl }: DigestMorningPlanProps) {
  const total = plan.overdue.length + plan.dueToday.length + plan.today.length + plan.focus.length;
  return (
    <EmailLayout
      preview={previewLine(plan)}
      category="notification"
      reason={`You receive a morning plan because it is turned on in your Sifty notification settings (${settingsUrl}).`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={styles.heading}>Good morning, {plan.name}</Heading>
      <Text style={styles.text}>
        {total === 1 ? "One thing" : `${total} things`} on your plate for {plan.dateLabel}.
        {plan.inboxCount > 0
          ? ` ${plan.inboxCount} ${plan.inboxCount === 1 ? "capture is" : "captures are"} waiting in Inbox.`
          : ""}
      </Text>

      {plan.away ? <AwayRows away={plan.away} /> : null}

      <TaskRows title="Overdue" tasks={plan.overdue} />
      <TaskRows title="Due today" tasks={plan.dueToday} showDue={false} />
      <TaskRows title="Today" tasks={plan.today} />
      <TaskRows title="Focus" tasks={plan.focus} />

      <OpenAppButton href={`${plan.appUrl}/today`} label="Open Today" />
    </EmailLayout>
  );
}

function AwayRows({ away }: { away: NonNullable<MorningPlan["away"]> }) {
  return (
    <>
      <TaskRows title="Done while you were away" tasks={away.done} showDue={false} />
      <TaskRows title="Drafted for your review" tasks={away.drafted} showDue={false} />
      <TaskRows title="Waiting on your decision" tasks={away.waiting} showDue={false} />
    </>
  );
}

function previewLine(plan: MorningPlan): string {
  const parts: string[] = [];
  if (plan.overdue.length) parts.push(`${plan.overdue.length} overdue`);
  if (plan.dueToday.length) parts.push(`${plan.dueToday.length} due today`);
  if (plan.today.length) parts.push(`${plan.today.length} on Today`);
  if (plan.focus.length) parts.push(`${plan.focus.length} in Focus`);
  return parts.join(", ") || "Your plan for today";
}
