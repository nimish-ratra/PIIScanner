import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/providers/auth-provider';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { PortalShell } from '@/components/layout/portal-shell';
import { LayoutDashboard, Building2, Shield, FileCheck, Server, Activity, Settings } from 'lucide-react';
import Link from 'next/link';

const inter = Inter({ subsets: ['latin'] });

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Customers', href: '/customers', icon: Building2 },
  { name: 'Products', href: '/products', icon: Shield },
  { name: 'Entitlements', href: '/entitlements', icon: FileCheck },
  { name: 'Installations', href: '/installations', icon: Server },
  { name: 'Global Audit', href: '/audit', icon: Activity },
  { name: 'Policies', href: '/settings', icon: Settings },
];

export const metadata: Metadata = {
  title: 'Enterprise Licensing Portal',
  description: 'Manage entitlements, allocations, and installations',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <PortalShell>
            {children}
          </PortalShell>
        </AuthProvider>
      </body>
    </html>
  );
}
