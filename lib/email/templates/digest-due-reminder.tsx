import type { DueReminder } from "@/lib/notifications/digest";
import { Heading, Text } from "react-email";
import { OpenAppButton, TaskRows } from "./digest-shared";
import { EmailLayout, styles } from "./layout";

export interface DigestDueReminderProps {
  reminder: DueReminder;
  unsubscribeUrl: string;
  settingsUrl: string;
}

export const digestDueReminderSubject = ({ reminder }: DigestDueReminderProps) => {
  const today = reminder.dueToday.length;
  const overdue = reminder.overdue.length;
  if (today && overdue) return `${today} still due today, ${overdue} overdue`;
  if (today) return today === 1 ? "1 task still due today" : `${today} tasks still due today`;
  return overdue === 1 ? "1 task is overdue" : `${overdue} tasks are overdue`;
};

export function DigestDueReminder({
  reminder,
  unsubscribeUrl,
  settingsUrl,
}: DigestDueReminderProps) {
  return (
    <EmailLayout
      preview={digestDueReminderSubject({ reminder, unsubscribeUrl, settingsUrl })}
      category="notification"
      reason={`You receive due-date reminders because they are turned on in your Sifty notification settings (${settingsUrl}).`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={styles.heading}>A nudge, {reminder.name}</Heading>
      <Text style={styles.text}>
        These are still open. Finish them, push the date, or move them to Someday — anything beats
        letting them slide.
      </Text>
      <TaskRows title="Due today" tasks={reminder.dueToday} showDue={false} />
      <TaskRows title="Overdue" tasks={reminder.overdue} />
      <OpenAppButton href={`${reminder.appUrl}/today`} label="Open Today" />
    </EmailLayout>
  );
}
