import type { Metadata } from "next";
import "../globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { defaultLocale, isLocale, localeToLang, locales, type Locale } from "@/i18n/config";
import { getT } from "@/i18n/dictionaries";
import { LocaleProvider } from "@/lib/i18n";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

const OG_LOCALES: Record<Locale, string> = { ua: "uk_UA", ru: "ru_RU", en: "en_US" };

function resolveLocale(value: string): Locale {
  // The middleware only lets valid locales through; coerce defensively anyway.
  return isLocale(value) ? value : defaultLocale;
}

export function generateMetadata({ params }: { params: { locale: string } }): Metadata {
  const locale = resolveLocale(params.locale);
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
    openGraph: { siteName: SITE_NAME, type: "website", locale: OG_LOCALES[locale], title, description },
    twitter: { card: "summary", title, description }
  };
}

export default function RootLayout({ children, params }: { children: React.ReactNode; params: { locale: string } }) {
  const locale = resolveLocale(params.locale);

  return (
    <html lang={localeToLang[locale]} className="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <body className="antialiased">
        <LocaleProvider locale={locale}>
          <Providers>
            <Nav />
            <main className="mx-auto w-full max-w-[1720px] px-4 py-5 sm:px-6 lg:pl-[104px] lg:pr-5">
              <EmailVerificationBanner />
              {children}
            </main>
          </Providers>
        </LocaleProvider>
      </body>
    </html>
  );
}
