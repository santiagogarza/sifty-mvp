import { Heading, Text } from "react-email";
import { ActionButton, EmailLayout, styles } from "./layout";

export interface PaymentFailedProps {
  name: string;
  /** Formatted amount, e.g. "$10.00". */
  amount: string;
  /** When access is downgraded if the payment keeps failing; null if unknown. */
  retryUntil: string | null;
  /** Stripe Customer Portal entry point. */
  billingUrl: string;
}

export const paymentFailedSubject = () => "Your Sifty payment didn't go through";

export function PaymentFailed({ name, amount, retryUntil, billingUrl }: PaymentFailedProps) {
  const deadline = retryUntil
    ? new Date(retryUntil).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })
    : null;
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
