import { NextRequest, NextResponse } from 'next/server';
import { fetchUpstreamJson } from '@/lib/upstream-fetch';

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

  const result = await fetchUpstreamJson(
    `https://member.starcg.net/marketrecord.php?${params.toString()}`,
    // Transaction history barely moves; 1 min of caching keeps the scanner off the upstream's back.
    { revalidateSeconds: 60 }
  );

  if (result.ok) {
    return NextResponse.json(result.data);
  }

  const { failure } = result;
  console.error(
    `Market Record API error: ${failure.code} (${failure.status}) after ${failure.attempts} attempt(s): ${failure.message}`
  );

  return NextResponse.json(
    {
      error: failure.message || 'Failed to fetch market record data',
      code: failure.code,
      retryAfter: failure.retryAfterSeconds,
    },
    {
      status: failure.status,
      headers: failure.retryAfterSeconds > 0
        ? { 'Retry-After': String(failure.retryAfterSeconds) }
        : undefined,
    }
  );
}
