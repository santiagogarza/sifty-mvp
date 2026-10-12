import { Heading, Text } from "react-email";
import { ActionButton, EmailLayout, styles } from "./layout";

export interface MagicLinkProps {
  magicLinkUrl: string;
}

export const magicLinkSubject = () => "Your sign-in link for Sifty";

export function MagicLink({ magicLinkUrl }: MagicLinkProps) {
  return (
    <EmailLayout
      preview="Tap to sign in. No password needed."
      category="transactional"
      reason="You received this because someone requested a sign-in link for Sifty with this address. If it wasn't you, ignore this email; nobody can sign in without it."
    >
      <Heading style={styles.heading}>Sign in to Sifty</Heading>
      <Text style={styles.text}>
        Here is your one-time sign-in link. It expires in 5 minutes and works once.
      </Text>
      <ActionButton href={magicLinkUrl} label="Sign in" />
    </EmailLayout>
  );
}
