'use client';

import { ReactNode } from 'react';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const handleLogout = () => {
    // Clear the auth cookie by setting it to expire
    document.cookie = 'site-auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    window.location.reload();
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
