import type { DigestTask } from "@/lib/notifications/digest";
import { Link, Section, Text } from "react-email";
import { palette, styles } from "./layout";

/**
 * Task lists for digest emails. Each row links into the app; long lists
 * are cut with an "and N more" line so a backlog never becomes a scroll.
 */

export const MAX_ROWS = 12;

export const digestStyles = {
  section: { margin: "18px 0 0" },
  eyebrow: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: palette.fgMuted,
    margin: "0 0 6px",
  },
  row: { fontSize: 15, lineHeight: 1.5, color: palette.fg, margin: "0 0 6px" },
  rowLink: { color: palette.fg, textDecoration: "none" },
  meta: { fontSize: 12.5, color: palette.fgMuted },
  warn: { fontSize: 12.5, color: palette.accent, fontWeight: 600 },
  more: { fontSize: 13, color: palette.fgSubtle, margin: "4px 0 0" },
  stat: { fontSize: 14, lineHeight: 1.6, color: palette.fgMuted, margin: "0 0 4px" },
} as const;

export function TaskRows({
  title,
  tasks,
  showDue = true,
}: {
  title: string;
  tasks: DigestTask[];
  showDue?: boolean;
}) {
  if (tasks.length === 0) return null;
  const visible = tasks.slice(0, MAX_ROWS);
  const hidden = tasks.length - visible.length;
  return (
    <Section style={digestStyles.section}>
      <Text style={digestStyles.eyebrow}>
        {title} · {tasks.length}
      </Text>
      {visible.map((t) => (
        <Text key={t.id} style={digestStyles.row}>
          <Link href={t.url} style={digestStyles.rowLink}>
            {t.title}
          </Link>
          {showDue && t.dueState === "overdue" && t.due ? (
            <span style={digestStyles.warn}> · overdue since {shortDate(t.due)}</span>
          ) : null}
          {showDue && t.dueState === "upcoming" && t.due ? (
            <span style={digestStyles.meta}> · {shortDate(t.due)}</span>
          ) : null}
          {t.nextAction ? <span style={digestStyles.meta}> — {t.nextAction}</span> : null}
        </Text>
      ))}
      {hidden > 0 ? <Text style={digestStyles.more}>and {hidden} more in Sifty</Text> : null}
    </Section>
  );
}

export function OpenAppButton({ href, label }: { href: string; label: string }) {
  return (
    <Section style={{ margin: "24px 0 4px" }}>
      <Link href={href} style={styles.button}>
        {label}
      </Link>
    </Section>
  );
}

/** "Oct 9" from a `YYYY-MM-DD` key, no zone conversion. */
export function shortDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
