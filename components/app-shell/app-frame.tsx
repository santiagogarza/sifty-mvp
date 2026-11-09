"use client";

import { CaptureDialog } from "@/components/tasks/capture-dialog";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import type { Lifecycle } from "@/lib/domain/types";
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
export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <React.Suspense fallback={null}>
        <AppFrameInner>{children}</AppFrameInner>
      </React.Suspense>
    </ThemeProvider>
  );
}

function AppFrameInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [captureOpen, setCaptureOpen] = React.useState(false);
  const [captureLifecycle, setCaptureLifecycle] = React.useState<Lifecycle>("inbox");
  const [commandOpen, setCommandOpen] = React.useState(false);

  // Pulls the server snapshot into the store on mount and reconciles; a
  // no-op when the user isn't authenticated (the hook handles 401s).
  const sync = useServerSync();

  const detailTaskId = search.get("task");

  const openCapture = React.useCallback(() => {
    setCaptureLifecycle("inbox");
    setCaptureOpen(true);
  }, []);
  const captureInto = React.useCallback((lifecycle: Lifecycle) => {
    setCaptureLifecycle(lifecycle);
    setCaptureOpen(true);
  }, []);
  const openCommand = React.useCallback(() => setCommandOpen(true), []);
  const syncNoticeVisible = sync.hydrated && !!sync.error;

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
    () => ({ openDetail, openCapture, captureInto, openCommand, syncNoticeVisible }),
    [openDetail, openCapture, captureInto, openCommand, syncNoticeVisible],
  );

  return (
    <FrameContext.Provider value={value}>
      <div className="relative flex min-h-dvh">
        <Sidebar />
        {/* @container: the board sizes itself against this pane (cqw), not
            the viewport, which the sidebar offsets. */}
        <main className="@container relative z-0 flex-1 flex flex-col min-w-0 pb-[80px] md:pb-0">
          {children}
        </main>
      </div>
      <BottomNav onCapture={openCapture} />
      <CaptureDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        lifecycle={captureLifecycle}
      />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} onCapture={openCapture} />
      <TaskDetailSheet taskId={detailTaskId} onClose={closeDetail} />
      <GlobalKeyboard onCapture={openCapture} onCommand={openCommand} />
      {syncNoticeVisible ? (
        <div
          role="status"
          className="fixed bottom-[92px] md:bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur px-3.5 py-1.5 text-[12px] text-[var(--fg-muted)] shadow-sm"
        >
          Can't reach Sifty — changes are saved locally and will sync.
        </div>
      ) : null}
    </FrameContext.Provider>
  );
}

interface FrameApi {
  openDetail: (id: string) => void;
  openCapture: () => void;
  /** Capture with the new task starting in this status (a board column). */
  captureInto: (lifecycle: Lifecycle) => void;
  openCommand: () => void;
  /** The "Can't reach Sifty" pill is showing at the bottom of the screen. */
  syncNoticeVisible: boolean;
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
