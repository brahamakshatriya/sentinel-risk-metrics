'use client';

import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { LiquidGlassCard } from '@/components/ui/LiquidGlass';
import dynamic from 'next/dynamic';

// CRTWarp — subtle CRT-plasma terminal atmosphere behind the auth surface.
// Client-only + code-split: three.js stays out of the initial bundle and
// never touches SSR. The wrapper is pointer-events:none so Clerk inputs,
// buttons, and OAuth are never blocked.
const CRTWarp = dynamic(() => import('@/components/CRTWarp').then((mod) => mod.default), {
  ssr: false,
  loading: () => null,
});

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
      {/* Layer 0 — CRTWarp terminal atmosphere (replaces the previous static
          ambient/grid background; single animated background system). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
        <CRTWarp
          color="#7C3AED"
          backgroundColor="#070A12"
          speed={0.18}
          curvature={0.16}
          scanlineStrength={0.08}
          scanlineFrequency={180}
          waveAmplitude={0.16}
          waveFrequency={2.0}
          bloom={0.7}
          bloomRadius={0.8}
          noise={0.025}
          vignette={0.45}
          brightness={0.72}
          pixelation={1}
          rgbShift={0}
          mouseReact
          mouseStrength={0.22}
          dpr={1}
          fps={24}
        />
      </div>

      {/* Layer 1 — readability veil: quiet dark-navy calm behind the auth
          content. Static gradient only; CRTWarp stays visible around it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_70%_60%_at_50%_42%,rgba(7,10,18,0.62),rgba(7,10,18,0.22)_60%,transparent_80%)]"
      />

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
