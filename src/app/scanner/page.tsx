import { Scanner } from '@/components/Scanner';
import { ScannerProvider } from '@/components/providers/ScannerProvider';

export default function ScannerPage() {
  return (
    <ScannerProvider>
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="container mx-auto py-8 px-4">
          <Scanner />
        </div>
      </div>
    </ScannerProvider>
  );
}
