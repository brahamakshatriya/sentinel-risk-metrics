import { type Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import { Providers } from './components/Providers';
import { StatusBar } from '@/components/StatusBar';
import { CommandPalette } from '@/components/CommandPalette';
import { LiquidGlassFilters } from '@/components/ui/LiquidGlassFilters';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Sentinel — Portfolio Risk Analytics',
  description: 'Sentinel — Portfolio Risk Analytics',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className={`${inter.variable} font-sans antialiased dark bg-background text-foreground`}>
          <LiquidGlassFilters />
          <Providers>
            {children}
            <CommandPalette />
            <StatusBar position="bottom" />
          </Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}