import * as React from "react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-10 bg-[var(--bg)]">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
