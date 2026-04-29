import { NextRequest, NextResponse } from 'next/server';
import { stopJobAbortController } from '@/lib/crawlControl';
import { setJobCancelled, getJob } from '@/lib/jobStore';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobId } = body as { jobId?: string };
    if (!jobId) {
      return NextResponse.json({ error: 'jobId required' }, { status: 400 });
    }

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    stopJobAbortController(jobId);
    await setJobCancelled(jobId);

    return NextResponse.json({ ok: true, jobId, status: 'cancelled' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

