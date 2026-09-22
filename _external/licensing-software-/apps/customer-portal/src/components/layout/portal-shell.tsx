'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (pathname === '/login' || pathname?.startsWith('/login')) {
    return <>{children}</>;
  }

  return (
    <div className="h-screen overflow-hidden bg-white text-zinc-900 font-sans flex">
      <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      {/* Content wrapper adjusts margin based on sidebar state */}
      <div 
        className={`flex flex-col h-screen min-w-0 flex-1 transition-all duration-300 ease-in-out ${
          isCollapsed ? 'ml-[68px]' : 'ml-64'
        }`}
      >
        <Header />
        <main className="flex-1 overflow-y-auto p-6 bg-zinc-50/40">
          {children}
        </main>
      </div>
    </div>
  );
}
