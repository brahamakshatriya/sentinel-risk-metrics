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
      default: 'bg-primary text-primary-foreground',
      outline: 'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground',
      destructive: 'border border-destructive text-destructive',
      ghost: 'hover:bg-accent hover:text-accent-foreground',
      secondary: 'border border-input bg-accent text-accent-foreground',
    };

    const sizeStyles = {
      default: 'h-10 px-4 py-2',
      sm: 'h-9 rounded-md px-3',
      lg: 'h-11 px-6 text-base',
      icon: 'h-10 w-10',
    };
    
    const classes = cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium',
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