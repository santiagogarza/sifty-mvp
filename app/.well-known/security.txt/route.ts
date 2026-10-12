import { buildSecurityTxt } from "@/lib/site/security-txt";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(buildSecurityTxt(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
