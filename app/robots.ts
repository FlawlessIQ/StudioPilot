import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api",
        "/auth",
        "/client",
        "/crew",
        // Private token links (a couple's gallery, a vendor's run of show, a
        // reply approval): never in search, whoever forwards one.
        "/d/",
        "/e/",
        "/i/",
        "/inquiry",
        "/kit",
        "/offline",
        "/platform-admin",
        "/reply/",
        "/schedule",
        "/share/",
        "/studio",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
