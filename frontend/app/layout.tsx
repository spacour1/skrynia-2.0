import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "../components/Nav";
import { EmailVerificationBanner } from "../components/EmailVerificationBanner";
import { SITE_NAME, SITE_URL } from "../lib/site";

const description =
  "SKRYNIA — маркетплейс цифровых товаров и услуг для геймеров с безопасной сделкой через escrow: аккаунты, ключи, бустинг и пополнения.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — маркетплейс с безопасной сделкой`,
    template: `%s | ${SITE_NAME}`
  },
  description,
  openGraph: {
    siteName: SITE_NAME,
    type: "website",
    locale: "ru_RU",
    title: `${SITE_NAME} — маркетплейс с безопасной сделкой`,
    description
  },
  twitter: {
    card: "summary",
    title: `${SITE_NAME} — маркетплейс с безопасной сделкой`,
    description
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeScript = `
    try {
      var saved = localStorage.getItem('theme');
      var theme = saved === 'dark' || saved === 'light'
        ? saved
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var savedLanguage = localStorage.getItem('language');
      var language = savedLanguage === 'en' || savedLanguage === 'uk' || savedLanguage === 'ru' ? savedLanguage : 'ru';
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.style.colorScheme = theme;
      document.documentElement.lang = language;
    } catch (_) {}
  `;

  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Providers>
          <Nav />
          <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:pl-[17rem] lg:pr-8">
            <EmailVerificationBanner />
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
