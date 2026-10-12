import type { WeeklyReview } from "@/lib/notifications/digest";
import { Heading, Section, Text } from "react-email";
import { OpenAppButton, TaskRows, digestStyles } from "./digest-shared";
import { EmailLayout, styles } from "./layout";

export interface DigestWeeklyReviewProps {
  review: WeeklyReview;
  unsubscribeUrl: string;
  settingsUrl: string;
}

export const digestWeeklyReviewSubject = ({ review }: DigestWeeklyReviewProps) =>
  `Your week in review — ${review.completedCount} done, ${review.upcoming.length} coming up`;

export function DigestWeeklyReview({
  review,
  unsubscribeUrl,
  settingsUrl,
}: DigestWeeklyReviewProps) {
  return (
    <EmailLayout
      preview={`${review.rangeLabel}: ${review.completedCount} done, ${review.overdue.length} overdue, ${review.upcoming.length} due this week.`}
      category="notification"
      reason={`You receive a weekly review because it is turned on in your Sifty notification settings (${settingsUrl}).`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={styles.heading}>Your week, {review.name}</Heading>
      <Text style={styles.text}>
        {review.rangeLabel}. {review.completedCount === 0 ? "Nothing" : review.completedCount}{" "}
        {review.completedCount === 1 ? "task" : "tasks"} finished
        {review.overdue.length ? `, ${review.overdue.length} slipped` : ""}.
      </Text>

      <Section style={digestStyles.section}>
        <Text style={digestStyles.eyebrow}>Where things stand</Text>
        <Text style={digestStyles.stat}>
          Inbox {review.inboxCount} · Focus {review.focusCount} · Waiting on {review.waitingCount}
        </Text>
      </Section>

      <TaskRows title="Finished" tasks={review.completed} showDue={false} />
      <TaskRows title="Slipped" tasks={review.overdue} />
      <TaskRows title="Coming up this week" tasks={review.upcoming} />

      <Text style={{ ...styles.muted, marginTop: 18 }}>
        A ten-minute review is enough: clear Inbox, re-date what slipped, pick three for Focus.
      </Text>
      <OpenAppButton href={`${review.appUrl}/inbox`} label="Review in Sifty" />
    </EmailLayout>
  );
}
