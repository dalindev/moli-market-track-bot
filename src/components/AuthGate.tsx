'use client';

import { ReactNode } from 'react';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const handleLogout = () => {
    // The auth cookie is httpOnly, so the server clears it (see src/proxy.ts)
    window.location.assign('/__logout');
  };

  return (
    <div className="relative">
      <button
        onClick={handleLogout}
        className="fixed top-4 right-4 text-xs text-muted-foreground hover:text-foreground z-50 px-2 py-1 rounded border border-transparent hover:border-zinc-700"
      >
        Logout
      </button>
      {children}
    </div>
  );
}
