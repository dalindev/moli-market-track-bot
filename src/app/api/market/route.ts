import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const params = new URLSearchParams({
    ajax: '1',
    page: searchParams.get('page') || '1',
    search: searchParams.get('search') || '',
    type: searchParams.get('type') || 'all',
    server: searchParams.get('server') || 'all',
    exact: searchParams.get('exact') || '0',
  });

  try {
    const response = await fetch(
      `https://member.starcg.net/market.php?${params.toString()}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; MarketTracker/1.0)',
        },
        next: { revalidate: 60 }, // Cache for 60 seconds
      }
    );

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Market API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market data' },
      { status: 500 }
    );
  }
}
