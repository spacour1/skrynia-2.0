import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/dashboard",
        "/favorites",
        "/login",
        "/register",
        "/messages",
        "/orders",
        "/seller",
        "/settings",
        "/wallet"
      ]
    },
    sitemap: `${SITE_URL}/sitemap.xml`
  };
}
