import { connectDB } from '@/lib/mongodb';
import { CrawlJob, ICrawlJob } from '@/models';
import type { CrawlProgress } from './crawler';

export type CrawlJobLean = Pick<
  ICrawlJob,
  'id' | 'urls' | 'startedAt' | 'status' | 'progress' | 'logs' | 'createdAt' | 'updatedAt'
>;

const MAX_LOGS = 500;

function jobLogLine(p: CrawlProgress) {
  return `[${new Date().toISOString()}] ${p.mangaUrl}: ${p.message}`;
}

function encodeProgressKey(mangaUrl: string) {
  // MongoDB field names cannot contain '.' and some other chars; URLs contain lots of them.
  // Store progress under a base64url key and decode on read.
  return Buffer.from(mangaUrl, 'utf8').toString('base64url');
}

function decodeProgressKey(key: string) {
  try {
    return Buffer.from(key, 'base64url').toString('utf8');
  } catch {
    return key;
  }
}

function decodeProgressRecord(progress: unknown): Record<string, CrawlProgress> {
  if (!progress || typeof progress !== 'object') return {};
  const out: Record<string, CrawlProgress> = {};
  for (const [k, v] of Object.entries(progress as Record<string, unknown>)) {
    out[decodeProgressKey(k)] = v as CrawlProgress;
  }
  return out;
}

export async function createJob(urls: string[]): Promise<CrawlJobLean> {
  await connectDB();
  const id = `job_${Date.now()}`;
  const doc = await CrawlJob.create({
    id,
    urls,
    startedAt: new Date(),
    status: 'running',
    progress: {},
    logs: [],
  });
  return doc.toObject();
}

export async function getJob(id: string): Promise<CrawlJobLean | null> {
  await connectDB();
  const doc = await CrawlJob.findOne({ id }).lean<CrawlJobLean>();
  if (!doc) return null;
  return {
    ...doc,
    progress: decodeProgressRecord(doc.progress),
  };
}

export async function getActiveJob(): Promise<CrawlJobLean | null> {
  await connectDB();
  const doc = await CrawlJob.findOne({ status: 'running' })
    .sort({ startedAt: -1 })
    .lean<CrawlJobLean>();
  if (!doc) return null;
  return {
    ...doc,
    progress: decodeProgressRecord(doc.progress),
  };
}

export async function setJobRunning(id: string): Promise<void> {
  await connectDB();
  await CrawlJob.updateOne({ id }, { $set: { status: 'running' } }).exec();
}

export async function setJobCancelled(id: string): Promise<void> {
  await connectDB();
  await CrawlJob.updateOne({ id }, { $set: { status: 'cancelled' } }).exec();
}

export async function updateJobProgress(jobId: string, progress: CrawlProgress): Promise<void> {
  await connectDB();

  const log = jobLogLine(progress);
  const encodedKey = encodeProgressKey(progress.mangaUrl);
  const progressKey = `progress.${encodedKey}`;

  await CrawlJob.updateOne(
    { id: jobId },
    {
      $set: {
        [progressKey]: progress,
        updatedAt: new Date(),
      },
      $push: { logs: { $each: [log], $slice: -MAX_LOGS } },
    },
  ).exec();

  // When a manga reaches terminal state, see if the whole job is finished.
  if (progress.stage === 'done' || progress.stage === 'error') {
    const job = await CrawlJob.findOne({ id: jobId }).select('urls progress status').lean<{
      urls: string[];
      progress: Record<string, CrawlProgress>;
      status: string;
    }>();
    if (!job) return;

    if (job.status === 'cancelled') return;

    const allDone = job.urls.every((url) => {
      const p = job.progress?.[encodeProgressKey(url)];
      return p?.stage === 'done' || p?.stage === 'error';
    });

    if (allDone) {
      await CrawlJob.updateOne({ id: jobId }, { $set: { status: 'done' } }).exec();
    }
  }
}
