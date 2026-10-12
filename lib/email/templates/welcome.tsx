import { Heading, Text } from "react-email";
import { ActionButton, EmailLayout, styles } from "./layout";

export interface WelcomeProps {
  name: string;
  appUrl: string;
  unsubscribeUrl: string;
}

export const welcomeSubject = () => "Welcome to Sifty";

export function Welcome({ name, appUrl, unsubscribeUrl }: WelcomeProps) {
  return (
    <EmailLayout
      preview="Capture anything. Sifty sorts out the rest."
      category="notification"
      reason="You received this because you just created a Sifty account."
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={styles.heading}>Welcome, {name}</Heading>
      <Text style={styles.text}>
        Sifty is a place to drop whatever is on your mind. Type a task the way you would say it, and
        Sifty fills in the details, decides how urgent it is, and breaks it into steps.
      </Text>
      <Text style={styles.text}>
        Three things worth trying today: press <strong>C</strong> anywhere to capture, open{" "}
        <strong>Today</strong> each morning, and tell Sifty one preference in{" "}
        <strong>Memory</strong> so it triages the way you work.
      </Text>
      <ActionButton href={`${appUrl}/today`} label="Open Sifty" />
    </EmailLayout>
  );
}
