import type * as React from "react";
import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from "react-email";
import type { EmailCategory } from "../types";

/**
 * Shared chrome for every Sifty email.
 *
 * Inline styles only: email clients ignore stylesheets, and keeping the
 * palette here (paper + ember, mirroring `globals.css`) means templates
 * never pick colors.
 */

export const palette = {
  bg: "#f7f6f3",
  surface: "#ffffff",
  fg: "#1c1b18",
  fgMuted: "#6b6660",
  fgSubtle: "#8f8a83",
  border: "#e6e3dd",
  accent: "#c2410c",
  accentFg: "#ffffff",
} as const;

export const font =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const styles = {
  body: { backgroundColor: palette.bg, margin: 0, padding: "32px 12px", fontFamily: font },
  container: {
    backgroundColor: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: 12,
    maxWidth: 520,
    margin: "0 auto",
    padding: "32px 36px",
  },
  brand: { fontSize: 15, fontWeight: 600, color: palette.fg, letterSpacing: "-0.01em", margin: 0 },
  heading: {
    fontSize: 22,
    fontWeight: 600,
    color: palette.fg,
    letterSpacing: "-0.01em",
    margin: "24px 0 8px",
    lineHeight: 1.3,
  },
  text: { fontSize: 15, lineHeight: 1.6, color: palette.fg, margin: "0 0 14px" },
  muted: { fontSize: 13, lineHeight: 1.6, color: palette.fgMuted, margin: "0 0 10px" },
  button: {
    display: "inline-block",
    backgroundColor: palette.accent,
    color: palette.accentFg,
    borderRadius: 8,
    padding: "11px 18px",
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
  },
  code: {
    display: "block",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 12,
    lineHeight: 1.6,
    color: palette.fgMuted,
    wordBreak: "break-all" as const,
    margin: "6px 0 0",
  },
  hr: { borderColor: palette.border, margin: "24px 0 16px" },
  footer: { fontSize: 12, lineHeight: 1.6, color: palette.fgSubtle, margin: "0 0 6px" },
  link: { color: palette.accent, textDecoration: "underline" },
} as const;

export interface EmailLayoutProps {
  /** Inbox preview line shown next to the subject. */
  preview: string;
  category: EmailCategory;
  /** Why the recipient is getting this. One sentence. */
  reason: string;
  /** Required for `notification` mail; ignored for transactional mail. */
  unsubscribeUrl?: string;
  children: React.ReactNode;
}

export function EmailLayout({
  preview,
  category,
  reason,
  unsubscribeUrl,
  children,
}: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.brand}>Sifty</Text>
          {children}
          <Hr style={styles.hr} />
          <Section>
            <Text style={styles.footer}>{reason}</Text>
            {category === "notification" ? (
              <UnsubscribeFooter unsubscribeUrl={unsubscribeUrl} />
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/**
 * Footer for non-transactional mail. Rendered only for `notification`
 * messages; transactional mail must never offer an opt-out.
 */
export function UnsubscribeFooter({ unsubscribeUrl }: { unsubscribeUrl?: string }) {
  if (!unsubscribeUrl) {
    throw new Error("notification emails must include an unsubscribeUrl");
  }
  return (
    <Text style={styles.footer} data-testid="unsubscribe-footer">
      You can{" "}
      <Link href={unsubscribeUrl} style={styles.link}>
        unsubscribe
      </Link>{" "}
      from emails like this at any time. Account and security emails are still sent.
    </Text>
  );
}

/**
 * Dates in email are rendered in UTC: the server's zone is an accident of
 * the deploy region, and a midnight-UTC timestamp must not print as the
 * previous day. Throws on unparseable input rather than printing "Invalid Date".
 */
export function formatEmailDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date in email: ${iso}`);
  return d.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

/** Button plus a plain URL fallback for clients that strip links. */
export function ActionButton({ href, label }: { href: string; label: string }) {
  return (
    <Section style={{ margin: "20px 0 8px" }}>
      <Link href={href} style={styles.button}>
        {label}
      </Link>
      <Text style={styles.muted}>Or paste this link into your browser:</Text>
      <Text style={styles.code}>{href}</Text>
    </Section>
  );
}
