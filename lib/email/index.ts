import { reportError } from "@/lib/observability/report-error";
import { createConsoleProvider } from "./providers/console";
import { createResendProvider } from "./providers/resend";
import {
  type EmailMessage,
  EmailNotConfiguredError,
  type EmailProvider,
  type SentEmail,
} from "./types";

export * from "./types";
export { createConsoleProvider } from "./providers/console";
export type { ConsoleEmailProvider } from "./providers/console";
export { createResendProvider } from "./providers/resend";

/**
 * Provider factory.
 *
 * - `RESEND_API_KEY` + `EMAIL_FROM` set → Resend. While there is no verified
 *   sending domain, `EMAIL_FROM=onboarding@resend.dev` (Resend's sandbox
 *   sender) delivers to the account owner's address only.
 * - Otherwise → console provider (prints mail to stdout / Vercel logs).
 *   In `VERCEL_ENV=production` that is reported as an error on first use so
 *   it cannot go unnoticed, but sends still succeed: the launch checklist
 *   (verified domain, D-E) is what turns this into a hard requirement.
 */

let _override: EmailProvider | null = null;
let _default: EmailProvider | null = null;

export function setEmailProviderForTesting(provider: EmailProvider | null): void {
  _override = provider;
  _default = null;
}

export function isEmailDeliveryConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export function getEmailProvider(): EmailProvider {
  if (_override) return _override;
  if (_default) return _default;
  _default = resolveDefault();
  return _default;
}

function resolveDefault(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (apiKey && from) {
    return createResendProvider({ apiKey, from, replyTo: process.env.EMAIL_REPLY_TO || undefined });
  }
  if (process.env.VERCEL_ENV === "production") {
    reportError(new EmailNotConfiguredError(), { area: "email.config" });
  }
  return createConsoleProvider();
}

/**
 * Send one message through the configured provider. Failures are reported
 * through the observability seam and rethrown so callers (auth hooks,
 * webhooks) decide whether the request fails.
 */
export async function sendEmail(message: EmailMessage): Promise<SentEmail> {
  const provider = getEmailProvider();
  try {
    return await provider.send(message);
  } catch (err) {
    reportError(err, {
      area: "email.send",
      tags: { provider: provider.name, category: message.category, subject: message.subject },
    });
    throw err;
  }
}
