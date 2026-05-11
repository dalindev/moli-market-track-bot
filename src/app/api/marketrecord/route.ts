import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const params = new URLSearchParams({
    ajax: '1',
    page: searchParams.get('page') || '1',
    search: searchParams.get('search') || '',
    type: searchParams.get('type') || 'all',
    range: searchParams.get('range') || '30d',
    currency: searchParams.get('currency') || 'all',
    sort: searchParams.get('sort') || 'time_desc',
  });

  try {
    const response = await fetch(
      `https://member.starcg.net/marketrecord.php?${params.toString()}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; StarCGMarketTracker/1.0)',
        },
        next: { revalidate: 60 }, // 1 min cache (down from 5 min — we need fresher data for the scanner)
      }
    );

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Market Record API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market record data' },
      { status: 500 }
    );
  }
}
