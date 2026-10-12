"use client";

import { CaptureDialog } from "@/components/tasks/capture-dialog";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { Toaster } from "@/components/ui/toast";
import { useServerSync } from "@/lib/store/sync";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { BottomNav } from "./bottom-nav";
import { CommandPalette } from "./command-palette";
import { GlobalKeyboard } from "./keyboard";
import { Sidebar } from "./sidebar";
import { ThemeProvider } from "./theme-context";

/**
 * Top-level client frame. Owns the global overlays (capture, command,
 * task-detail) so they're reachable from anywhere via shortcut without
 * re-mounting per page.
 *
 * Detail sheet routing: the `?task=<id>` query param is the source of truth.
 * Opening a task is a shallow navigation; this keeps deep links honest and
 * makes the back button do the right thing on mobile.
 */
export function AppFrame({
  children,
  notice,
}: {
  children: React.ReactNode;
  /** Account-wide notice (failed payment) rendered above every page. */
  notice?: React.ReactNode;
}) {
  return (
    <ThemeProvider>
      <React.Suspense fallback={null}>
        <AppFrameInner notice={notice}>{children}</AppFrameInner>
      </React.Suspense>
    </ThemeProvider>
  );
}

function AppFrameInner({
  children,
  notice,
}: {
  children: React.ReactNode;
  notice?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [captureOpen, setCaptureOpen] = React.useState(false);
  const [commandOpen, setCommandOpen] = React.useState(false);

  // Pulls the server snapshot into the store on mount and reconciles; a
  // no-op when the user isn't authenticated (the hook handles 401s).
  const sync = useServerSync();

  const detailTaskId = search.get("task");

  const openCapture = React.useCallback(() => setCaptureOpen(true), []);
  const openCommand = React.useCallback(() => setCommandOpen(true), []);

  const openDetail = React.useCallback(
    (id: string) => {
      const params = new URLSearchParams(search.toString());
      params.set("task", id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, search],
  );

  const closeDetail = React.useCallback(() => {
    const params = new URLSearchParams(search.toString());
    params.delete("task");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, search]);

  const value = React.useMemo(
    () => ({ openDetail, openCapture, openCommand }),
    [openDetail, openCapture, openCommand],
  );

  return (
    <FrameContext.Provider value={value}>
      <div className="relative flex min-h-dvh">
        <Sidebar />
        {/* @container lets the board view size itself against the main pane
            (100cqw) instead of the viewport, which the sidebar offsets. */}
        <main className="relative z-0 flex-1 flex flex-col min-w-0 pb-[80px] md:pb-0 @container">
          {notice}
          {children}
        </main>
      </div>
      <BottomNav onCapture={openCapture} />
      <CaptureDialog open={captureOpen} onOpenChange={setCaptureOpen} />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} onCapture={openCapture} />
      <TaskDetailSheet taskId={detailTaskId} onClose={closeDetail} />
      <GlobalKeyboard onCapture={openCapture} onCommand={openCommand} />
      <Toaster />
      <SyncNotice error={sync.hydrated ? sync.error : null} rejected={sync.rejected} />
    </FrameContext.Provider>
  );
}

/**
 * One calm status pill for the two ways sync can be off: the server is
 * unreachable (transient, everything replays) or it refused a change
 * (terminal, kept on this device, retried on the next edit).
 */
function SyncNotice({ error, rejected }: { error: string | null; rejected: number }) {
  const message = error
    ? "Can't reach Sifty — changes are saved locally and will sync."
    : rejected > 0
      ? `${rejected === 1 ? "One change" : `${rejected} changes`} couldn't sync to your account — kept on this device.`
      : null;
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="sync-notice"
      className="fixed bottom-[92px] md:bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur px-3.5 py-1.5 text-[12px] text-[var(--fg-muted)] shadow-sm"
    >
      {message}
    </div>
  );
}
interface FrameApi {
  openDetail: (id: string) => void;
  openCapture: () => void;
  openCommand: () => void;
}

const FrameContext = React.createContext<FrameApi | null>(null);

export function useFrame() {
  const ctx = React.useContext(FrameContext);
  if (!ctx) throw new Error("useFrame must be inside AppFrame");
  return ctx;
}

export function useOpenDetail() {
  return useFrame().openDetail;
}
