'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAuth } from '../providers/auth-provider';
import {
  LayoutDashboard,
  Building2,
  Key,
  FileCheck2,
  KeyRound,
  MonitorCheck,
  History,
  Settings,
  Search,
  PanelLeftClose,
  PanelLeft,
  ShieldCheck,
} from 'lucide-react';

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

const NAV_GROUPS = [
  {
    label: 'OPERATIONS',
    items: [
      { name: 'Overview', href: '/dashboard', icon: LayoutDashboard, requiresAdmin: false },
      { name: 'Customers', href: '/customers', icon: Building2, requiresAdmin: false },
      { name: 'Products', href: '/products', icon: Key, requiresAdmin: false },
      { name: 'Entitlements', href: '/entitlements', icon: FileCheck2, requiresAdmin: false },
      { name: 'Activations', href: '/activations', icon: KeyRound, requiresAdmin: false },
      { name: 'Installations', href: '/installations', icon: MonitorCheck, requiresAdmin: false },
      { name: 'Fleet Health', href: '/fleet-health', icon: ShieldCheck, requiresAdmin: false },
    ]
  },
  {
    label: 'GOVERNANCE',
    items: [
      { name: 'Audit Logs', href: '/audit', icon: History, requiresAdmin: false },
      { name: 'Settings', href: '/settings', icon: Settings, requiresAdmin: true },
    ]
  }
];

export function Sidebar({ isCollapsed, setIsCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  // Filter groups based on permissions
  const visibleGroups = NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item => {
      // Logic for vendor roles. For now, we assume all vendor users see operations, only some see settings.
      if (item.requiresAdmin && !user.roles.includes('TrustfabricAdmin')) {
        return false;
      }
      return true;
    })
  })).filter(group => group.items.length > 0);

  return (
    <div
      className={`hidden md:flex md:flex-col md:fixed md:inset-y-0 z-30 bg-[#0A0D14] transition-all duration-300 ease-in-out border-r border-zinc-800/50 ${isCollapsed ? 'w-[68px]' : 'w-64'
        }`}
    >
      {/* Header / Logo */}
      <div className="flex items-center h-16 shrink-0 px-4 justify-between">
        <div className="flex items-center gap-3 overflow-hidden">
          {isCollapsed ? (
            <div className="w-20 h-20 flex-shrink-0 overflow-hidden relative">
              <Image src="/tf-logo.png" alt="Trustfabric" fill className="object-cover object-[0%_50%] scale-[2.5] origin-left" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-20 w-50 relative flex-shrink-0">
                <Image src="/tf-logo.png" alt="Trustfabric" fill className="object-contain object-left" />
              </div>
              <span className="text-zinc-400 text-xs font-semibold whitespace-nowrap uppercase tracking-wider ml-1 border-l border-zinc-700 pl-2">Admin</span>
            </div>
          )}
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded-md hover:bg-zinc-800/50 shrink-0"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-6 py-4 custom-scrollbar">
        {visibleGroups.map((group, gIdx) => (
          <div key={gIdx} className="space-y-1">
            {!isCollapsed && (
              <div className="px-3 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-2">
                {group.label}
              </div>
            )}
            {group.items.map((item) => {
              const isActive = pathname.startsWith(item.href) && item.href !== '#';
              return (
                <div key={item.name} className="relative group/navitem">
                  <Link
                    href={item.href}
                    className={`flex items-center rounded-md transition-all duration-200 relative ${isCollapsed ? 'justify-center p-2.5 mx-1' : 'px-3 py-2 gap-3 mx-1'
                      } ${isActive
                        ? 'bg-[#182235] text-blue-400'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#141824]'
                      }`}
                  >
                    {/* Active Left Indicator */}
                    {isActive && (
                      <div className="absolute left-[-4px] top-1.5 bottom-1.5 w-[3px] bg-blue-500 rounded-r-full shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                    )}

                    <item.icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? 'text-blue-500' : ''}`} />

                    {!isCollapsed && (
                      <span className="flex-1 text-sm font-medium whitespace-nowrap tracking-wide">{item.name}</span>
                    )}

                    {/* Tooltip for collapsed state */}
                    {isCollapsed && (
                      <div className="absolute left-full ml-3 px-2 py-1.5 bg-[#1E222E] text-zinc-200 text-xs font-medium rounded-md opacity-0 group-hover/navitem:opacity-100 pointer-events-none transition-opacity whitespace-nowrap shadow-xl z-50 border border-zinc-700/50">
                        {item.name}
                        {/* Tooltip arrow */}
                        <div className="absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-2 bg-[#1E222E] rotate-45 border-b border-l border-zinc-700/50" />
                      </div>
                    )}
                  </Link>
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 4px;
        }
        .custom-scrollbar:hover::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.2);
        }
      `}</style>
    </div>
  );
}
