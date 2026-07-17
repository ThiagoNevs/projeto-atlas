import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Atlas',
  description: 'Inteligência de ativos baseada em evidências.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <header className="site-header">
          <div className="nav-shell">
            <Link className="brand" href="/">
              <span className="brand-mark">A</span>
              <span>
                <strong>Atlas</strong>
                <small>Asset intelligence</small>
              </span>
            </Link>
            <nav aria-label="Navegação principal">
              <Link href="/">Dashboard</Link>
              <Link href="/assets">Ativos</Link>
              <Link href="/conflicts">Conflitos</Link>
              <Link href="/conflict-findings">Achados de identidade e rede</Link>
              <Link href="/network-discovery">Descoberta de rede</Link>
              <Link href="/audit">Auditoria</Link>
              <Link href="/data-quality">Qualidade dos dados</Link>
              <Link href="/data-sources">Fontes de dados</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
