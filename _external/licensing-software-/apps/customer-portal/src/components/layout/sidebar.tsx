'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAuth } from '../providers/auth-provider';
import { apiClient } from '@/lib/api-client';
import {
  LayoutDashboard,
  Building2,
  Key,
  FileCheck2,
  KeyRound,
  MonitorCheck,
  History,
  Settings,
  HelpCircle,
  Headset,
  Search,
  PanelLeftClose,
  PanelLeft,
  ChevronUp,
  LogOut,
  User,
  ShieldCheck,
} from 'lucide-react';

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

/** badgeKey names a live count fetched in the Sidebar component — see badgeCounts below. */
interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  requiresAdmin: boolean;
  badgeKey?: 'pendingLicenseRequests';
  /** Hidden while the enterprise has 0 or 1 companies — nothing to view/manage yet. Reappears automatically once a vendor adds a second company. */
  hideWhenSingleCompany?: boolean;
  /** Hidden for a company-scoped session (allowedCompanyIds is a fixed single
   * company, not '*') — this page is now enterprise-level only: a child
   * company can no longer see or approve its own capacity requests here,
   * only the enterprise ("parent company") admin can. */
  enterpriseOnly?: boolean;
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'OPERATIONS',
    items: [
      { name: 'Overview', href: '/overview', icon: LayoutDashboard, requiresAdmin: false },
      { name: 'Companies', href: '/companies', icon: Building2, requiresAdmin: true, hideWhenSingleCompany: true },
      { name: 'Licenses', href: '/licenses', icon: Key, requiresAdmin: false },
      { name: 'License Requests', href: '/license-requests', icon: FileCheck2, requiresAdmin: false, badgeKey: 'pendingLicenseRequests', enterpriseOnly: true },
      { name: 'Activations', href: '/activations', icon: KeyRound, requiresAdmin: false },
      { name: 'Installations', href: '/installations', icon: MonitorCheck, requiresAdmin: false },
      { name: 'Fleet Protection', href: '/telemetry', icon: ShieldCheck, requiresAdmin: false },
    ]
  },
  {
    label: 'GOVERNANCE',
    items: [
      { name: 'Audit Logs', href: '/audit', icon: History, requiresAdmin: true },
      { name: 'Settings', href: '/settings', icon: Settings, requiresAdmin: true },
    ]
  },
  {
    label: 'SUPPORT',
    items: [
      { name: 'Help & Documentation', href: '#', icon: HelpCircle, requiresAdmin: false },
      { name: 'Contact Support', href: '#', icon: Headset, requiresAdmin: false },
    ]
  }
];

export function Sidebar({ isCollapsed, setIsCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  // Real counts for nav badges, keyed by badgeKey — replaces the previous
  // hardcoded `badge: 3`. Refetched on every navigation so approving/rejecting
  // a request elsewhere in the app is reflected here without a full reload.
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});
  // null while unknown (first load) — treated as "don't hide yet" below, so
  // the item doesn't flash hidden-then-shown on initial mount.
  const [companyCount, setCompanyCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient<{ status: string }[]>('/license-requests')
      .then((rows) => {
        if (cancelled) return;
        const pending = rows.filter((r) => r.status === 'PENDING').length;
        setBadgeCounts((prev) => ({ ...prev, pendingLicenseRequests: pending }));
      })
      .catch(() => {
        // Best-effort — a plain User role without license_request.read gets a
        // 403 here; just show no badge rather than an error in the sidebar.
        if (!cancelled) setBadgeCounts((prev) => ({ ...prev, pendingLicenseRequests: 0 }));
      });
    apiClient<unknown[]>('/companies')
      .then((rows) => {
        if (!cancelled) setCompanyCount(rows.length);
      })
      .catch(() => {
        // Best-effort — treat as "unknown" rather than hiding the nav item on error.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Filter groups based on permissions and company count, and resolve each
  // item's live badge count (if it declares a badgeKey) in place of the old
  // static number.
  const visibleGroups = NAV_GROUPS.map(group => ({
    ...group,
    items: group.items
      .filter(item => {
        if (item.requiresAdmin && !user.roles.includes('EnterpriseAdmin') && !user.roles.includes('CompanyAdmin')) {
          return false;
        }
        if (item.hideWhenSingleCompany && companyCount !== null && companyCount <= 1) {
          return false;
        }
        if (item.enterpriseOnly && !user.allowedCompanyIds.includes('*')) {
          return false;
        }
        return true;
      })
      .map(item => ({
        ...item,
        badge: item.badgeKey ? badgeCounts[item.badgeKey] : undefined,
      }))
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
            <div className="h-20 w-50 relative flex-shrink-0">
              <Image src="/tf-logo.png" alt="Trustfabric" fill className="object-contain" />
            </div>
          )}
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded-md hover:bg-zinc-800/50"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Search Bar */}
      <div className="px-3 mb-4 mt-2">
        <div className={`relative flex items-center bg-[#141824] rounded-md border border-zinc-800/60 transition-all ${isCollapsed ? 'justify-center py-2' : 'px-3 py-2'}`}>
          <Search className="h-4 w-4 text-zinc-500 shrink-0" />
          {!isCollapsed && (
            <>
              <input
                type="text"
                placeholder="Search..."
                className="bg-transparent border-none outline-none text-sm text-zinc-200 placeholder:text-zinc-600 ml-2 w-full focus:ring-0"
              />
              <div className="flex items-center gap-0.5 text-[10px] text-zinc-500 font-medium shrink-0 ml-2 bg-zinc-800/50 px-1.5 py-0.5 rounded">
                <span>⌘</span><span>K</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-6 pb-4 custom-scrollbar">
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

                    {/* Badge */}
                    {item.badge && (
                      <span className={`flex items-center justify-center text-[10px] font-bold rounded-full h-5 min-w-[20px] px-1 shrink-0 ${isCollapsed ? 'absolute -top-1 -right-1 ring-2 ring-[#0A0D14]' : ''
                        } bg-blue-600 text-white shadow-sm`}>
                        {item.badge}
                      </span>
                    )}
                  </Link>

                  {/* Tooltip for collapsed state */}
                  {isCollapsed && (
                    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 hidden group-hover/navitem:block z-50">
                      <div className="bg-zinc-800 text-zinc-100 text-xs font-medium px-2.5 py-1.5 rounded-md shadow-lg whitespace-nowrap border border-zinc-700/50 flex items-center gap-2">
                        {item.name}
                        {item.badge && (
                          <span className="bg-blue-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {/* Tooltip arrow */}
                      <div className="absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-2 bg-zinc-800 rotate-45 border-b border-l border-zinc-700/50" />
                    </div>
                  )}
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
