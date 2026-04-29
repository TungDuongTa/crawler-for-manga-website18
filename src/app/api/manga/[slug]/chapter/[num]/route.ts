import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { Chapter, Manga } from '@/models';

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string; num: string } }
) {
  await connectDB();
  const { slug, num } = params;
  const chapterNumber = parseFloat(num);

  const manga = await Manga.findOne({ slug }).select('_id title slug totalChapters').lean();
  if (!manga) return NextResponse.json({ error: 'Manga not found' }, { status: 404 });

  const chapter = await Chapter.findOne({
    mangaSlug: slug,
    chapterNumber,
    status: 'done',
  }).lean();

  if (!chapter) return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });

  // Get prev/next chapters
  const [prev, next] = await Promise.all([
    Chapter.findOne({ mangaSlug: slug, chapterNumber: { $lt: chapterNumber }, status: 'done' })
      .sort({ chapterNumber: -1 })
      .select('chapterNumber')
      .lean(),
    Chapter.findOne({ mangaSlug: slug, chapterNumber: { $gt: chapterNumber }, status: 'done' })
      .sort({ chapterNumber: 1 })
      .select('chapterNumber')
      .lean(),
  ]);

  return NextResponse.json({
    chapter,
    manga: { title: manga.title, slug: manga.slug },
    navigation: {
      prev: prev?.chapterNumber ?? null,
      next: next?.chapterNumber ?? null,
    },
  });
}
