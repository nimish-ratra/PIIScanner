'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../providers/auth-provider';
import { apiClient } from '@/lib/api-client';
import {
  Building2, LogOut, ChevronRight, ChevronDown,
  Calendar, RotateCw, Bell, Search, User, Settings, Check, FileText, BarChart2, Monitor
} from 'lucide-react';
import Link from 'next/link';

interface Company {
  id: string;
  name: string;
}

const PAGE_TITLES: Record<string, string> = {
  '/overview': 'Overview',
  '/companies': 'Companies',
  '/licenses': 'Licenses',
  '/license-requests': 'License Requests',
  '/activations': 'Activations',
  '/installations': 'Installations',
  '/audit': 'Audit Logs',
  '/settings': 'Settings',
};

const MOCK_NOTIFICATIONS = [
  { id: 1, title: '3 pending license requests', desc: 'Require your approval', time: '5 min ago', icon: FileText, color: 'text-amber-500', bg: 'bg-amber-50' },
  { id: 2, title: 'Allocation nearing capacity', desc: 'Acme UK (90% allocated)', time: '1 hour ago', icon: BarChart2, color: 'text-blue-500', bg: 'bg-blue-50' },
  { id: 3, title: 'New installation detected', desc: 'Acme India', time: '3 hours ago', icon: Monitor, color: 'text-emerald-500', bg: 'bg-emerald-50' }
];

