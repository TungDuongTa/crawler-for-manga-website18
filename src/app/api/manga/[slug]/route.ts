import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { Manga, Chapter } from '@/models';

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } }
) {
  await connectDB();
  const { slug } = params;

  const manga = await Manga.findOne({ slug }).lean();
  if (!manga) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const chapters = await Chapter.find({ mangaSlug: slug, status: 'done' })
    .sort({ chapterNumber: 1 })
    .select('chapterNumber title pageCount crawledAt sourceUrl')
    .lean();

  return NextResponse.json({ manga, chapters });
}
