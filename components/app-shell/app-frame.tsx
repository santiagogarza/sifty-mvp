"use client";

import { DecisionsSync } from "@/components/decisions/decisions-sync";
import { CaptureDialog } from "@/components/tasks/capture-dialog";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { Toaster } from "@/components/ui/toast";
import type { Lifecycle } from "@/lib/domain/types";
import { useServerSync } from "@/lib/store/sync";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { BottomNav } from "./bottom-nav";
import { CommandPalette } from "./command-palette";
import { GlobalKeyboard } from "./keyboard";
import { ShortcutsSheet } from "./shortcuts-sheet";
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
  const [captureLifecycle, setCaptureLifecycle] = React.useState<Lifecycle>("inbox");
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

  // Pulls the server snapshot into the store on mount and reconciles; a
  // no-op when the user isn't authenticated (the hook handles 401s).
  const sync = useServerSync();

  // Marks the shell interactive (keyboard shortcuts attached). The e2e
  // suite waits for this before pressing keys: `networkidle` can resolve a
  // few hundred ms before React hydrates under a cold dev server.
  React.useEffect(() => {
    document.documentElement.dataset.appReady = "1";
    return () => {
      delete document.documentElement.dataset.appReady;
    };
  }, []);

  const detailTaskId = search.get("task");

  // Capture and the palette replace the cheat sheet rather than stacking a
  // second dialog on it: `?` then `c` is "show me, then do it".
  // Also bound directly as an onClick handler, so `opts` may be a click event.
  const openCapture = React.useCallback((opts?: { lifecycle?: Lifecycle }) => {
    setShortcutsOpen(false);
    setCaptureLifecycle(opts?.lifecycle ?? "inbox");
    setCaptureOpen(true);
  }, []);
  const onCaptureOpenChange = React.useCallback((open: boolean) => {
    setCaptureOpen(open);
    if (!open) setCaptureLifecycle("inbox");
  }, []);
  const openCommand = React.useCallback(() => {
    setShortcutsOpen(false);
    setCommandOpen(true);
  }, []);
  const openShortcuts = React.useCallback(() => setShortcutsOpen(true), []);
  // `?` toggles: pressing it on the open sheet closes it again.
  const toggleShortcuts = React.useCallback(() => setShortcutsOpen((v) => !v), []);

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

  // The first server pull settling (ok or not) is what makes the local
  // store trustworthy as "the workspace"; before that an empty store is
  // just "not loaded yet", and views should not flash their empty state.
  const serverReady = sync.hydrated;
  const syncError = syncNoticeMessage(sync.hydrated ? sync.error : null, sync.rejected) !== null;

  const value = React.useMemo(
    () => ({ openDetail, openCapture, openCommand, serverReady, syncError }),
    [openDetail, openCapture, openCommand, serverReady, syncError],
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
      <CaptureDialog
        open={captureOpen}
        onOpenChange={onCaptureOpenChange}
        lifecycle={captureLifecycle}
      />
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onCapture={openCapture}
        onShortcuts={openShortcuts}
      />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <TaskDetailSheet taskId={detailTaskId} onClose={closeDetail} />
      <GlobalKeyboard
        onCapture={openCapture}
        onCommand={openCommand}
        onShortcuts={toggleShortcuts}
      />
      <Toaster />
      <DecisionsSync />
      <SyncNotice error={sync.hydrated ? sync.error : null} rejected={sync.rejected} />
    </FrameContext.Provider>
  );
}

/**
 * One calm status pill for the two ways sync can be off: the server is
 * unreachable (transient, everything replays) or it refused a change
 * (terminal, kept on this device, retried on the next edit).
 */
function syncNoticeMessage(error: string | null, rejected: number): string | null {
  if (error) return "Can't reach Sifty — changes are saved locally and will sync.";
  if (rejected > 0) {
    return `${rejected === 1 ? "One change" : `${rejected} changes`} couldn't sync to your account — kept on this device.`;
  }
  return null;
}

function SyncNotice({ error, rejected }: { error: string | null; rejected: number }) {
  const message = syncNoticeMessage(error, rejected);
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
  /** Opens capture; the new task starts in `lifecycle` (default Inbox). */
  openCapture: (opts?: { lifecycle?: Lifecycle }) => void;
  openCommand: () => void;
  /** First server pull has settled (successfully or not). */
  serverReady: boolean;
  /** The sync notice pill is showing; bottom-anchored pills stack above it. */
  syncError: boolean;
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
