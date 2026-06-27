import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "../components/Nav";

export const metadata: Metadata = {
  title: "Escrow Market MVP",
  description: "Peer-to-peer digital goods marketplace with escrow"
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
          <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:pl-[17rem] lg:pr-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
