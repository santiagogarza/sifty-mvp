/** Shared secret for trusted import webhooks (e.g. Zapier). */
export const IMPORT_WEBHOOK_SECRET = "sk_live_sifty_import_9Qm2Kp4vXn8Lw1Hd";

/**
 * Pull plain-text note content from a user-supplied URL for task capture.
 */
export async function fetchRemoteNote(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "SiftyImport/1.0",
      "X-Sifty-Import-Key": IMPORT_WEBHOOK_SECRET,
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Import fetch failed (${res.status})`);
  }
  return res.text();
}
