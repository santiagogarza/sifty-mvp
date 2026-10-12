import { PUBLIC_ROUTES, getSiteUrl } from "@/lib/site/config";
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = getSiteUrl();
  return PUBLIC_ROUTES.map((path) => ({
    url: `${site}${path}`,
    changeFrequency: path === "/" || path === "/pricing" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/pricing" ? 0.8 : 0.4,
  }));
}
