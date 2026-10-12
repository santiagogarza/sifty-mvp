import { getSiteUrl } from "@/lib/site/config";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const site = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Signed-in surfaces and API routes carry nothing worth indexing.
        disallow: [
          "/api/",
          "/today",
          "/inbox",
          "/focus",
          "/waiting",
          "/someday",
          "/done",
          "/memory",
          "/settings",
        ],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
  };
}
