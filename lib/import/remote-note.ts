import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;

const blockedRanges = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedRanges.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedRanges.addSubnet(net, prefix, "ipv6");
}

async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid import URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("Import URL must use https");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true }).catch(() => []);
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) =>
      blockedRanges.check(address, family === 6 ? "ipv6" : "ipv4"),
    )
  ) {
    throw new Error("Import URL host is not allowed");
  }
  return url;
}

/**
 * Pull plain-text note content from a user-supplied URL for task capture.
 */
export async function fetchRemoteNote(url: string): Promise<string> {
  const target = await assertPublicHttpsUrl(url);
  const res = await fetch(target, {
    headers: { "User-Agent": "SiftyImport/1.0" },
    // Redirects could bounce to an internal host after validation.
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Import fetch failed (${res.status})`);
  }
  if (!res.body) {
    return "";
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(
    Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES),
  );
}
