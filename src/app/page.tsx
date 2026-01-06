'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MarketSearch } from '@/components/MarketSearch';
import { TrackedItems } from '@/components/TrackedItems';

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="container mx-auto py-8 px-4">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            Market Tracker
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            Search and track prices from Star Citizen market stalls
          </p>
        </header>

        <Tabs defaultValue="search" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="search">Search Market</TabsTrigger>
            <TabsTrigger value="tracked">Tracked Items</TabsTrigger>
          </TabsList>

          <TabsContent value="search">
            <MarketSearch />
          </TabsContent>

          <TabsContent value="tracked">
            <TrackedItems />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
