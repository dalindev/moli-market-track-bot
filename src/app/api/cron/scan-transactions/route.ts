import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// Rate limiting: 500ms delay between requests
const FETCH_DELAY = 500;
// Max pages to fetch
const MAX_PAGES = 5;

// Gold box item for exchange rate tracking
const GOLD_BOX_NAME = '魔幣箱（100萬）';
const GOLD_BOX_VALUE = 1000000; // 1 million gold

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
        scan_type: 'transaction',
        started_at: new Date().toISOString(),
        status: 'running',
      })
      .select()
      .single();

    scanLogId = scanLog?.id ?? null;

    // Get all tracked item names to filter transactions
    const { data: trackedItems } = await supabase
      .from('tracked_items')
      .select('items (id, name)')
      .eq('is_active', true);

    const trackedNames = new Map(
      (trackedItems || [])
        .filter(t => t.items)
        .map(t => {
          const item = t.items as { id: string; name: string };
          return [item.name, item.id];
        })
    );

    let totalPricesRecorded = 0;
    let exchangeRateUpdates = 0;
    const processedTransactions = new Set<number>();

    // Fetch recent transactions (no specific search, get all recent)
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const params = new URLSearchParams({
          ajax: '1',
          page: String(page),
          search: '',
          type: 'all',
        });

        const response = await fetch(
          `https://member.starcg.net/marketrecord.php?${params.toString()}`,
          {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (compatible; MarketTracker/1.0)',
            },
          }
        );

        if (!response.ok) {
          console.warn(`Market Record API returned ${response.status}`);
          break;
        }

        const data = await response.json();

        // Process logs
        for (const log of data.logs || []) {
          // Skip if already processed
          if (processedTransactions.has(log.id)) continue;
          processedTransactions.add(log.id);

          // Parse the buff string to get item name
          const parsed = parseLogBuff(log.buff, log.price);
          if (!parsed) continue;

          // Check for gold box transactions to update exchange rate
          if (parsed.name === GOLD_BOX_NAME && log.pricetype === 1) {
            // Gold box sold for crystals - update exchange rate
            const goldPerCrystal = GOLD_BOX_VALUE / parsed.unitPrice;
            const today = new Date().toISOString().split('T')[0];

            // Check if we already have a rate for today
            const { data: existing } = await supabase
              .from('exchange_rates')
              .select('*')
              .eq('rate_date', today)
              .single();

            if (existing) {
              // Update with weighted average
              const newSampleCount = existing.sample_count + 1;
              const newRate = (existing.gold_per_crystal * existing.sample_count + goldPerCrystal) / newSampleCount;

              await supabase
                .from('exchange_rates')
                .update({
                  gold_per_crystal: Math.round(newRate * 100) / 100,
                  source_item_price: parsed.unitPrice,
                  source_type: 'transaction',
                  sample_count: newSampleCount,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', existing.id);
            } else {
              // Insert new rate
              await supabase
                .from('exchange_rates')
                .insert({
                  rate_date: today,
                  gold_per_crystal: Math.round(goldPerCrystal * 100) / 100,
                  source_item_name: GOLD_BOX_NAME,
                  source_item_price: parsed.unitPrice,
                  source_type: 'transaction',
                  sample_count: 1,
                });
            }
            exchangeRateUpdates++;
          }

          // Check if this item is being tracked (exact match only)
          const itemId = trackedNames.get(parsed.name);
          if (!itemId) continue;

          // Use upsert_transaction RPC for deduplication
          // This checks transaction_id to avoid duplicates
          const { data: result, error: upsertError } = await supabase.rpc('upsert_transaction', {
            p_item_id: itemId,
            p_transaction_id: log.id,
            p_price: parsed.unitPrice,
            p_pricetype: log.pricetype,
            p_stall_name: log.buyname || 'Unknown',
            p_stall_cdkey: log.cdkey,
            p_quantity: parsed.quantity,
            p_recorded_at: new Date(log.time * 1000).toISOString(),
          });

          if (!upsertError && result === 'inserted') {
            totalPricesRecorded++;
          } else if (upsertError) {
            console.error('Error upserting transaction:', upsertError.message);
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
        console.error(`Error fetching transactions page ${page}:`, err);
        break;
      }
    }

    // Update statistics for all tracked items
    for (const [, itemId] of trackedNames) {
      await supabase.rpc('update_price_statistics', { p_item_id: itemId });
    }

    // Complete scan log
    if (scanLogId) {
      await supabase
        .from('scan_logs')
        .update({
          completed_at: new Date().toISOString(),
          status: 'completed',
          items_scanned: trackedNames.size,
          prices_recorded: totalPricesRecorded,
        })
        .eq('id', scanLogId);
    }

    return NextResponse.json({
      success: true,
      transactionsProcessed: processedTransactions.size,
      pricesRecorded: totalPricesRecorded,
      exchangeRateUpdates,
    });
  } catch (error) {
    console.error('Scan transactions error:', error);

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

interface ParsedBuff {
  name: string;
  quantity: number;
  unitPrice: number;
  type: 'item' | 'pet';
}

function parseLogBuff(buff: string, totalPrice: number): ParsedBuff | null {
  if (!buff) return null;

  // Determine type: 隻 = pet, 個 = item
  const isPet = buff.includes('隻');

  // Extract item name (after colon ：)
  const colonIndex = buff.indexOf('：');
  const name = colonIndex !== -1 ? buff.substring(colonIndex + 1).trim() : buff;

  if (!name) return null;

  // Extract quantity (number after 購買)
  const quantityMatch = buff.match(/購買(\d+)/);
  const quantity = quantityMatch ? parseInt(quantityMatch[1], 10) : 1;

  // Calculate unit price
  const unitPrice = Math.round(totalPrice / quantity);

  return {
    name,
    quantity,
    unitPrice,
    type: isPet ? 'pet' : 'item',
  };
}
