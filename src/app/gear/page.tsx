import { GearQualityView } from '@/components/GearQualityView';

export const metadata = {
  title: '裝備品質掃描 - Market Tracker',
};

export default function GearPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="container mx-auto py-8 px-4">
        <GearQualityView />
      </div>
    </div>
  );
}
