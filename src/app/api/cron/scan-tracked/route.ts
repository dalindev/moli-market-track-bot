import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// Rate limiting: 500ms delay between requests
const FETCH_DELAY = 500;
// Max pages per item search
const MAX_PAGES = 3;

// Helper to delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function GET(request: NextRequest) {
  // Verify cron secret for Vercel cron jobs
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  let scanLogId: string | null = null;

  try {
    // Create scan log
    const { data: scanLog } = await supabase
      .from('scan_logs')
      .insert({
        scan_type: 'tracked',
        started_at: new Date().toISOString(),
        status: 'running',
      })
      .select()
      .single();

    scanLogId = scanLog?.id ?? null;

    // Get active tracked items
    const { data: trackedItems, error: fetchError } = await supabase
      .from('tracked_items')
      .select(`
        id,
        item_id,
        alert_threshold,
        items (
          id,
          name,
          item_type,
          item_level
        )
      `)
      .eq('is_active', true);

    if (fetchError) throw fetchError;

    let totalItemsScanned = 0;
    let totalPricesRecorded = 0;

    // Process each tracked item
    for (const tracked of trackedItems || []) {
      const item = tracked.items as { id: string; name: string; item_type: string; item_level: number | null };
      if (!item) continue;

      try {
        // Fetch market data for this item (exact match)
        const prices = await fetchMarketPrices(item.name, item.item_type, item.item_level);

        if (prices.length > 0) {
          // Save to price_snapshots
          const snapshotData = prices.map(price => ({
            item_id: item.id,
            price: price.price,
            pricetype: price.pricetype,
            server: price.server,
            stall_name: price.stallName,
            stall_cdkey: price.cdkey,
            coords: price.coords,
            source: 'market' as const,
          }));

          const { error: insertError } = await supabase
            .from('price_snapshots')
            .insert(snapshotData);

          if (insertError) {
            console.error(`Error saving prices for ${item.name}:`, insertError);
          } else {
            totalPricesRecorded += prices.length;
          }

          // Update statistics
          await supabase.rpc('update_price_statistics', { p_item_id: item.id });
        }

        // Update last_checked timestamp
        await supabase
          .from('tracked_items')
          .update({ last_checked: new Date().toISOString() })
          .eq('id', tracked.id);

        totalItemsScanned++;

        // Rate limit
        await delay(FETCH_DELAY);
      } catch (itemError) {
        console.error(`Error processing ${item.name}:`, itemError);
      }
    }

    // Complete scan log
    if (scanLogId) {
      await supabase
        .from('scan_logs')
        .update({
          completed_at: new Date().toISOString(),
          status: 'completed',
          items_scanned: totalItemsScanned,
          prices_recorded: totalPricesRecorded,
        })
        .eq('id', scanLogId);
    }

    return NextResponse.json({
      success: true,
      itemsScanned: totalItemsScanned,
      pricesRecorded: totalPricesRecorded,
    });
  } catch (error) {
    console.error('Scan tracked items error:', error);

    // Update scan log with error
    if (scanLogId) {
      await supabase
        .from('scan_logs')
        .update({
          completed_at: new Date().toISOString(),
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
        })
        .eq('id', scanLogId);
    }

    return NextResponse.json(
      { error: 'Scan failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

interface MarketPrice {
  price: number;
  pricetype: number;
  server: number;
  stallName: string;
  cdkey: string;
  coords: string;
}

async function fetchMarketPrices(itemName: string, itemType: string, itemLevel: number | null = null): Promise<MarketPrice[]> {
  const prices: MarketPrice[] = [];
  const type = itemType === 'pet' ? '寵物攤位' : '道具攤位';

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({
        ajax: '1',
        page: String(page),
        search: itemName,
        type,
        server: 'all',
        exact: '1',
      });

      const response = await fetch(
        `https://member.starcg.net/market.php?${params.toString()}`,
        {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; MarketTracker/1.0)',
          },
        }
      );

      if (!response.ok) {
        console.warn(`Market API returned ${response.status} for ${itemName}`);
        break;
      }

      const data = await response.json();
      const stallMap = new Map(data.stalls?.map((s: { cdkey: string; server: number; name: string; coords: string }) => [s.cdkey, s]) || []);

      // Process items
      if (itemType === 'item' && data.itemsByCd) {
        for (const [cdkey, items] of Object.entries(data.itemsByCd)) {
          const stall = stallMap.get(cdkey) as { server: number; name: string; coords: string } | undefined;
          if (!stall) continue;

          for (const item of items as { price: number; pricetype: number; ITEM_TRUENAME: string; ITEM_LEVEL: number }[]) {
            // Exact name match + level filter
            const nameMatches = item.ITEM_TRUENAME === itemName;
            const levelMatches = itemLevel === null || item.ITEM_LEVEL === itemLevel;
            if (nameMatches && levelMatches) {
              prices.push({
                price: item.price,
                pricetype: item.pricetype,
                server: stall.server,
                stallName: stall.name,
                cdkey,
                coords: stall.coords,
              });
            }
          }
        }
      }

      // Process pets
      if (itemType === 'pet' && data.petsByCd) {
        for (const [cdkey, pets] of Object.entries(data.petsByCd)) {
          const stall = stallMap.get(cdkey) as { server: number; name: string; coords: string } | undefined;
          if (!stall) continue;

          for (const pet of pets as { price: number; pricetype: number; Name: string }[]) {
            // Exact name match for pets
            if (pet.Name === itemName) {
              prices.push({
                price: pet.price,
                pricetype: pet.pricetype,
                server: stall.server,
                stallName: stall.name,
                cdkey,
                coords: stall.coords,
              });
            }
          }
        }
      }

      // Check if more pages exist
      const totalPages = Math.ceil(data.totalFiltered / data.perPage);
      if (page >= totalPages) break;

      // Rate limit between pages
      if (page < MAX_PAGES) {
        await delay(FETCH_DELAY);
      }
    } catch (err) {
      console.error(`Error fetching page ${page} for ${itemName}:`, err);
      break;
    }
  }

  return prices;
}
