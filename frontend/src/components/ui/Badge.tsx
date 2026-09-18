'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

function Badge({ className, variant = 'default', ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'secondary' | 'destructive' | 'outline' }) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
        {
          'border-transparent bg-primary text-primary-foreground hover:bg-[#6D28D9]': variant === 'default',
          'border-[rgba(167,139,250,0.25)] bg-[rgba(124,58,237,0.12)] text-[#C4B5FD] hover:bg-[rgba(124,58,237,0.2)]': variant === 'secondary',
          'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20': variant === 'destructive',
          'border-[rgba(167,139,250,0.25)] text-muted-foreground hover:text-foreground hover:border-[rgba(167,139,250,0.4)]': variant === 'outline',
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };