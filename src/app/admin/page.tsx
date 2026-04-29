'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface ChapterProgress {
  mangaUrl: string;
  stage: string;
  message: string;
  progress: number;
  chaptersDone?: number;
  chaptersTotal?: number;
  imagesDone?: number;
  imagesTotal?: number;
  error?: string;
}

interface JobStatus {
  id: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  startedAt: string;
  urls: string[];
  progress: Record<string, ChapterProgress>;
  recentLogs: string[];
}

const DEFAULT_URLS = `https://damconuong.ceo/truyen/bi-an-duoi-toa-nha
https://damconuong.ceo/truyen/ky-nghi-uot-ac-khong-che`;

const ACTIVE_JOB_ID_STORAGE_KEY = 'manga-crawler:activeJobId';
const URLS_STORAGE_KEY = 'manga-crawler:adminUrls';

export default function AdminPage() {
  const [urls, setUrls] = useState(DEFAULT_URLS);
  const [jobId, setJobId] = useState('');
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Restore saved URLs for convenience
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      // 1) Prefer server-saved URLs (shared across browsers)
      try {
        const res = await fetch('/api/admin/settings');
        const data = await res.json();
        if (typeof data?.urlsText === 'string' && data.urlsText.trim()) {
          if (!cancelled) setUrls(data.urlsText);
          return;
        }
      } catch {
        // ignore
      }

      // 2) Fall back to this browser's local cache
      try {
        const saved = window.localStorage.getItem(URLS_STORAGE_KEY);
        if (saved && saved.trim()) {
          if (!cancelled) setUrls(saved);
        }
      } catch {
        // ignore
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist URLs input (local + server)
  useEffect(() => {
    try {
      window.localStorage.setItem(URLS_STORAGE_KEY, urls);
    } catch {
      // ignore
    }

    const t = window.setTimeout(() => {
      fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlsText: urls }),
      }).catch(() => {});
    }, 600);

    return () => {
      window.clearTimeout(t);
    };
  }, [urls]);

  // Restore active job after route change/refresh
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      // 1) Prefer this browser's saved job id (fast path)
      try {
        const saved = window.localStorage.getItem(ACTIVE_JOB_ID_STORAGE_KEY);
        if (saved) {
          if (!cancelled) setJobId(saved);
          return;
        }
      } catch {
        // ignore
      }

      // 2) Otherwise, ask the server for the currently running job (shared across browsers)
      try {
        const res = await fetch('/api/crawl/active');
        const data = await res.json();
        const activeId = data?.jobId;
        if (activeId && !cancelled) setJobId(activeId);
      } catch {
        // ignore
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist active job id
  useEffect(() => {
    try {
      if (jobId) window.localStorage.setItem(ACTIVE_JOB_ID_STORAGE_KEY, jobId);
      else window.localStorage.removeItem(ACTIVE_JOB_ID_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [jobId]);

  const startCrawl = async () => {
    setError('');
    setLoading(true);
    setStatus(null);
    const urlList = urls
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.startsWith('http'));

    if (urlList.length === 0) {
      setError('Please enter at least one valid URL');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlList }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start crawl');
      setJobId(data.jobId);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  const clearActiveJob = () => {
    setJobId('');
    setStatus(null);
    setError('');
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  };

  const stopCrawl = async () => {
    if (!jobId) return;
    try {
      setError('');
      await fetch('/api/crawl/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
    } finally {
      // Stop polling immediately; status will show cancelled on next load if needed
      clearActiveJob();
    }
  };

  // Poll job status
  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/crawl/status?jobId=${jobId}`);
        const data = await res.json();
        if (!res.ok) {
          // If server restarted / job evicted, stop polling and clear the saved id
          if (res.status === 404) {
            setError('Active job not found (server restarted or job expired).');
            clearActiveJob();
            return;
          }
          throw new Error(data?.error || `Failed to load job status (${res.status})`);
        }
        const job = data as JobStatus;
        setStatus(job);
        if (job.status === 'running') pollRef.current = setTimeout(poll, 2000);
      } catch {
        pollRef.current = setTimeout(poll, 3000);
      }
    };

    poll();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [jobId]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [status?.recentLogs]);

  const isRunning = status?.status === 'running' || loading;

  const clampPercent = (n: unknown) => {
    const num = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(100, Math.round(num)));
  };

  const overallProgress = status
    ? clampPercent(
        Object.values(status.progress ?? {}).reduce(
          (sum, p) => sum + clampPercent((p as any)?.progress),
          0
        ) / Math.max(status.urls?.length ?? 0, 1)
      )
    : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold text-paper-100">🕷️ Crawl Manager</h1>
          <p className="text-ink-400 text-sm mt-1">Fetch manga from damconuong.ceo</p>
        </div>
        <Link
          href="/"
          className="text-sm text-ink-400 hover:text-paper-100 transition-colors"
        >
          ← Library
        </Link>
      </div>

      {/* URL Input */}
      <div className="bg-ink-800 rounded-xl p-6 mb-6 border border-ink-700">
        <label className="block text-sm font-semibold text-paper-200 mb-2">
          Manga URLs <span className="text-ink-400 font-normal">(one per line)</span>
        </label>
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={6}
          disabled={isRunning}
          className="w-full bg-ink-900 border border-ink-600 rounded-lg p-3 text-sm text-paper-100 font-mono focus:outline-none focus:border-accent resize-none disabled:opacity-50 transition-colors"
          placeholder="https://damconuong.ceo/truyen/manga-slug"
          spellCheck={false}
        />
        {error && (
          <p className="text-red-400 text-sm mt-2">⚠️ {error}</p>
        )}
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={startCrawl}
            disabled={isRunning}
            className="px-6 py-2.5 bg-accent hover:bg-accent-light disabled:opacity-50 text-white rounded-lg font-semibold text-sm transition-colors flex items-center gap-2"
          >
            {isRunning ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {loading ? 'Starting…' : 'Crawling…'}
              </>
            ) : (
              '🚀 Start Crawl'
            )}
          </button>
          {status?.status === 'running' && jobId && (
            <button
              onClick={stopCrawl}
              className="px-4 py-2.5 bg-red-700 hover:bg-red-600 text-white rounded-lg font-semibold text-sm transition-colors"
              title="Stop current crawl job"
            >
              Stop
            </button>
          )}
          {jobId && (
            <button
              onClick={clearActiveJob}
              disabled={isRunning}
              className="px-4 py-2.5 bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-paper-100 rounded-lg font-semibold text-sm transition-colors"
              title="Forget current job id"
            >
              Clear job
            </button>
          )}
          {status?.status === 'done' && (
            <span className="text-green-400 text-sm font-semibold">✓ All done!</span>
          )}
        </div>
      </div>

      {/* Job Status */}
      {status && (
        <div className="space-y-4">
          {/* Overall progress */}
          <div className="bg-ink-800 rounded-xl p-5 border border-ink-700">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs font-bold px-3 py-1 rounded-full ${
                    status.status === 'running'
                      ? 'bg-yellow-900/60 text-yellow-300 border border-yellow-700'
                      : status.status === 'done'
                      ? 'bg-green-900/60 text-green-300 border border-green-700'
                      : status.status === 'cancelled'
                      ? 'bg-ink-900/60 text-ink-200 border border-ink-700'
                      : 'bg-red-900/60 text-red-300 border border-red-700'
                  }`}
                >
                  {status.status === 'running'
                    ? '⏳ RUNNING'
                    : status.status === 'done'
                    ? '✅ DONE'
                    : status.status === 'cancelled'
                    ? '🛑 CANCELLED'
                    : '❌ ERROR'}
                </span>
                <span className="text-ink-400 text-xs font-mono">{status.id}</span>
              </div>
              <span className="text-ink-400 text-xs">
                {status.urls.length} manga • {overallProgress}% overall
              </span>
            </div>
            <div className="bg-ink-700 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-accent to-accent-light h-2 rounded-full transition-all duration-700"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>

          {/* Per-manga progress */}
          {Object.entries(status.progress).map(([url, prog]) => (
            <div
              key={url}
              className="bg-ink-800 rounded-xl p-4 border border-ink-700"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-ink-400 hover:text-paper-200 truncate max-w-xs transition-colors"
                >
                  {url}
                </a>
                <span
                  className={`text-xs flex-shrink-0 px-2 py-0.5 rounded ${
                    prog.stage === 'done'
                      ? 'text-green-400'
                      : prog.stage === 'error'
                      ? 'text-red-400'
                      : 'text-yellow-400'
                  }`}
                >
                  {prog.stage}
                </span>
              </div>

              <div className="flex items-center gap-3 mb-2">
                <div className="flex-1 bg-ink-700 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      prog.stage === 'error' ? 'bg-red-500' : 'bg-accent'
                    }`}
                    style={{ width: `${clampPercent((prog as any)?.progress)}%` }}
                  />
                </div>
                <span className="text-xs text-ink-300 w-9 text-right">
                  {clampPercent((prog as any)?.progress)}%
                </span>
              </div>

              <p className="text-xs text-paper-300">{prog.message}</p>

              {(prog.chaptersTotal || prog.imagesTotal) && (
                <p className="text-xs text-ink-400 mt-1">
                  {prog.chaptersTotal && (
                    <span>Chapters: {prog.chaptersDone}/{prog.chaptersTotal} </span>
                  )}
                  {prog.imagesTotal && (
                    <span>| Images: {prog.imagesDone}/{prog.imagesTotal}</span>
                  )}
                </p>
              )}

              {prog.error && (
                <p className="text-xs text-red-400 mt-1 font-mono">{prog.error}</p>
              )}
            </div>
          ))}

          {/* Logs */}
          <details className="bg-ink-800 rounded-xl border border-ink-700 group">
            <summary className="p-4 text-sm text-ink-300 cursor-pointer hover:text-paper-100 transition-colors select-none flex items-center gap-2">
              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
              Live Logs ({status.recentLogs?.length ?? 0})
            </summary>
            <div className="px-4 pb-4">
              <div className="bg-ink-900 rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-xs text-ink-400 space-y-0.5 leading-5">
                {status.recentLogs?.map((log, i) => (
                  <div key={i} className="break-all">
                    {log}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          </details>

          {/* Done: link to library */}
          {status.status === 'done' && (
            <div className="bg-green-950 border border-green-800 rounded-xl p-4 text-center">
              <p className="text-green-300 font-semibold mb-2">🎉 Crawl complete!</p>
              <Link
                href="/"
                className="inline-block px-5 py-2 bg-green-800 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                View Library →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
