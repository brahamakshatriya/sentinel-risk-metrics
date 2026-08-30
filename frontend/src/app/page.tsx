'use client';

import { useAuth } from '@clerk/nextjs';
import dynamic from 'next/dynamic';

const LandingPageClient = dynamic(() => import('@/components/LandingPage').then((mod) => mod.LandingPage), {
  ssr: false,
  loading: () => <div className="min-h-screen flex items-center justify-center bg-background" />,
});

const PortfolioListPageClient = dynamic(() => import('@/components/PortfolioListPage').then((mod) => mod.PortfolioListPage), {
  ssr: false,
  loading: () => <div className="min-h-screen flex items-center justify-center bg-background">Loading...</div>,
});

export default function HomePage() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-background">
        <LandingPageClient />
      </div>
    );
  }

  return <PortfolioListPageClient />;
}