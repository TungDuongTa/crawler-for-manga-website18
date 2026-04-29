'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';

interface MangaCard {
  slug: string;
  title: string;
  coverCloudinaryUrl: string;
  tags: string[];
  status: string;
  totalChapters: number;
  crawlStatus: string;
  updatedAt: string;
}

export default function HomePage() {
  const [manga, setManga] = useState<MangaCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [allTags, setAllTags] = useState<string[]>([]);

  const fetchManga = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '24' });
    if (search) params.set('search', search);
    if (tag) params.set('tag', tag);
    const res = await fetch(`/api/manga?${params}`);
    const data = await res.json();
    setManga(data.items || []);
    setTotal(data.total || 0);

    // Collect tags
    const tags = new Set<string>();
    (data.items || []).forEach((m: MangaCard) => m.tags.forEach((t: string) => tags.add(t)));
    setAllTags((prev) => Array.from(new Set([...prev, ...Array.from(tags)])));
    setLoading(false);
  }, [page, search, tag]);

  useEffect(() => { fetchManga(); }, [fetchManga]);

  const totalPages = Math.ceil(total / 24);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-paper-100 mb-1">
          Manga Library
        </h1>
        <p className="text-ink-300 text-sm">{total} titles in collection</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          placeholder="Search titles…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="bg-ink-800 border border-ink-600 rounded-lg px-4 py-2 text-sm text-paper-100 placeholder-ink-400 focus:outline-none focus:border-accent w-64"
        />
        <select
          value={tag}
          onChange={(e) => { setTag(e.target.value); setPage(1); }}
          className="bg-ink-800 border border-ink-600 rounded-lg px-4 py-2 text-sm text-paper-100 focus:outline-none focus:border-accent"
        >
          <option value="">All genres</option>
          {allTags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="bg-ink-800 rounded-lg aspect-[2/3] mb-2" />
              <div className="bg-ink-800 h-3 rounded mb-1" />
              <div className="bg-ink-800 h-3 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : manga.length === 0 ? (
        <div className="text-center py-24 text-ink-400">
          <div className="text-5xl mb-4">📚</div>
          <p className="text-lg mb-2">No manga yet</p>
          <p className="text-sm">Go to <Link href="/admin" className="text-accent hover:underline">Admin</Link> to crawl some titles</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {manga.map((m) => (
            <Link key={m.slug} href={`/manga/${m.slug}`} className="manga-card block group">
              <div className="relative aspect-[2/3] bg-ink-800 rounded-lg overflow-hidden mb-2">
                {m.coverCloudinaryUrl ? (
                  <Image
                    src={m.coverCloudinaryUrl}
                    alt={m.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-ink-500 text-4xl">📖</div>
                )}
                {m.crawlStatus === 'crawling' && (
                  <div className="absolute top-1 right-1 bg-yellow-600 text-white text-xs px-1.5 py-0.5 rounded">
                    Crawling…
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <span className="text-xs text-paper-300">{m.totalChapters} ch</span>
                </div>
              </div>
              <h3 className="text-xs font-semibold text-paper-200 line-clamp-2 leading-tight">{m.title}</h3>
              {m.tags.slice(0, 2).map((t) => (
                <span key={t} className="inline-block text-[10px] bg-ink-700 text-ink-300 rounded px-1.5 py-0.5 mt-1 mr-1">
                  {t}
                </span>
              ))}
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-ink-800 text-paper-200 rounded-lg disabled:opacity-40 hover:bg-ink-700 transition-colors text-sm"
          >
            ← Prev
          </button>
          <span className="px-4 py-2 text-ink-300 text-sm">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 bg-ink-800 text-paper-200 rounded-lg disabled:opacity-40 hover:bg-ink-700 transition-colors text-sm"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
