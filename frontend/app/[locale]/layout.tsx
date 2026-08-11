import type { Metadata } from "next";
import "../globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { defaultLocale, isLocale, localeToLang, localeToOpenGraph, locales, type Locale } from "@/i18n/config";
import { getT } from "@/i18n/dictionaries";
import { LocaleProvider } from "@/lib/i18n";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

function resolveLocale(value: string): Locale {
  // The middleware only lets valid locales through; coerce defensively anyway.
  return isLocale(value) ? value : defaultLocale;
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: routeLocale } = await params;
  const locale = resolveLocale(routeLocale);
  const t = getT(locale);
  const title = t("meta.siteTitle");
  const description = t("meta.siteDescription");
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: `%s | ${SITE_NAME}` },
    description,
    alternates: {
      canonical: `/${locale}`,
      languages: { uk: "/ua", ru: "/ru", en: "/en", "x-default": `/${defaultLocale}` }
    },
    openGraph: { siteName: SITE_NAME, type: "website", locale: localeToOpenGraph[locale], title, description },
    twitter: { card: "summary", title, description }
  };
}

export default async function RootLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: routeLocale } = await params;
  const locale = resolveLocale(routeLocale);

  return (
    <html lang={localeToLang[locale]} className="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <body className="antialiased">
        <LocaleProvider locale={locale}>
          <Providers>
            <Nav />
            <main className="mx-auto w-full max-w-[1720px] px-4 py-5 sm:px-6 lg:pl-[208px] lg:pr-5">
              <EmailVerificationBanner />
              {children}
            </main>
          </Providers>
        </LocaleProvider>
      </body>
    </html>
  );
}
