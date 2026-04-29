import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { Manga } from '@/models';

export async function GET(req: NextRequest) {
  await connectDB();
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') ?? '1');
  const limit = parseInt(searchParams.get('limit') ?? '20');
  const tag = searchParams.get('tag') ?? '';
  const search = searchParams.get('search') ?? '';

  const filter: Record<string, unknown> = {};
  if (tag) filter.tags = { $in: [tag] };
  if (search) filter.title = { $regex: search, $options: 'i' };

  const [items, total] = await Promise.all([
    Manga.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('slug title coverCloudinaryUrl tags status totalChapters crawlStatus updatedAt')
      .lean(),
    Manga.countDocuments(filter),
  ]);

  return NextResponse.json({ items, total, page, limit });
}
