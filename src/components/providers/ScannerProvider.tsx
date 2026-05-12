'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useScanner } from '@/hooks/useScanner';

// Singleton scanner state across the entire app.
// Without this, every component that called useScanner() got its own
// private state — clicking "Refresh now" on Deals tab would start a sweep
// no other component could see, and the state would vanish when the tab
// unmounted on navigation.

type ScannerValue = ReturnType<typeof useScanner>;

const ScannerContext = createContext<ScannerValue | null>(null);

export function ScannerProvider({ children }: { children: ReactNode }) {
  const scanner = useScanner();
  return <ScannerContext.Provider value={scanner}>{children}</ScannerContext.Provider>;
}

export function useScannerState(): ScannerValue {
  const ctx = useContext(ScannerContext);
  if (!ctx) {
    throw new Error('useScannerState must be used within a <ScannerProvider />');
  }
  return ctx;
}
