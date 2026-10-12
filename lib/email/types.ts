/**
 * Email seam.
 *
 * Everything that sends mail goes through `EmailProvider.send()`. The
 * provider is picked once per process in `lib/email/index.ts`: Resend when
 * `RESEND_API_KEY` + `EMAIL_FROM` are set, otherwise a console provider that
 * prints the message (verification links included) so every auth flow can
 * be exercised locally without a sending domain.
 */

/**
 * `transactional` mail is required for the account to work (verification,
 * reset, receipts) and never carries an unsubscribe link. `notification`
 * mail is optional (welcome, digests, reminders) and must carry one.
 */
export type EmailCategory = "transactional" | "notification";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  category: EmailCategory;
  /** Extra SMTP headers (e.g. `List-Unsubscribe`). */
  headers?: Record<string, string>;
  replyTo?: string;
  /**
   * Provider-side dedupe key. Resend treats repeated sends with the same
   * key within 24h as one message; callers retrying a webhook or workflow
   * step should pass a stable key.
   */
  idempotencyKey?: string;
}

export interface SentEmail {
  id: string;
  provider: EmailProviderName;
}

export type EmailProviderName = "resend" | "console";

export interface EmailProvider {
  readonly name: EmailProviderName;
  send(message: EmailMessage): Promise<SentEmail>;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      "Email delivery is not configured: RESEND_API_KEY and EMAIL_FROM are unset, so emails are " +
        "printed to the server log instead of delivered. Set both (EMAIL_FROM on a verified Resend " +
        "domain, or onboarding@resend.dev to reach the account owner only) before launch.",
    );
    this.name = "EmailNotConfiguredError";
  }
}

export class EmailSendError extends Error {
  constructor(
    public readonly provider: EmailProviderName,
    message: string,
  ) {
    super(`[email.${provider}] ${message}`);
    this.name = "EmailSendError";
  }
}
