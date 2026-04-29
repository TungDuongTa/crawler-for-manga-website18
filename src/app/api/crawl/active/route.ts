import { NextResponse } from 'next/server';
import { getActiveJob } from '@/lib/jobStore';

export async function GET() {
  const job = await getActiveJob();
  if (!job) return NextResponse.json({ jobId: null });
  return NextResponse.json({ jobId: job.id });
}

