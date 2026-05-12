'use client';

import type { RankedListing } from '@/lib/deal-finder';
import { useState } from 'react';

const GOLD = '💰';
const CRYSTAL = '💎';

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function copyCoords(coords: string, server: number) {
  const text = `S${server} ${coords}`;
  void navigator.clipboard?.writeText(text);
}

export function DealCard({ deal }: { deal: RankedListing }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    copyCoords(deal.coords, deal.server);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const isHot = (Date.now() - new Date(deal.recordedAt).getTime()) < 10 * 60 * 1000;
  const priceCurrencyEmoji = deal.pricetype === 0 ? GOLD : CRYSTAL;

  const borderClass = deal.isScreamingDeal
    ? 'border-red-400 dark:border-red-700 shadow-md shadow-red-100 dark:shadow-red-950'
    : deal.isMispriceCandidate
    ? 'border-orange-300 dark:border-orange-800'
    : 'border-zinc-200 dark:border-zinc-800';

  return (
    <div className={`rounded-lg border-2 ${borderClass} bg-white dark:bg-zinc-900 p-4 space-y-3`}>
      {/* Header: icon, name, type badge, misprice flag */}
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {deal.imagePath
          ? <img src={deal.imagePath} alt="" className="w-10 h-10 object-contain flex-shrink-0" />
          : <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 flex-wrap">
            <span className="truncate">{deal.itemName}</span>
            {deal.itemType === 'pet' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300">
                pet
              </span>
            )}
            {deal.itemLevel && (
              <span className="text-xs text-zinc-500">Lv{deal.itemLevel}</span>
            )}
            {deal.isScreamingDeal && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 font-bold">
                🔥 SCREAMING
              </span>
            )}
            {deal.isMispriceCandidate && !deal.isScreamingDeal && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300">
                ⚠ misprice-prone
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            fair value:{' '}
            {deal.fairValueGold ? `${fmt(deal.fairValueGold)} ${GOLD}` : '— (no history)'}
            {deal.listingMedianGold && (
              <> · peer median: {fmt(deal.listingMedianGold)} {GOLD}</>
            )}
          </div>
        </div>
      </div>

      {/* Price + delta */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          {fmt(deal.price)} {priceCurrencyEmoji}
        </div>
        {deal.pctBelowFair !== null && deal.pctBelowFair > 0 && (
          <div className="text-sm px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {deal.pctBelowFair}% below fair
          </div>
        )}
        {deal.pctBelowListingMedian !== null && deal.pctBelowListingMedian > 0 && (
          <div className="text-sm px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            {deal.pctBelowListingMedian}% below peers
          </div>
        )}
        {deal.profitGold > 0 && (
          <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            +{fmt(deal.profitGold)} {GOLD} potential
          </div>
        )}
      </div>

      {/* Action: coords + copy */}
      <div className="flex items-center gap-2 text-sm border-t border-zinc-100 dark:border-zinc-800 pt-3">
        <span className="font-mono text-zinc-700 dark:text-zinc-300 flex-1 truncate">
          📍 S{deal.server} · {deal.coords}
        </span>
        <button
          onClick={handleCopy}
          className="text-xs px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
        >
          {copied ? '✓ copied' : '📋 copy'}
        </button>
        <span className={`text-xs ${isHot ? 'text-red-600 dark:text-red-400 font-medium' : 'text-zinc-500'}`}>
          {isHot && '🔥 '}{timeAgo(deal.recordedAt)}
        </span>
      </div>
    </div>
  );
}
