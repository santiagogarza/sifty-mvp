import { Heading, Text } from "react-email";
import { ActionButton, EmailLayout, styles } from "./layout";

export interface PasswordResetProps {
  name: string;
  resetUrl: string;
}

export const passwordResetSubject = () => "Reset your Sifty password";

export function PasswordReset({ name, resetUrl }: PasswordResetProps) {
  return (
    <EmailLayout
      preview="Use this link to choose a new password."
      category="transactional"
      reason="You received this because a password reset was requested for your Sifty account. If you didn't ask for it, you can ignore this email; your password stays the same."
    >
      <Heading style={styles.heading}>Reset your password</Heading>
      <Text style={styles.text}>Hi {name},</Text>
      <Text style={styles.text}>
        Choose a new password with the link below. It expires in one hour and only works once.
      </Text>
      <ActionButton href={resetUrl} label="Choose a new password" />
    </EmailLayout>
  );
}
