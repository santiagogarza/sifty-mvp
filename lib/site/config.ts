import { CREATOR_EMAIL } from "@/lib/auth/session-shared";

/**
 * Public-site configuration: names, URLs, and contacts the marketing and
 * legal pages render. Nothing here is secret.
 */

export const SITE_NAME = "Sifty";
export const LEGAL_ENTITY = "Waimaka, Inc";
export const SITE_DESCRIPTION =
  "Capture a task in a second. Sifty fills in the details, prioritizes it, breaks it down, and gets most of it done before you come back.";

const DEFAULT_SITE_URL = "http://localhost:3000";

/**
 * Canonical origin for absolute URLs (sitemap, OG tags, security.txt).
 * `NEXT_PUBLIC_APP_URL` wins; Vercel's production URL is the fallback so
 * preview builds without the var still emit valid absolute links.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return DEFAULT_SITE_URL;
}

/**
 * Where users and researchers reach a human. Falls back to the operator's
 * account email so the footer and security.txt never render an empty
 * contact; set `SUPPORT_EMAIL` to a shared inbox before launch.
 */
export function getSupportEmail(): string {
  const configured = process.env.SUPPORT_EMAIL?.trim();
  if (configured?.includes("@")) return configured;
  return CREATOR_EMAIL;
}

export interface Processor {
  name: string;
  purpose: string;
  /** Where the processor is based, for the data-transfer disclosure. */
  region: string;
}

export const PROCESSORS: Processor[] = [
  { name: "Vercel", purpose: "Hosting, serverless compute, and request logs", region: "US" },
  { name: "Neon", purpose: "Postgres database storing your account and tasks", region: "US" },
  { name: "Stripe", purpose: "Payments and subscription billing", region: "US" },
  { name: "Resend", purpose: "Transactional email (verification, receipts)", region: "US" },
  {
    name: "Vercel AI Gateway",
    purpose: "Routes task text to AI model providers for sifting",
    region: "US",
  },
  { name: "Sentry", purpose: "Error monitoring and crash reports", region: "US" },
];

/**
 * Metadata for a public page. Next replaces (not merges) a child's
 * `openGraph`/`twitter` objects, so each page must restate the shared
 * fields or share cards lose the image and site name.
 */
export function pageMetadata(input: { title: string; description: string; path: string }) {
  const ogTitle = `${input.title} — ${SITE_NAME}`;
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: input.path },
    openGraph: {
      type: "website" as const,
      siteName: SITE_NAME,
      url: input.path,
      title: ogTitle,
      description: input.description,
      images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image" as const,
      title: ogTitle,
      description: input.description,
      images: ["/opengraph-image"],
    },
  };
}

/** Public routes listed in the sitemap, in display order. */
export const PUBLIC_ROUTES = ["/", "/pricing", "/privacy", "/terms", "/sign-in", "/sign-up"];
