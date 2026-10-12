/**
 * Post-login destinations come from a `?next=` query string anyone can
 * craft, so only a same-origin path is honored. A leading-slash check is not
 * enough: browsers (and Next's router) read `/\evil.com`, `/%09/evil.com`,
 * and friends as protocol-relative URLs. Parse against the app origin and
 * require the result to stay on it.
 */
export const DEFAULT_NEXT = "/today";

function hasControlCharacter(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function safeNextPath(next: string | null | undefined, origin: string): string {
  if (!next) return DEFAULT_NEXT;
  if (!next.startsWith("/") || next.startsWith("//")) return DEFAULT_NEXT;
  // Backslashes and ASCII control characters are what URL parsers turn into
  // slashes or strip; none of them belong in a legitimate app path.
  if (next.includes("\\") || hasControlCharacter(next)) return DEFAULT_NEXT;
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return DEFAULT_NEXT;
  }
  if (url.origin !== new URL(origin).origin) return DEFAULT_NEXT;
  if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) return DEFAULT_NEXT;
  return `${url.pathname}${url.search}${url.hash}`;
}
