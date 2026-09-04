'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ToastProvider } from '@/components/ui/Toast';
import { Toaster } from '@/components/ui/Toaster';
import { setGetTokenFn } from '@/lib/api';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );
  const { getToken } = useAuth();

  // Set up the token getter for API calls.
  // Use the default Clerk session JWT — this is what FastAPI verifies
  // via CLERK_JWKS_URL / CLERK_ISSUER. Do NOT request a named template
  // (e.g. 'supabase') unless the backend is configured to verify it:
  // a missing template rejects, the interceptor swallows the error, and
  // the request goes out with no Authorization header (401).
  useEffect(() => {
    setGetTokenFn(async () => {
      try {
        return await getToken();
      } catch {
        return null;
      }
    });
  }, [getToken]);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {children}
        <Toaster />
      </ToastProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}