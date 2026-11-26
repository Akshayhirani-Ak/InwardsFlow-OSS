import type { Metadata } from 'next';
import { Poppins, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// Typeface (his call, 24 Nov 2026): Poppins for UI text. IBM Plex Mono
// stays for product codes and container numbers — Poppins has no mono
// cut, and the mono zero is distinguishable from the letter O, which
// matters for part numbers.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'InwardsFlow WMS — Enterprise Receiving & Pallet Management',
  description:
    'Industrial Inbound Container, Pallet Ledger, and Manifest Receiving Reconciliation System.',
  authors: [{ name: 'InwardsFlow Team' }],
  creator: 'InwardsFlow',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${poppins.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-canvas text-ink font-sans antialiased flex flex-col">
        {children}
      </body>
    </html>
  );
}
