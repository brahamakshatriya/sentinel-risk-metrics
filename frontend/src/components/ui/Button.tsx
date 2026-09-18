'use client';

import * as React from 'react';
import Link from 'next/link';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'destructive' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  asChild?: boolean;
  href?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', asChild = false, href, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    
    const variantStyles = {
      default:
        'bg-primary text-primary-foreground shadow-[0_8px_24px_-12px_rgba(124,58,237,0.8)] hover:bg-[#6D28D9] focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground',
      outline:
        'border bg-white/[0.02] hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring disabled:opacity-50',
      destructive:
        'bg-destructive/15 border border-destructive/40 text-red-300 hover:bg-destructive/25 focus-visible:ring-destructive disabled:opacity-50',
      ghost: 'hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring disabled:opacity-50',
      secondary:
        'border bg-secondary text-secondary-foreground hover:bg-accent focus-visible:ring-ring disabled:opacity-50',
    };

    const sizeStyles = {
      default: 'h-10 px-4 py-2',
      sm: 'h-9 rounded-md px-3',
      lg: 'h-11 px-6 text-base',
      icon: 'h-10 w-10',
    };
    
    const classes = cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium',
      'transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:pointer-events-none',
      variantStyles[variant],
      sizeStyles[size],
      className
    );

    if (href) {
      return (
        <Link href={href} className={classes} ref={ref as React.Ref<HTMLAnchorElement>}>
          {props.children}
        </Link>
      );
    }
    
    return (
      <Comp className={classes} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button };