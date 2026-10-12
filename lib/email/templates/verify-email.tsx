import { Heading, Text } from "react-email";
import { ActionButton, EmailLayout, styles } from "./layout";

export interface VerifyEmailProps {
  name: string;
  verifyUrl: string;
}

export const verifyEmailSubject = () => "Confirm your email for Sifty";

export function VerifyEmail({ name, verifyUrl }: VerifyEmailProps) {
  return (
    <EmailLayout
      preview="One click and your Sifty account is ready."
      category="transactional"
      reason="You received this because someone signed up for Sifty with this address. If it wasn't you, ignore this email and no account will be activated."
    >
      <Heading style={styles.heading}>Confirm your email</Heading>
      <Text style={styles.text}>Hi {name},</Text>
      <Text style={styles.text}>
        Confirm this address to finish setting up your Sifty account. The link is valid for one
        hour.
      </Text>
      <ActionButton href={verifyUrl} label="Confirm email" />
    </EmailLayout>
  );
}
