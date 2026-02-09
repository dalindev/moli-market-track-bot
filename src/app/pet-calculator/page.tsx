'use client';

import { PetCalculator } from '@/components/PetCalculator';

export default function PetCalculatorPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <PetCalculator />
      </div>
    </div>
  );
}
