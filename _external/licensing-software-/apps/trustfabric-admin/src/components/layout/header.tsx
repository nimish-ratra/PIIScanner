'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../providers/auth-provider';
import {
  LogOut, ChevronRight, ChevronDown,
  RotateCw, User, Settings, ShieldAlert
} from 'lucide-react';
import Link from 'next/link';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/customers': 'Customers',
  '/products': 'Products',
  '/entitlements': 'Entitlements',
  '/activations': 'Activations',
  '/installations': 'Installations',
  '/audit': 'Audit Logs',
  '/settings': 'Settings',
};

export function Header() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  // Every page here fetches its own data once on mount with no shared
  // cache/refresh signal between them and this header — a full reload is
  // the simplest way to guarantee the button actually refetches everything
  // currently on screen, rather than only being decorative.
  const handleRefresh = () => {
    setRefreshing(true);
    window.location.reload();
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userRef.current && !userRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const pageTitle = Object.entries(PAGE_TITLES).find(([key]) =>
    pathname?.startsWith(key)
  )?.[1] ?? '';

  return (
    <header className="h-16 shrink-0 bg-white flex items-center justify-between px-6 z-20 border-b border-zinc-200">
      
      {/* Left: Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-zinc-800">Trustfabric Admin</span>
        {pageTitle && (
          <>
            <ChevronRight className="h-4 w-4 text-zinc-400" />
            <span className="font-medium text-zinc-500">{pageTitle}</span>
          </>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3 sm:gap-4">
        
        {/* Refresh Button */}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition-all shadow-sm disabled:opacity-60"
        >
          <RotateCw className={`h-3.5 w-3.5 text-zinc-500 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        <div className="h-6 w-px bg-zinc-200 mx-1 hidden sm:block"></div>

        {/* User Dropdown */}
        <div className="relative ml-1" ref={userRef}>
          <button
            id="btn-user-menu"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className={`flex items-center gap-2.5 p-1 pr-2 rounded-full border transition-all ${userMenuOpen ? 'bg-zinc-50 border-zinc-300' : 'border-transparent hover:bg-zinc-50 hover:border-zinc-200'}`}
          >
            <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white bg-blue-700 shadow-sm">
              <ShieldAlert className="h-4 w-4 text-white" />
            </div>
            <div className="hidden sm:flex flex-col text-left mr-1">
              <span className="text-xs font-semibold text-zinc-800 leading-tight">{user.email}</span>
              <span className="text-[10px] font-medium text-zinc-500 leading-tight">{user.roles[0].replace(/([A-Z])/g, ' $1').trim()}</span>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-zinc-400 hidden sm:block" />
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="p-3 border-b border-zinc-100 flex items-center gap-3 bg-zinc-50/50">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white bg-blue-700 shrink-0 shadow-sm">
                  <ShieldAlert className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-zinc-800 truncate">{user.email}</div>
                  <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide mt-0.5">{user.roles[0].replace(/([A-Z])/g, ' $1').trim()}</div>
                </div>
              </div>
              <div className="p-1.5 flex flex-col gap-0.5">
                <Link href="/settings" className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-md transition-colors">
                  <User className="h-4 w-4 text-zinc-400" />
                  View Profile
                </Link>
                <Link href="/settings" className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-md transition-colors">
                  <Settings className="h-4 w-4 text-zinc-400" />
                  Account Settings
                </Link>
              </div>
              <div className="p-1.5 border-t border-zinc-100">
                <button id="btn-logout" onClick={logout} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors text-left">
                  <LogOut className="h-4 w-4 text-red-500" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
