import { Heading, Text } from "react-email";
import { ActionButton, EmailLayout, formatEmailDate, styles } from "./layout";

export interface PaymentFailedProps {
  name: string;
  /** Formatted amount, e.g. "$10.00". */
  amount: string;
  /** When access is downgraded if the payment keeps failing; null if unknown. */
  retryUntil: string | null;
  /**
   * Pro is already off: the grace period ran out (or never opened) and the
   * account is on the free plan until a payment goes through. Changes the
   * copy from "nothing changes yet" to "Pro is paused".
   */
  accessPaused?: boolean;
  /** Stripe Customer Portal entry point. */
  billingUrl: string;
}

export const paymentFailedSubject = ({ accessPaused }: PaymentFailedProps) =>
  accessPaused
    ? "Sifty Pro is paused — payment still failing"
    : "Your Sifty payment didn't go through";

export function PaymentFailed({
  name,
  amount,
  retryUntil,
  accessPaused = false,
  billingUrl,
}: PaymentFailedProps) {
  const deadline = retryUntil
    ? formatEmailDate(retryUntil, { month: "long", day: "numeric" })
    : null;
  if (accessPaused) {
    return (
      <EmailLayout
        preview={`We still couldn't charge ${amount} for Sifty Pro, so Pro is paused.`}
        category="transactional"
        reason="You received this because you have a paid Sifty subscription and a payment attempt failed."
      >
        <Heading style={styles.heading}>Sifty Pro is paused</Heading>
        <Text style={styles.text}>Hi {name},</Text>
        <Text style={styles.text}>
          We tried again to charge {amount} for Sifty Pro and your card was declined. Pro is paused
          for now: your tasks and settings are safe, and sifting runs on the free plan's daily
          allowance until a payment goes through.
        </Text>
        <Text style={styles.text}>
          Update your payment method and Pro turns back on as soon as the charge succeeds. We keep
          retrying automatically in the meantime.
        </Text>
        <ActionButton href={billingUrl} label="Update payment method" />
      </EmailLayout>
    );
  }
  return (
    <EmailLayout
      preview={`We couldn't charge ${amount} for Sifty Pro.`}
      category="transactional"
      reason="You received this because you have a paid Sifty subscription and a payment attempt failed."
    >
      <Heading style={styles.heading}>Payment didn't go through</Heading>
      <Text style={styles.text}>Hi {name},</Text>
      <Text style={styles.text}>
        We tried to charge {amount} for Sifty Pro and your card was declined. Nothing changes yet:
        your tasks and settings are untouched, and we will retry automatically.
      </Text>
      <Text style={styles.text}>
        {deadline
          ? `Update your payment method before ${deadline} to keep Pro features on.`
          : "Update your payment method to keep Pro features on."}
      </Text>
      <ActionButton href={billingUrl} label="Update payment method" />
    </EmailLayout>
  );
}
