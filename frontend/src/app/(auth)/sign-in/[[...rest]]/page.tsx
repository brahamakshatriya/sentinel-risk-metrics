'use client';

import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { LiquidGlassCard } from '@/components/ui/LiquidGlass';

const clerkAppearance = {
  elements: {
    rootBox: 'w-full',
    cardBox: 'w-full',
    card: 'w-full bg-transparent shadow-none border-none p-0 m-0',
    scrollBox: 'bg-transparent p-0',
    headerTitle: 'hidden',
    headerSubtitle: 'hidden',
    socialButtons: 'w-full',
    socialButtonsBlockButton:
      'border border-white/10 bg-white/5 text-foreground rounded-lg hover:bg-white/10 hover:border-white/20 transition-colors',
    socialButtonsBlockButtonText: 'text-foreground text-sm font-medium',
    dividerLine: 'bg-white/10',
    dividerText: 'text-muted-foreground text-xs',
    form: 'w-full',
    formFieldRow: 'w-full',
    formField: 'w-full',
    formFieldLabel: 'text-muted-foreground text-xs font-medium',
    formFieldInput:
      'bg-white/5 border-white/10 text-foreground rounded-lg placeholder:text-muted-foreground/50 focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-colors',
    formFieldInputShowPasswordButton: 'text-muted-foreground hover:text-foreground transition-colors',
    formFieldErrorText: 'text-red-400 text-xs',
    formButtonPrimary:
      'bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-sm font-semibold shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.5)] transition-colors',
    footerAction: 'items-center justify-center',
    footerActionText: 'text-muted-foreground text-sm',
    footerActionLink: 'text-primary hover:text-primary/80 hover:underline transition-colors',
    identityPreview: 'border-white/10 bg-white/5 rounded-lg',
    identityPreviewText: 'text-foreground text-sm',
    identityPreviewEditButton: 'text-primary hover:text-primary/80 transition-colors',
    alternativeMethodsBlockButton:
      'border-white/10 text-foreground hover:bg-white/5 rounded-lg transition-colors',
    otpCodeFieldInput:
      'border-white/10 bg-white/5 text-foreground rounded-lg focus:border-primary/60 transition-colors',
    formResendCodeLink: 'text-primary hover:text-primary/80 transition-colors',
    alert: 'border-red-500/30 bg-red-500/10 rounded-lg',
    alertText: 'text-red-200 text-sm',
  },
};

export default function SignInPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Sophisticated near-black environment: ambient light + faint grid, static CSS only */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(640px 320px at 50% -4%, hsl(var(--primary) / 0.13), transparent 70%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(560px 300px at 50% 112%, hsl(var(--primary) / 0.06), transparent 70%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(hsl(var(--foreground) / 0.035) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.035) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage:
              'radial-gradient(ellipse 72% 62% at 50% 42%, black 25%, transparent 78%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 72% 62% at 50% 42%, black 25%, transparent 78%)',
          }}
        />
      </div>

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-10 sm:px-6">
        {/* Branding */}
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">
            Sentinel
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Welcome back
          </h1>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Sign in to your risk intelligence terminal
          </p>
        </div>

        {/* Glass auth card — single translucent surface, no nested opaque cards */}
        <LiquidGlassCard intensity="medium" className="w-full" p={0}>
          <div className="px-5 py-6 sm:px-8 sm:py-8">
            <SignIn
              appearance={clerkAppearance}
              routing="path"
              path="/sign-in"
              signUpUrl="/sign-up"
              redirectUrl="/"
            />
          </div>
        </LiquidGlassCard>

        {/* Cross navigation + trust line */}
        <div className="mt-6 text-center text-sm">
          <span className="text-muted-foreground">Don&apos;t have an account? </span>
          <Link href="/sign-up" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground/70">
          Secured by Clerk
        </p>
      </main>
    </div>
  );
}
