'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toCloudinaryAutoEcoUrl } from '@/lib/cloudinary-url';

interface Page {
  index: number;
  originalUrl: string;
  cloudinaryUrl: string;
}

interface ChapterData {
  chapter: {
    chapterNumber: number;
    title: string;
    pages: Page[];
    pageCount: number;
  };
  manga: { title: string; slug: string };
  navigation: { prev: number | null; next: number | null };
}

type ReadMode = 'scroll' | 'page';

export default function ChapterReaderPage({
  params,
}: {
  params: { slug: string; num: string };
}) {
  const router = useRouter();
  const [data, setData] = useState<ChapterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ReadMode>('scroll');
  const [pageIndex, setPageIndex] = useState(0);
  const [showUI, setShowUI] = useState(true);
  const hideTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setLoading(true);
    setPageIndex(0);
    fetch(`/api/manga/${params.slug}/chapter/${params.num}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [params.slug, params.num]);

  // Auto-hide UI in scroll mode
  const resetHideTimer = useCallback(() => {
    setShowUI(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (mode === 'scroll') {
      hideTimer.current = setTimeout(() => setShowUI(false), 3000);
    }
  }, [mode]);

  useEffect(() => {
    window.addEventListener('mousemove', resetHideTimer);
    window.addEventListener('scroll', resetHideTimer);
    return () => {
      window.removeEventListener('mousemove', resetHideTimer);
      window.removeEventListener('scroll', resetHideTimer);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [resetHideTimer]);

  // Keyboard navigation
  useEffect(() => {
    if (mode !== 'page' || !data) return;
    const { pages } = data.chapter;
    const { prev, next } = data.navigation;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        if (pageIndex < pages.length - 1) setPageIndex((i) => i + 1);
        else if (next !== null) router.push(`/manga/${params.slug}/chapter/${next}`);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        if (pageIndex > 0) setPageIndex((i) => i - 1);
        else if (prev !== null) router.push(`/manga/${params.slug}/chapter/${prev}`);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mode, data, pageIndex, params.slug, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-ink-600 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data?.chapter) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-4xl mb-4">📭</p>
        <p className="text-ink-400 mb-4">Chapter not found or not yet crawled.</p>
        <Link href={`/manga/${params.slug}`} className="text-accent hover:underline text-sm">
          ← Back to manga
        </Link>
      </div>
    );
  }

  const { chapter, manga, navigation } = data;
  const pages = chapter.pages || [];

  const navBar = (
    <div
      className={`sticky top-14 z-40 bg-ink-900/95 backdrop-blur border-b border-ink-700 transition-opacity duration-300 ${
        showUI ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className="max-w-3xl mx-auto px-4 h-12 flex items-center justify-between gap-3">
        {/* Left: back link */}
        <Link
          href={`/manga/${manga.slug}`}
          className="text-xs text-ink-400 hover:text-paper-100 transition-colors truncate max-w-[140px]"
        >
          ← {manga.title}
        </Link>

        {/* Center: chapter info */}
        <span className="text-sm font-semibold text-paper-200 flex-shrink-0">
          Ch.{chapter.chapterNumber}
          {mode === 'page' && (
            <span className="text-ink-400 font-normal ml-2 text-xs">
              {pageIndex + 1}/{pages.length}
            </span>
          )}
        </span>

        {/* Right: controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setMode(mode === 'scroll' ? 'page' : 'scroll')}
            className="text-xs bg-ink-700 hover:bg-ink-600 text-paper-200 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            {mode === 'scroll' ? '📄 Page' : '📜 Scroll'}
          </button>
          {navigation.prev !== null && (
            <Link
              href={`/manga/${manga.slug}/chapter/${navigation.prev}`}
              className="text-xs bg-ink-700 hover:bg-ink-600 text-paper-200 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              ← Ch.{navigation.prev}
            </Link>
          )}
          {navigation.next !== null && (
            <Link
              href={`/manga/${manga.slug}/chapter/${navigation.next}`}
              className="text-xs bg-accent hover:bg-accent-light text-white px-2.5 py-1.5 rounded-lg transition-colors"
            >
              Ch.{navigation.next} →
            </Link>
          )}
        </div>
      </div>
    </div>
  );

  // ── Scroll mode ────────────────────────────────────────────────────────────
  if (mode === 'scroll') {
    return (
      <>
        {navBar}
        <div className="max-w-3xl mx-auto" onClick={resetHideTimer}>
          {pages.map((page) => (
            <div key={page.index} className="chapter-page">
              <img
                src={toCloudinaryAutoEcoUrl(page.cloudinaryUrl || page.originalUrl)}
                alt={`Page ${page.index}`}
                loading="lazy"
                className="w-full h-auto block"
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  if (img.src !== page.originalUrl) img.src = page.originalUrl;
                }}
              />
            </div>
          ))}

          {/* End of chapter nav */}
          <div className="flex justify-between items-center px-4 py-8 border-t border-ink-700">
            {navigation.prev !== null ? (
              <Link
                href={`/manga/${manga.slug}/chapter/${navigation.prev}`}
                className="px-5 py-2.5 bg-ink-800 hover:bg-ink-700 text-paper-200 rounded-lg text-sm transition-colors"
              >
                ← Ch.{navigation.prev}
              </Link>
            ) : <div />}
            <Link
              href={`/manga/${manga.slug}`}
              className="text-sm text-ink-400 hover:text-paper-100 transition-colors"
            >
              Chapter List
            </Link>
            {navigation.next !== null ? (
              <Link
                href={`/manga/${manga.slug}/chapter/${navigation.next}`}
                className="px-5 py-2.5 bg-accent hover:bg-accent-light text-white rounded-lg text-sm transition-colors"
              >
                Ch.{navigation.next} →
              </Link>
            ) : <div />}
          </div>
        </div>
      </>
    );
  }

  // ── Page mode ──────────────────────────────────────────────────────────────
  const currentPage = pages[pageIndex];
  return (
    <>
      {navBar}
      <div className="max-w-3xl mx-auto px-2 py-4">
        {/* Image */}
        {currentPage && (
          <div
            className="chapter-page mb-4 cursor-pointer select-none"
            onClick={() => {
              if (pageIndex < pages.length - 1) setPageIndex((i) => i + 1);
              else if (navigation.next !== null)
                router.push(`/manga/${manga.slug}/chapter/${navigation.next}`);
            }}
          >
            <img
              src={toCloudinaryAutoEcoUrl(currentPage.cloudinaryUrl || currentPage.originalUrl)}
              alt={`Page ${currentPage.index}`}
              className="w-full h-auto block rounded-lg"
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                if (img.src !== currentPage.originalUrl) img.src = currentPage.originalUrl;
              }}
            />
          </div>
        )}

        {/* Page nav */}
        <div className="flex items-center justify-between gap-4 px-2">
          <button
            onClick={() => {
              if (pageIndex > 0) setPageIndex((i) => i - 1);
              else if (navigation.prev !== null)
                router.push(`/manga/${manga.slug}/chapter/${navigation.prev}`);
            }}
            className="flex-1 py-3 bg-ink-800 hover:bg-ink-700 text-paper-200 rounded-xl text-sm font-semibold transition-colors"
          >
            ←
          </button>

          {/* Page dots / counter */}
          <div className="flex items-center gap-1.5 flex-wrap justify-center max-w-xs">
            {pages.length <= 20 ? (
              pages.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setPageIndex(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === pageIndex ? 'bg-accent w-4' : 'bg-ink-600 hover:bg-ink-500'
                  }`}
                />
              ))
            ) : (
              <span className="text-sm text-ink-300 font-semibold">
                {pageIndex + 1} <span className="text-ink-500">/</span> {pages.length}
              </span>
            )}
          </div>

          <button
            onClick={() => {
              if (pageIndex < pages.length - 1) setPageIndex((i) => i + 1);
              else if (navigation.next !== null)
                router.push(`/manga/${manga.slug}/chapter/${navigation.next}`);
            }}
            className="flex-1 py-3 bg-ink-800 hover:bg-ink-700 text-paper-200 rounded-xl text-sm font-semibold transition-colors"
          >
            →
          </button>
        </div>

        <p className="text-center text-xs text-ink-500 mt-3">
          Click image or use ← → keys to navigate
        </p>
      </div>
    </>
  );
}