export function Header() {
  const { user, selectedCompanyId, setSelectedCompanyId, logout } = useAuth();
  const pathname = usePathname();
  const [companies, setCompanies] = useState<Company[]>([]);
  
  const [orgOpen, setOrgOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [pageLoadedAt] = useState(() => new Date());

  const orgRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (orgRef.current && !orgRef.current.contains(event.target as Node)) setOrgOpen(false);
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) setNotifOpen(false);
      if (userRef.current && !userRef.current.contains(event.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    apiClient<Company[]>('/companies')
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, [user]);

  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  // Every page here fetches its own data once on mount with no shared
  // cache/refresh signal between them and this header — a full reload is
  // the simplest way to guarantee the button actually refetches everything
  // currently on screen, rather than only being decorative.
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    window.location.reload();
  }, []);

  const isEnterpriseAdmin = user.isEnterpriseWide ?? false;
  // Driven by the actual number of companies under this enterprise, not by
  // the EnterpriseAdmin role itself — every customer is granted enterprise-
  // wide scope by design (see IdentityService.buildPrincipal) even when they
  // only have the single default company created at onboarding, so gating
  // on the role alone showed a useless switcher with nothing to switch to.
  const hasMultipleCompanies = companies.length > 1;

  const pageTitle = Object.entries(PAGE_TITLES).find(([key]) =>
    pathname?.startsWith(key)
  )?.[1] ?? '';

  const selectedCompany = isEnterpriseAdmin && selectedCompanyId === '*' 
    ? { id: '*', name: 'All Companies' } 
    : companies.find(c => c.id === selectedCompanyId);

  const filteredCompanies = companies.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const formattedDate = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const formattedLoadTime = pageLoadedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <header className="h-16 shrink-0 bg-white flex items-center justify-between px-6 z-20 border-b border-zinc-200">
      
      {/* Left: Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-zinc-800">Customer Portal</span>
        {pageTitle && (
          <>
            <ChevronRight className="h-4 w-4 text-zinc-400" />
            <span className="font-medium text-zinc-500">{pageTitle}</span>
          </>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3 sm:gap-4">
        
        {/* Date & Time (Hidden on small screens) */}
        <div className="hidden lg:flex items-center gap-3 mr-2">
          <Calendar className="h-4 w-4 text-zinc-400" />
          <div className="flex flex-col justify-center">
            <span className="text-xs font-semibold text-zinc-700 leading-tight">{formattedDate}</span>
            <span className="text-[10px] font-medium text-zinc-400 leading-tight mt-0.5">Updated at {formattedLoadTime}</span>
          </div>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition-all shadow-sm disabled:opacity-60"
        >
          <RotateCw className={`h-3.5 w-3.5 text-zinc-500 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        {/* Organization Selector */}
        {hasMultipleCompanies && (
          <div className="relative" ref={orgRef}>
            <button 
              onClick={() => { setOrgOpen(!orgOpen); setNotifOpen(false); setUserMenuOpen(false); }}
              className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-semibold transition-all shadow-sm ${orgOpen ? 'bg-zinc-50 border-zinc-300 text-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300'}`}
            >
              <Building2 className="h-3.5 w-3.5 text-zinc-500" />
              <span className="truncate max-w-[140px]">{selectedCompany?.name || 'Select Company'}</span>
              <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
            </button>

            {orgOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="p-2 border-b border-zinc-100">
                  <div className="relative flex items-center">
                    <Search className="absolute left-2.5 h-3.5 w-3.5 text-zinc-400" />
                    <input 
                      type="text" 
                      placeholder="Search organization..." 
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto p-1.5">
                  {isEnterpriseAdmin && (!searchQuery || 'all companies'.includes(searchQuery.toLowerCase())) && (
                    <button
                      onClick={() => { setSelectedCompanyId('*'); setOrgOpen(false); }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-left rounded-md transition-colors ${selectedCompanyId === '*' ? 'bg-blue-50' : 'hover:bg-zinc-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <Building2 className={`h-4 w-4 ${selectedCompanyId === '*' ? 'text-blue-600' : 'text-zinc-400'}`} />
                        <div>
                          <div className={`text-xs font-medium ${selectedCompanyId === '*' ? 'text-blue-900' : 'text-zinc-700'}`}>All Companies</div>
                          <div className={`text-[10px] ${selectedCompanyId === '*' ? 'text-blue-600' : 'text-zinc-400'}`}>Enterprise scope</div>
                        </div>
                      </div>
                      {selectedCompanyId === '*' && <Check className="h-4 w-4 text-blue-600" />}
                    </button>
                  )}
                  {filteredCompanies.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedCompanyId(c.id); setOrgOpen(false); }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-left rounded-md transition-colors mt-0.5 ${selectedCompanyId === c.id ? 'bg-blue-50' : 'hover:bg-zinc-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <Building2 className={`h-4 w-4 ${selectedCompanyId === c.id ? 'text-blue-600' : 'text-zinc-400'}`} />
                        <div>
                          <div className={`text-xs font-medium ${selectedCompanyId === c.id ? 'text-blue-900' : 'text-zinc-700'}`}>{c.name}</div>
                          <div className={`text-[10px] ${selectedCompanyId === c.id ? 'text-blue-600' : 'text-zinc-400'}`}>Subsidiary</div>
                        </div>
                      </div>
                      {selectedCompanyId === c.id && <Check className="h-4 w-4 text-blue-600" />}
                    </button>
                  ))}
                  {filteredCompanies.length === 0 && (
                    <div className="px-3 py-4 text-center text-xs text-zinc-500">No organizations found.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="h-6 w-px bg-zinc-200 mx-1 hidden sm:block"></div>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button 
            onClick={() => { setNotifOpen(!notifOpen); setOrgOpen(false); setUserMenuOpen(false); }}
            className={`relative p-2 rounded-full transition-colors ${notifOpen ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700'}`}
          >
            <Bell className="h-4 w-4" />
            <span className="absolute top-1 right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white ring-2 ring-white">
              3
            </span>
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="p-3 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                <span className="text-xs font-semibold text-zinc-800">Notifications</span>
                <button className="text-[10px] font-medium text-blue-600 hover:text-blue-700 hover:underline">Mark all as read</button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {MOCK_NOTIFICATIONS.map(n => (
                  <div key={n.id} className="p-3 border-b border-zinc-50 hover:bg-zinc-50 transition-colors flex gap-3 cursor-pointer">
                    <div className={`mt-0.5 h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${n.bg} ${n.color}`}>
                      <n.icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-0.5">
                        <p className="text-xs font-medium text-zinc-800 truncate pr-2">{n.title}</p>
                        <span className="text-[9px] text-zinc-400 whitespace-nowrap">{n.time}</span>
                      </div>
                      <p className="text-[10px] text-zinc-500 line-clamp-1">{n.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-2 border-t border-zinc-100 text-center bg-zinc-50/50">
                <button className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center justify-center w-full py-1">
                  View all notifications <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User Dropdown */}
        <div className="relative ml-1" ref={userRef}>
          <button
            id="btn-user-menu"
            onClick={() => { setUserMenuOpen(!userMenuOpen); setOrgOpen(false); setNotifOpen(false); }}
            className={`flex items-center gap-2.5 p-1 pr-2 rounded-full border transition-all ${userMenuOpen ? 'bg-zinc-50 border-zinc-300' : 'border-transparent hover:bg-zinc-50 hover:border-zinc-200'}`}
          >
            <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white bg-blue-700 shadow-sm">
              {user.email.charAt(0).toUpperCase()}
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
                  {user.email.charAt(0).toUpperCase()}
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
                <button id="btn-logout" onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors text-left">
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
