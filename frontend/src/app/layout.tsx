import { type Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './components/Providers';

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
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased dark bg-background text-foreground`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}