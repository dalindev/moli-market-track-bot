import { EnchantStonesView } from '@/components/EnchantStonesView';

export const metadata = {
  title: '附魔石撿漏 - Market Tracker',
};

export default function EnchantStonesPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="container mx-auto py-8 px-4">
        <EnchantStonesView />
      </div>
    </div>
  );
}
