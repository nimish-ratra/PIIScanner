import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/providers/auth-provider';
import { PortalShell } from '@/components/layout/portal-shell';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Enterprise Licensing Portal',
  description: 'Trustfabric Enterprise Software Licensing Management',
};

/**
 * Root layout.
 *
 * AuthProvider wraps all routes. On /login, the AuthProvider's 401 handler
 * checks if we're already on /login before redirecting to avoid loops.
 */
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
