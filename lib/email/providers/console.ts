import { nanoid } from "nanoid";
import type { EmailMessage, EmailProvider, SentEmail } from "../types";

/**
 * Console provider.
 *
 * Local dev and tests. Prints the plain-text body to stdout so verification
 * and reset links are one copy-paste away, and keeps every message in an
 * in-memory outbox that tests read back.
 */
export interface ConsoleEmailProvider extends EmailProvider {
  readonly name: "console";
  readonly outbox: ReadonlyArray<EmailMessage & { id: string }>;
  clear(): void;
}

export function createConsoleProvider(opts: { silent?: boolean } = {}): ConsoleEmailProvider {
  const outbox: Array<EmailMessage & { id: string }> = [];
  const silent = opts.silent ?? process.env.NODE_ENV === "test";

  return {
    name: "console",
    outbox,
    clear() {
      outbox.length = 0;
    },
    async send(message: EmailMessage): Promise<SentEmail> {
      const id = `console_${nanoid(12)}`;
      outbox.push({ ...message, id });
      if (!silent) {
        const divider = "─".repeat(60);
        console.info(
          [
            divider,
            `[email.console] ${message.category} → ${message.to}`,
            `Subject: ${message.subject}`,
            "",
            message.text.trim(),
            divider,
          ].join("\n"),
        );
      }
      return { id, provider: "console" };
    },
  };
}
