import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { AdminSettings } from '@/models';

const SETTINGS_KEY = 'default';

export async function GET() {
  await connectDB();
  const doc = await AdminSettings.findOne({ key: SETTINGS_KEY }).lean<{ urlsText?: string }>();
  return NextResponse.json({ urlsText: doc?.urlsText ?? '' });
}

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const body = await req.json();
    const urlsText = typeof body?.urlsText === 'string' ? body.urlsText : '';

    await AdminSettings.findOneAndUpdate(
      { key: SETTINGS_KEY },
      { $set: { urlsText } },
      { upsert: true, new: true },
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

