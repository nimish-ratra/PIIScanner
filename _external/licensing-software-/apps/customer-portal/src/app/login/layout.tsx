import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '../globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Sign In — Enterprise Licensing Portal',
  description: 'Authenticate to access the Trustfabric Enterprise Licensing Portal.',
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={inter.className}>
      {/* Login layout has no sidebar, no header, no AuthProvider */}
      {children}
    </div>
  );
}
