import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

// Item icons live at two patterns on member.starcg.net depending on image number range:
//   - Older 5-digit numbers (gems, etc.): /metamo/item/{N}.gif
//   - Newer numbers (food, 升星卡, etc.): /metamo/png/{N}.png
// We try both. Some items (e.g., 改造圖) have no icon at either — return 404 from this route.
const URL_PATTERNS: Array<{ url: (n: number) => string; ext: 'gif' | 'png' }> = [
  { url: (n) => `https://member.starcg.net/metamo/item/${n}.gif`, ext: 'gif' },
  { url: (n) => `https://member.starcg.net/metamo/png/${n}.png`, ext: 'png' },
];

const IMAGE_DIR = path.join(process.cwd(), 'public', 'item-images');

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const baseImageNumber = Number(body?.base_image_number);
    if (!Number.isFinite(baseImageNumber) || baseImageNumber <= 0) {
      return NextResponse.json({ error: 'invalid base_image_number' }, { status: 400 });
    }

    // Check cache: an item may already be saved under either extension
    for (const { ext } of URL_PATTERNS) {
      const filename = `${baseImageNumber}.${ext}`;
      const fullPath = path.join(IMAGE_DIR, filename);
      if (await fileExists(fullPath)) {
        return NextResponse.json({
          ok: true,
          image_path: `/item-images/${filename}`,
          cached: true,
        });
      }
    }

    await mkdir(IMAGE_DIR, { recursive: true });

    // Try each upstream pattern in order
    const attempts: string[] = [];
    for (const { url, ext } of URL_PATTERNS) {
      const upstream = await fetch(url(baseImageNumber), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StarCGMarketTracker/1.0)' },
      });
      attempts.push(`${url(baseImageNumber)} → ${upstream.status}`);
      if (upstream.ok) {
        const filename = `${baseImageNumber}.${ext}`;
        const fullPath = path.join(IMAGE_DIR, filename);
        const buf = Buffer.from(await upstream.arrayBuffer());
        await writeFile(fullPath, buf);
        return NextResponse.json({
          ok: true,
          image_path: `/item-images/${filename}`,
          cached: false,
        });
      }
    }

    // No pattern returned a valid image
    return NextResponse.json(
      { error: 'no image found', attempts },
      { status: 404 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
