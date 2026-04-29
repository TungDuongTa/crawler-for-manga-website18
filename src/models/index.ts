import mongoose, { Schema, Document, Model } from 'mongoose';
import type { CrawlProgress } from '@/lib/crawler';

// ─── Chapter Page ───────────────────────────────────────────────────────────

export interface IPage {
  index: number;
  originalUrl: string;
  cloudinaryUrl: string;
}

// ─── Chapter ─────────────────────────────────────────────────────────────────

export interface IChapter extends Document {
  mangaId: mongoose.Types.ObjectId;
  mangaSlug: string;
  chapterNumber: number;
  title: string;
  sourceUrl: string;
  pages: IPage[];
  pageCount: number;
  crawledAt: Date;
  status: 'pending' | 'crawling' | 'done' | 'error';
  error?: string;
}

const PageSchema = new Schema<IPage>(
  {
    index: { type: Number, required: true },
    originalUrl: { type: String, required: true },
    cloudinaryUrl: { type: String, default: '' },
  },
  { _id: false }
);

const ChapterSchema = new Schema<IChapter>(
  {
    mangaId: { type: Schema.Types.ObjectId, ref: 'Manga', required: true, index: true },
    mangaSlug: { type: String, required: true, index: true },
    chapterNumber: { type: Number, required: true },
    title: { type: String, default: '' },
    sourceUrl: { type: String, required: true },
    pages: [PageSchema],
    pageCount: { type: Number, default: 0 },
    crawledAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'crawling', 'done', 'error'], default: 'pending' },
    error: { type: String },
  },
  { timestamps: true }
);

ChapterSchema.index({ mangaId: 1, chapterNumber: 1 }, { unique: true });

// ─── Manga ────────────────────────────────────────────────────────────────────

export interface IManga extends Document {
  slug: string;
  title: string;
  alternativeTitles: string[];
  sourceUrl: string;
  coverUrl: string;
  coverCloudinaryUrl: string;
  description: string;
  tags: string[];
  author: string;
  artist: string;
  status: string;
  totalChapters: number;
  chapterUrls: string[];
  crawlStatus: 'idle' | 'crawling' | 'done' | 'error';
  crawlError?: string;
  lastCrawledAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MangaSchema = new Schema<IManga>(
  {
    slug: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    alternativeTitles: [{ type: String }],
    sourceUrl: { type: String, required: true },
    coverUrl: { type: String, default: '' },
    coverCloudinaryUrl: { type: String, default: '' },
    description: { type: String, default: '' },
    tags: [{ type: String }],
    author: { type: String, default: '' },
    artist: { type: String, default: '' },
    status: { type: String, default: 'Unknown' },
    totalChapters: { type: Number, default: 0 },
    chapterUrls: [{ type: String }],
    crawlStatus: {
      type: String,
      enum: ['idle', 'crawling', 'done', 'error'],
      default: 'idle',
    },
    crawlError: { type: String },
    lastCrawledAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// ─── Exports ─────────────────────────────────────────────────────────────────

export const Manga: Model<IManga> =
  mongoose.models.Manga || mongoose.model<IManga>('Manga', MangaSchema);

export const Chapter: Model<IChapter> =
  mongoose.models.Chapter || mongoose.model<IChapter>('Chapter', ChapterSchema);

// ─── Crawl Job ────────────────────────────────────────────────────────────────

export interface ICrawlJob extends Document {
  id: string;
  urls: string[];
  startedAt: Date;
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress: Record<string, CrawlProgress>;
  logs: string[];
  createdAt: Date;
  updatedAt: Date;
}

const CrawlJobSchema = new Schema<ICrawlJob>(
  {
    id: { type: String, required: true, unique: true, index: true },
    urls: [{ type: String, required: true }],
    startedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['running', 'done', 'error', 'cancelled'],
      default: 'running',
      index: true,
    },
    // Use a map-like object keyed by mangaUrl -> CrawlProgress
    progress: { type: Schema.Types.Mixed, default: {} },
    logs: [{ type: String }],
  },
  { timestamps: true },
);

export const CrawlJob: Model<ICrawlJob> =
  mongoose.models.CrawlJob || mongoose.model<ICrawlJob>('CrawlJob', CrawlJobSchema);

// ─── Admin Settings ───────────────────────────────────────────────────────────

export interface IAdminSettings extends Document {
  key: string;
  urlsText: string;
  createdAt: Date;
  updatedAt: Date;
}

const AdminSettingsSchema = new Schema<IAdminSettings>(
  {
    key: { type: String, required: true, unique: true, index: true },
    urlsText: { type: String, default: '' },
  },
  { timestamps: true },
);

export const AdminSettings: Model<IAdminSettings> =
  mongoose.models.AdminSettings ||
  mongoose.model<IAdminSettings>('AdminSettings', AdminSettingsSchema);
