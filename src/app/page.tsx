'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MarketSearch } from '@/components/MarketSearch';
import { TrackedItems } from '@/components/TrackedItems';
import { PriceHistory } from '@/components/PriceHistory';
import { MigrationPrompt } from '@/components/MigrationPrompt';
import { AuthGate } from '@/components/AuthGate';
import Link from 'next/link';

export default function Home() {
  return (
    <AuthGate>
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="container mx-auto py-8 px-4">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            星詠魔力 StarCG Market Tracker
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            Search and track prices from market stalls (支持简体/繁體搜索)
          </p>
          <Link href="/pet-calculator" className="inline-block mt-2 mr-4 text-sm text-blue-600 dark:text-blue-400 hover:underline">
            寵物檔位計算模擬器 →
          </Link>
          <Link href="/scanner" className="inline-block mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
            Deal Spotter Scanner →
          </Link>
        </header>

        {/* Migration prompt for users with existing localStorage data */}
        <div className="mb-6">
          <MigrationPrompt />
        </div>

        <Tabs defaultValue="search" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="search">Search Market</TabsTrigger>
            <TabsTrigger value="history">Price History</TabsTrigger>
            <TabsTrigger value="tracked">Tracked Items</TabsTrigger>
          </TabsList>

          <TabsContent value="search">
            <MarketSearch />
          </TabsContent>

          <TabsContent value="history">
            <PriceHistory />
          </TabsContent>

          <TabsContent value="tracked">
            <TrackedItems />
          </TabsContent>
        </Tabs>
      </div>
    </div>
    </AuthGate>
  );
}
