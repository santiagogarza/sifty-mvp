import { Resend } from "resend";
import { type EmailMessage, type EmailProvider, EmailSendError, type SentEmail } from "../types";

/**
 * Resend provider.
 *
 * `EMAIL_FROM` must be an address on a domain verified in the Resend
 * dashboard (DKIM + SPF + DMARC records); Resend refuses to deliver to
 * anyone but the account owner otherwise.
 */
export interface ResendProviderConfig {
  apiKey: string;
  from: string;
  replyTo?: string;
}

export function createResendProvider(config: ResendProviderConfig): EmailProvider {
  const client = new Resend(config.apiKey);

  return {
    name: "resend",
    async send(message: EmailMessage): Promise<SentEmail> {
      const { data, error } = await client.emails.send(
        {
          from: config.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          replyTo: message.replyTo ?? config.replyTo,
          headers: message.headers,
          tags: [{ name: "category", value: message.category }],
        },
        message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
      );
      if (error || !data) {
        throw new EmailSendError("resend", error?.message ?? "Resend returned no message id");
      }
      return { id: data.id, provider: "resend" };
    },
  };
}
