import { getSiteUrl, getSupportEmail } from "./config";

/**
 * RFC 9116 security.txt body. `Expires` is required by the RFC; it rolls
 * forward a year from render time so a stale file never advertises an
 * unmonitored contact.
 */

const EXPIRES_DAYS = 365;

export function buildSecurityTxt(now: Date = new Date()): string {
  const expires = new Date(now.getTime() + EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  const site = getSiteUrl();
  return [
    `Contact: mailto:${getSupportEmail()}`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en",
    `Canonical: ${site}/.well-known/security.txt`,
    `Policy: ${site}/terms#acceptable`,
    "",
  ].join("\n");
}
