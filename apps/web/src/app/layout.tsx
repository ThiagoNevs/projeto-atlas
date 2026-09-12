import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthShell, AuthenticatedUserMenu } from '../components/auth-shell';
import { AuthorizedNavigation } from '../components/authorized-navigation';

import './globals.css';

export const metadata: Metadata = {
  title: 'Atlas',
  description: 'Inteligência de ativos baseada em evidências.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthShell>
          <header className="site-header">
            <div className="nav-shell">
              <Link className="brand" href="/">
                <span className="brand-mark">A</span>
                <span>
                  <strong>Atlas</strong>
                  <small>Asset intelligence</small>
                </span>
              </Link>
              <AuthorizedNavigation />
              <AuthenticatedUserMenu />
            </div>
          </header>
          {children}
        </AuthShell>
      </body>
    </html>
  );
}
