import { NextRequest, NextResponse } from 'next/server';
import { crawlMany } from '@/lib/crawler';
import { startJobAbortController } from '@/lib/crawlControl';
import { createJob, getJob, setJobRunning, updateJobProgress } from '@/lib/jobStore';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { urls, jobId } = body as { urls?: string[]; jobId?: string };

    // Resume existing job (best-effort). The crawler will skip already-done chapters/images.
    if (jobId) {
      const existing = await getJob(jobId);
      if (!existing) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      await setJobRunning(jobId);
      const signal = startJobAbortController(jobId);
      crawlMany(existing.urls, (progress) => {
        void updateJobProgress(jobId, progress).catch((err) =>
          console.error('Failed to persist job progress:', err),
        );
      }, { signal }).catch((err) => {
        console.error('Crawl failed:', err);
      });

      return NextResponse.json({ jobId, status: 'resumed', urls: existing.urls });
    }

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'urls array required' }, { status: 400 });
    }

    const job = await createJob(urls);
    const signal = startJobAbortController(job.id);

    // Run crawl in background (non-blocking)
    crawlMany(urls, (progress) => {
      void updateJobProgress(job.id, progress).catch((err) =>
        console.error('Failed to persist job progress:', err),
      );
    }, { signal }).catch((err) => {
      console.error('Crawl failed:', err);
    });

    return NextResponse.json({ jobId: job.id, status: 'started', urls });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
