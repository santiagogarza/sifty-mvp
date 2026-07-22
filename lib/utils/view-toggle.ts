/**
 * List ⇄ board layout toggle.
 *
 * The board is one place (`/board`) showing the whole lifecycle pipeline,
 * while the sidebar routes are per-context lists. Switching remembers which
 * list you came from (sessionStorage) so the toggle round-trips instead of
 * dumping you on a default page.
 */

export const BOARD_PATH = "/board";

export const LIST_VIEW_PATHS = ["/today", "/focus", "/inbox", "/waiting", "/someday"] as const;

const RETURN_KEY = "sifty.board-return";

export function isListViewPath(pathname: string | null | undefined): boolean {
  return !!pathname && (LIST_VIEW_PATHS as readonly string[]).includes(pathname);
}

export function rememberListReturn(pathname: string): void {
  try {
    window.sessionStorage.setItem(RETURN_KEY, pathname);
  } catch {
    // Storage can be unavailable (private mode); the fallback path covers it.
  }
}

export function listReturnPath(): string {
  try {
    const stored = window.sessionStorage.getItem(RETURN_KEY);
    if (stored && isListViewPath(stored)) return stored;
  } catch {
    // Fall through to the default.
  }
  return "/today";
}
