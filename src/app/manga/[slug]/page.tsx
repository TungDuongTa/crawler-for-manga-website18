'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

interface Chapter {
  chapterNumber: number;
  title: string;
  pageCount: number;
  crawledAt: string;
}

interface MangaDetail {
  slug: string;
  title: string;
  alternativeTitles: string[];
  coverCloudinaryUrl: string;
  coverUrl: string;
  description: string;
  tags: string[];
  author: string;
  artist: string;
  status: string;
  totalChapters: number;
  crawlStatus: string;
  sourceUrl: string;
}

export default function MangaDetailPage({ params }: { params: { slug: string } }) {
  const [data, setData] = useState<{ manga: MangaDetail; chapters: Chapter[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    fetch(`/api/manga/${params.slug}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [params.slug]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 animate-pulse">
        <div className="flex gap-6 mb-8">
          <div className="w-40 flex-shrink-0">
            <div className="aspect-[2/3] bg-ink-800 rounded-xl" />
          </div>
          <div className="flex-1 space-y-3">
            <div className="h-7 bg-ink-800 rounded w-2/3" />
            <div className="h-4 bg-ink-800 rounded w-1/3" />
            <div className="h-4 bg-ink-800 rounded w-full" />
            <div className="h-4 bg-ink-800 rounded w-5/6" />
          </div>
        </div>
      </div>
    );
  }

  if (!data?.manga) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 text-center">
        <p className="text-4xl mb-4">😶</p>
        <p className="text-ink-400">Manga not found.</p>
        <Link href="/" className="text-accent hover:underline mt-2 inline-block text-sm">← Back to library</Link>
      </div>
    );
  }

  const { manga, chapters } = data;
  const sorted = [...chapters].sort((a, b) =>
    sortAsc ? a.chapterNumber - b.chapterNumber : b.chapterNumber - a.chapterNumber
  );
  const cover = manga.coverCloudinaryUrl || manga.coverUrl;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link href="/" className="text-ink-400 hover:text-paper-100 text-sm transition-colors">
          ← Library
        </Link>
      </div>

      {/* Hero */}
      <div className="flex flex-col sm:flex-row gap-6 mb-10">
        {/* Cover */}
        <div className="w-44 flex-shrink-0 mx-auto sm:mx-0">
          <div className="relative aspect-[2/3] bg-ink-800 rounded-xl overflow-hidden shadow-2xl ring-1 ring-ink-600">
            {cover ? (
              <Image
                src={cover}
                alt={manga.title}
                fill
                className="object-cover"
                sizes="176px"
                priority
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-ink-500 text-5xl">📖</div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-paper-100 leading-tight mb-1">
            {manga.title}
          </h1>
          {manga.alternativeTitles?.length > 0 && (
            <p className="text-ink-400 text-sm mb-3 italic">
              {manga.alternativeTitles.join(' • ')}
            </p>
          )}

          {/* Tags */}
          {manga.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {manga.tags.map((t) => (
                <span
                  key={t}
                  className="text-xs bg-ink-700 text-ink-300 rounded-md px-2.5 py-1 border border-ink-600"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
            {manga.author && (
              <div>
                <span className="text-ink-500 text-xs uppercase tracking-wide block">Author</span>
                <span className="text-paper-200">{manga.author}</span>
              </div>
            )}
            {manga.artist && manga.artist !== manga.author && (
              <div>
                <span className="text-ink-500 text-xs uppercase tracking-wide block">Artist</span>
                <span className="text-paper-200">{manga.artist}</span>
              </div>
            )}
            {manga.status && (
              <div>
                <span className="text-ink-500 text-xs uppercase tracking-wide block">Status</span>
                <span className="text-paper-200">{manga.status}</span>
              </div>
            )}
            <div>
              <span className="text-ink-500 text-xs uppercase tracking-wide block">Chapters</span>
              <span className="text-paper-200">{chapters.length} / {manga.totalChapters}</span>
            </div>
          </div>

          {/* Description */}
          {manga.description && (
            <p className="text-sm text-ink-300 leading-relaxed line-clamp-5">
              {manga.description}
            </p>
          )}

          {/* Quick actions */}
          <div className="flex gap-3 mt-5">
            {chapters.length > 0 && (
              <Link
                href={`/manga/${manga.slug}/chapter/${chapters[0].chapterNumber}`}
                className="px-5 py-2.5 bg-accent hover:bg-accent-light text-white rounded-lg font-semibold text-sm transition-colors"
              >
                Start Reading →
              </Link>
            )}
            <a
              href={manga.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 bg-ink-700 hover:bg-ink-600 text-paper-200 rounded-lg text-sm transition-colors"
            >
              Source ↗
            </a>
          </div>
        </div>
      </div>

      {/* Chapter list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-bold text-paper-100">
            Chapters
            <span className="text-ink-400 font-normal text-base ml-2">({chapters.length})</span>
          </h2>
          <button
            onClick={() => setSortAsc((v) => !v)}
            className="text-xs text-ink-400 hover:text-paper-100 bg-ink-800 px-3 py-1.5 rounded-lg border border-ink-700 transition-colors"
          >
            {sortAsc ? '↑ Oldest first' : '↓ Newest first'}
          </button>
        </div>

        {chapters.length === 0 ? (
          <div className="text-center py-12 text-ink-500">
            <p>No chapters crawled yet.</p>
            {manga.crawlStatus === 'crawling' && (
              <p className="text-yellow-500 text-sm mt-2 animate-pulse">⏳ Crawl in progress…</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sorted.map((ch) => (
              <Link
                key={ch.chapterNumber}
                href={`/manga/${manga.slug}/chapter/${ch.chapterNumber}`}
                className="flex items-center justify-between bg-ink-800 hover:bg-ink-700 rounded-lg px-4 py-3 border border-ink-700 hover:border-ink-500 transition-all group"
              >
                <div>
                  <span className="text-sm font-semibold text-paper-200 group-hover:text-white">
                    Chapter {ch.chapterNumber}
                  </span>
                  {ch.title && (
                    <span className="text-ink-400 text-sm ml-2 group-hover:text-ink-200">
                      {ch.title}
                    </span>
                  )}
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <span className="text-xs text-ink-500">{ch.pageCount} pages</span>
                  <span className="text-ink-600 text-xs ml-2">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
