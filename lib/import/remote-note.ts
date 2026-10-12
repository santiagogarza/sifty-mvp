import { type LookupAddress, lookup } from "node:dns";
import { request } from "node:https";
import { BlockList, type LookupFunction, isIP } from "node:net";

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

function isBlocked(address: string, family: number): boolean {
  return blockedRanges.check(address, family === 6 ? "ipv6" : "ipv4");
}

// Validates the exact addresses the socket connects to, so a DNS answer
// cannot change between the check and the connect (rebinding).
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    if (
      addresses.length === 0 ||
      addresses.some(({ address, family }) => isBlocked(address, family))
    ) {
      return callback(new Error("Import URL host is not allowed"), "", 0);
    }
    if (options.all) return callback(null, addresses);
    const [first] = addresses as [LookupAddress];
    callback(null, first.address, first.family);
  });
};

function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid import URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("Import URL must use https");
  }
  // IP literals skip the lookup hook, so they are checked here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlocked(host, isIP(host))) {
    throw new Error("Import URL host is not allowed");
  }
  return url;
}

/**
 * Pull plain-text note content from a user-supplied URL for task capture.
 */
export function fetchRemoteNote(url: string): Promise<string> {
  const target = assertPublicHttpsUrl(url);
  return new Promise((resolve, reject) => {
    // node:https does not follow redirects, which could bounce to an internal host.
    const req = request(
      target,
      {
        headers: { "User-Agent": "SiftyImport/1.0" },
        lookup: publicOnlyLookup,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`Import fetch failed (${status})`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const finish = () =>
          resolve(new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES)));
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.byteLength;
          if (size >= MAX_BODY_BYTES) {
            finish();
            res.destroy();
          }
        });
        res.on("end", finish);
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}
