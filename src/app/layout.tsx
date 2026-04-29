import type { Metadata } from 'next';
import { Noto_Serif, Noto_Sans } from 'next/font/google';
import './globals.css';

const notoSerif = Noto_Serif({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '700'],
  variable: '--font-display',
  display: 'swap',
});

const notoSans = Noto_Sans({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Manga Reader',
  description: 'Read manga online',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${notoSerif.variable} ${notoSans.variable}`}>
      <body className="bg-ink-900 text-paper-100 font-body antialiased min-h-screen">
        <nav className="sticky top-0 z-50 border-b border-ink-700 bg-ink-900/95 backdrop-blur">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
            <a href="/" className="font-display text-xl font-bold text-paper-100 tracking-tight">
              <span className="text-accent">墨</span> MangaVault
            </a>
            <div className="flex items-center gap-6 text-sm">
              <a href="/" className="text-paper-300 hover:text-paper-100 transition-colors">Library</a>
              <a href="/admin" className="text-paper-300 hover:text-paper-100 transition-colors">Admin</a>
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
