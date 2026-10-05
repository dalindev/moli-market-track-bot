import { NextRequest, NextResponse } from 'next/server';
import { toUpstreamMarketType } from '@/lib/market-params';
import { fetchUpstreamJson } from '@/lib/upstream-fetch';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const params = new URLSearchParams({
    ajax: '1',
    page: searchParams.get('page') || '1',
    search: searchParams.get('search') || '',
    type: toUpstreamMarketType(searchParams.get('type')),
    server: searchParams.get('server') || 'all',
    exact: searchParams.get('exact') || '0',
  });

  const result = await fetchUpstreamJson(
    `https://member.starcg.net/market.php?${params.toString()}`,
    { signal: request.signal }
  );

  if (result.ok) {
    return NextResponse.json(result.data);
  }

  const { failure } = result;
  console.error(
    `Market API error: ${failure.code} (${failure.status}) after ${failure.attempts} attempt(s): ${failure.message}`
  );

  // Pass the real cause through so the client can tell "the game server is busy, try again"
  // apart from "we sent a malformed query".
  return NextResponse.json(
    {
      error: failure.message || 'Failed to fetch market data',
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
