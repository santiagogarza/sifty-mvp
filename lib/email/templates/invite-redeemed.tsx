import { Heading, Text } from "react-email";
import { ActionButton, EmailLayout, formatEmailDate, styles } from "./layout";

export interface InviteRedeemedProps {
  name: string;
  /** What the code unlocked, e.g. "Sifty Pro". */
  grant: string;
  /** Null means the grant does not expire. */
  expiresAt: string | null;
  appUrl: string;
}

export const inviteRedeemedSubject = (p: InviteRedeemedProps) =>
  `Your invite code unlocked ${p.grant}`;

export function InviteRedeemed({ name, grant, expiresAt, appUrl }: InviteRedeemedProps) {
  const duration = expiresAt
    ? `until ${formatEmailDate(expiresAt, { month: "long", day: "numeric", year: "numeric" })}`
    : "with no end date";
  return (
    <EmailLayout
      preview={`${grant} is active on your account.`}
      category="transactional"
      reason="You received this because an invite code was redeemed on your Sifty account."
    >
      <Heading style={styles.heading}>{grant} is on</Heading>
      <Text style={styles.text}>Hi {name},</Text>
      <Text style={styles.text}>
        Your invite code was accepted. {grant} is active on your account {duration}, and no card is
        needed. You can check what it includes at any time under Settings → Billing.
      </Text>
      <ActionButton href={`${appUrl}/settings/billing`} label="View your plan" />
    </EmailLayout>
  );
}
