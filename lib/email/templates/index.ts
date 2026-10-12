import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { sendEmail } from "../index";
import type { EmailCategory, SentEmail } from "../types";
import {
  DigestDueReminder,
  type DigestDueReminderProps,
  digestDueReminderSubject,
} from "./digest-due-reminder";
import {
  DigestMorningPlan,
  type DigestMorningPlanProps,
  digestMorningPlanSubject,
} from "./digest-morning-plan";
import {
  DigestWeeklyReview,
  type DigestWeeklyReviewProps,
  digestWeeklyReviewSubject,
} from "./digest-weekly-review";
import { InviteRedeemed, type InviteRedeemedProps, inviteRedeemedSubject } from "./invite-redeemed";
import { MagicLink, type MagicLinkProps, magicLinkSubject } from "./magic-link";
import { PasswordReset, type PasswordResetProps, passwordResetSubject } from "./password-reset";
import { PaymentFailed, type PaymentFailedProps, paymentFailedSubject } from "./payment-failed";
import { VerifyEmail, type VerifyEmailProps, verifyEmailSubject } from "./verify-email";
import { Welcome, type WelcomeProps, welcomeSubject } from "./welcome";

/**
 * Template registry.
 *
 * One entry per email Sifty sends. Callers use `sendTemplate(name, ...)`
 * and never touch HTML; `renderEmail` is exposed for tests and previews.
 */

interface TemplateDef<P> {
  category: EmailCategory;
  subject: (props: P) => string;
  component: (props: P) => ReactElement;
  /** Non-transactional templates must expose the unsubscribe URL for headers. */
  unsubscribeUrl?: (props: P) => string;
}

function define<P>(def: TemplateDef<P>): TemplateDef<P> {
  return def;
}

export const templates = {
  "verify-email": define<VerifyEmailProps>({
    category: "transactional",
    subject: verifyEmailSubject,
    component: VerifyEmail,
  }),
  "password-reset": define<PasswordResetProps>({
    category: "transactional",
    subject: passwordResetSubject,
    component: PasswordReset,
  }),
  "magic-link": define<MagicLinkProps>({
    category: "transactional",
    subject: magicLinkSubject,
    component: MagicLink,
  }),
  welcome: define<WelcomeProps>({
    category: "notification",
    subject: welcomeSubject,
    component: Welcome,
    unsubscribeUrl: (p) => p.unsubscribeUrl,
  }),
  "invite-redeemed": define<InviteRedeemedProps>({
    category: "transactional",
    subject: inviteRedeemedSubject,
    component: InviteRedeemed,
  }),
  "payment-failed": define<PaymentFailedProps>({
    category: "transactional",
    subject: paymentFailedSubject,
    component: PaymentFailed,
  }),
  "digest-morning-plan": define<DigestMorningPlanProps>({
    category: "notification",
    subject: digestMorningPlanSubject,
    component: DigestMorningPlan,
    unsubscribeUrl: (p) => p.unsubscribeUrl,
  }),
  "digest-due-reminder": define<DigestDueReminderProps>({
    category: "notification",
    subject: digestDueReminderSubject,
    component: DigestDueReminder,
    unsubscribeUrl: (p) => p.unsubscribeUrl,
  }),
  "digest-weekly-review": define<DigestWeeklyReviewProps>({
    category: "notification",
    subject: digestWeeklyReviewSubject,
    component: DigestWeeklyReview,
    unsubscribeUrl: (p) => p.unsubscribeUrl,
  }),
};

export type TemplateName = keyof typeof templates;
export type TemplateProps<K extends TemplateName> = (typeof templates)[K] extends TemplateDef<
  infer P
>
  ? P
  : never;

export const TEMPLATE_NAMES = Object.keys(templates) as TemplateName[];

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  category: EmailCategory;
  headers: Record<string, string>;
}

export async function renderEmail<K extends TemplateName>(
  name: K,
  props: TemplateProps<K>,
): Promise<RenderedEmail> {
  const def = templates[name] as TemplateDef<TemplateProps<K>>;
  const element = def.component(props);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  const headers: Record<string, string> = {};
  if (def.category === "notification" && def.unsubscribeUrl) {
    // RFC 8058: lets Gmail/Apple Mail show a native unsubscribe control.
    headers["List-Unsubscribe"] = `<${def.unsubscribeUrl(props)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return { subject: def.subject(props), html, text, category: def.category, headers };
}

export async function sendTemplate<K extends TemplateName>(
  name: K,
  args: { to: string; props: TemplateProps<K>; idempotencyKey?: string },
): Promise<SentEmail> {
  const rendered = await renderEmail(name, args.props);
  return sendEmail({
    to: args.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    category: rendered.category,
    headers: Object.keys(rendered.headers).length ? rendered.headers : undefined,
    idempotencyKey: args.idempotencyKey,
  });
}

/** Base URL for links inside emails. */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
