import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const IMAGE_URL_PATTERN = (baseImageNumber: number) =>
  `https://member.starcg.net/metamo/item/${baseImageNumber}.gif`;

const IMAGE_DIR = path.join(process.cwd(), 'public', 'item-images');
const IMAGE_EXT = 'gif';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const baseImageNumber = Number(body?.base_image_number);
    if (!Number.isFinite(baseImageNumber) || baseImageNumber <= 0) {
      return NextResponse.json({ error: 'invalid base_image_number' }, { status: 400 });
    }

    const filename = `${baseImageNumber}.${IMAGE_EXT}`;
    const fullPath = path.join(IMAGE_DIR, filename);
    const publicPath = `/item-images/${filename}`;

    // Skip if exists
    try {
      await access(fullPath, constants.F_OK);
      return NextResponse.json({ ok: true, image_path: publicPath, cached: true });
    } catch {
      // not present, fall through
    }

    await mkdir(IMAGE_DIR, { recursive: true });
    const upstream = await fetch(IMAGE_URL_PATTERN(baseImageNumber), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StarCGMarketTracker/1.0)' },
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    await writeFile(fullPath, buf);

    return NextResponse.json({ ok: true, image_path: publicPath, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
