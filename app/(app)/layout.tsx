import { AppFrame } from "@/components/app-shell/app-frame";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
