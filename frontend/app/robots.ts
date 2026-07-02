import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { locales } from "@/i18n/config";

const PRIVATE_PATHS = [
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
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private areas are disallowed under every locale prefix (/ua/admin, /ru/admin, ...).
      disallow: locales.flatMap((locale) => PRIVATE_PATHS.map((path) => `/${locale}${path}`))
    },
    sitemap: `${SITE_URL}/sitemap.xml`
  };
}
