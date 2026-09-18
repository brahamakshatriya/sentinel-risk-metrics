'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import dynamic from 'next/dynamic';
import { BarChart2, Activity, Zap, Shield, TrendingUp, Globe, Cpu, Lock } from 'lucide-react';
import { LiquidGlassCard } from '@/components/ui/LiquidGlass';
import GlassSurface from '@/components/GlassSurface';

const VolatilitySurface = dynamic(
  () => import('@/components/VolatilitySurface').then((mod) => mod.default),
  { ssr: false, loading: () => <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" /> }
);

// React Bits DotGrid — lightweight Canvas 2D interactive dot field.
// Code-split + client-only: pulls in gsap/InertiaPlugin outside the initial
// bundle and never touches SSR (window/Path2D guards inside).
const DotGrid = dynamic(() => import('@/components/DotGrid').then((mod) => mod.default), {
  ssr: false,
  loading: () => null,
});

const features = [
  {
    icon: Activity,
    title: 'Real-time VaR & CVaR',
    description: 'Historical, Parametric, and Monte Carlo Value-at-Risk with Conditional VaR for tail risk analysis. Sub-second recalculation on portfolio changes.',
    metric: '99.9% confidence',
  },
  {
    icon: TrendingUp,
    title: 'Correlation & Volatility',
    description: 'Dynamic correlation matrices, rolling volatility, and regime detection. EWMA and GARCH models for forward-looking risk estimates.',
    metric: 'Real-time updates',
  },
  {
    icon: Cpu,
    title: 'Monte Carlo Simulation',
    description: 'Geometric Brownian Motion with 10,000+ paths per second. Customizable drift, volatility, and jump-diffusion parameters.',
    metric: '10k+ paths/sec',
  },
  {
    icon: Shield,
    title: 'Scenario Stress Testing',
    description: 'Historical crises (2008, 2020, custom shocks) and user-defined scenarios. Instant portfolio revaluation under stress.',
    metric: 'Pre-built & custom',
  },
];

const stats = [
  { value: '10,000+', label: 'Simulations per second' },
  { value: '< 100ms', label: 'VaR recalculation latency' },
  { value: '50+', label: 'Supported asset classes' },
  { value: '99.9%', label: 'Confidence levels supported' },
];

function ScrollIndicator() {
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 200], [0, 1]);
  const opacity = useTransform(scrollY, [0, 100, 300], [1, 0.6, 0]);

  return (
    <motion.div
      className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 text-muted-foreground/40"
      style={{ opacity, y }}
      animate={{ y: [0, 8, 0] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      aria-hidden="true"
    >
      <span className="text-[10px] uppercase tracking-[0.25em]">Scroll</span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 5v14M19 12l-7 7-7-7" />
      </svg>
    </motion.div>
  );
}

function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Layer 0 — VolatilitySurface ambient layers (particle field +
          ambient glow; wave mesh removed, DotGrid is the interactive field). */}
      <div className="absolute inset-0 z-0" aria-hidden="true">
        <VolatilitySurface />
      </div>

      {/* Layer 1 — DotGrid Canvas 2D interactive field (decorative).
          Above the WebGL canvas (which paints opaque #0a0e14) so the dots
          stay visible, below the readability overlay + content.
          Base dots: soft lavender #A78BFA (visible on near-black);
          interaction: vivid violet #7C3AED.
          pointer-events-none: never blocks hero buttons/links. */}
      <div className="absolute inset-0 z-[1] pointer-events-none" aria-hidden="true">
        <DotGrid
          dotSize={6}
          gap={18}
          baseColor="#A78BFA"
          activeColor="#7C3AED"
          proximity={120}
          speedTrigger={100}
          shockRadius={250}
          shockStrength={4}
          maxSpeed={5000}
          resistance={750}
          returnDuration={1.5}
        />
      </div>

      {/* Layer 2 — readability veil so hero type stays dominant over two
          animated backgrounds. Static gradient only, no motion. */}
      <div
        className="absolute inset-0 z-[2] pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(720px 420px at 50% 38%, rgba(7,10,18,0.55), rgba(7,10,18,0.15) 60%, transparent 78%)',
        }}
      />

      {/* Layer 2b — viewport finish: soft atmospheric fade so the hero
          settles into the feature section instead of ending abruptly.
          Static gradient only, no motion. */}
      <div
        className="absolute inset-x-0 bottom-0 z-[2] h-44 pointer-events-none bg-gradient-to-b from-transparent via-[#070A12]/60 to-[#070A12]"
        aria-hidden="true"
      />
      
      <div className="relative z-10 w-full px-5 pt-24 pb-32 sm:px-6 md:py-28 md:pb-36 text-center">
        {/* Localized readability quiet-zone: soft navy calm directly behind
            the central type; radial fade (no card edges, no blur filter,
            static only) keeps the surrounding DotGrid visible. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_62%_52%_at_50%_40%,rgba(7,10,18,0.72),rgba(7,10,18,0.25)_55%,transparent_72%)]"
        />
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="max-w-4xl mx-auto"
        >
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="inline-flex items-center gap-2.5 rounded-full border border-[rgba(167,139,250,0.22)] bg-[#0F172A]/70 px-3.5 py-1.5 text-xs font-medium tracking-wide text-[#C4B5FD] mb-7"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#A78BFA] opacity-60"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#A78BFA]"></span>
            </span>
            Now in Beta — Institutional Grade
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-tight bg-gradient-to-r from-[#F8FAFC] via-[#A78BFA] to-[#22D3EE] bg-clip-text text-transparent leading-[1.05]"
          >
            Sentinel
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="mt-7 text-lg md:text-xl text-slate-300/90 max-w-xl mx-auto leading-relaxed text-balance"
          >
            Institutional-grade portfolio risk analytics. Real-time VaR, Monte Carlo simulations, 
            correlation analysis, and scenario stress testing — built for precision.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4"
          >
<Button 
               size="lg" 
               className="w-full sm:w-auto px-7 sm:px-8 py-3 sm:py-3.5 text-base sm:text-lg font-semibold rounded-xl bg-primary hover:bg-[#6D28D9] shadow-[0_16px_40px_-16px_rgba(124,58,237,0.65)] transition-colors duration-200"
               href="/sign-up"
             >
               Get Started Free
             </Button>
             <Button 
               size="lg" 
               variant="outline" 
               className="w-full sm:w-auto px-7 sm:px-8 py-3 sm:py-3.5 text-base sm:text-lg font-medium rounded-xl border-white/10 bg-transparent text-muted-foreground hover:text-foreground hover:border-[rgba(167,139,250,0.35)] hover:bg-white/[0.03] transition-colors duration-200"
               href="/sign-in"
             >
               Sign In
             </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
            className="mt-12 flex justify-center px-2"
          >
            <GlassSurface
              width="auto"
              height="auto"
              borderRadius={18}
              brightness={14}
              opacity={0.6}
              blur={8}
              displace={0.4}
              backgroundOpacity={0.35}
              saturation={1.15}
              distortionScale={-80}
              className="sentinel-glass-strip max-w-full"
            >
              <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2.5 px-4 py-2 text-xs text-muted-foreground sm:text-[13px]">
                <div className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 text-[#A78BFA]/70" strokeWidth={1.75} />
                  <span>SOC 2 Type II Certified</span>
                </div>
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-[#A78BFA]/70" strokeWidth={1.75} />
                  <span>Global Market Data</span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-[#A78BFA]/70" strokeWidth={1.75} />
                  <span>Sub-second Analytics</span>
                </div>
              </div>
            </GlassSurface>
          </motion.div>
        </motion.div>

        <ScrollIndicator />
      </div>
    </section>
  );
}

function FeatureCard({ feature, index }: { feature: typeof features[0]; index: number }) {
  const Icon = feature.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-100px' }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
      className="group"
    >
      <LiquidGlassCard intensity="subtle" className="h-full" p={6}>
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
          <Icon className="w-6 h-6 text-primary" strokeWidth={1.5} />
        </div>
        <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
        <p className="text-muted-foreground text-base leading-relaxed mb-4">{feature.description}</p>
        <div className="pt-4 border-t border-border/30">
          <span className="text-xs font-medium text-primary/80 uppercase tracking-wider">{feature.metric}</span>
        </div>
      </LiquidGlassCard>
    </motion.div>
  );
}

function Features() {
  return (
    <section className="py-24 md:py-32 px-6 bg-background/50 border-y border-border/30">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Risk Analytics Engine
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Four pillars of institutional risk management, unified in a single terminal.
          </p>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <FeatureCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className="py-20 px-6 bg-background">
      <div className="max-w-7xl mx-auto">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.08, duration: 0.5 }}
              className="text-center"
            >
              <div className="text-4xl md:text-5xl lg:text-6xl font-bold tabular-nums bg-gradient-to-r from-[#A78BFA] via-[#7C3AED] to-[#22D3EE] bg-clip-text text-transparent mb-2">
                {stat.value}
              </div>
              <div className="text-muted-foreground text-sm uppercase tracking-wider">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="py-24 px-6 bg-gradient-to-b from-background via-[#7C3AED]/[0.07] to-background">
      <div className="max-w-3xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Ready to see your portfolio's true risk?
          </h2>
          <p className="text-muted-foreground text-lg mb-8">
            Connect your holdings, run simulations, and stress test in seconds. 
            No implementation required — just sign up and start analyzing.
          </p>
<Button size="lg" className="px-10 py-4 text-lg" href="/sign-up">
             Start Free Trial
           </Button>
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-12 px-6 border-t border-border/30 bg-background/50">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight">Sentinel</span>
            <span className="text-xs uppercase tracking-wider text-primary/70 bg-primary/10 px-2 py-0.5 rounded">Beta</span>
          </div>
          <p className="text-sm text-muted-foreground text-center md:text-right">
            Institutional-grade portfolio risk analytics. Built for precision.
          </p>
        </div>
        {/* Product imprint — subtle founder signature, part of the single
            footer area (no second footer block). */}
        <div className="mt-10 flex flex-col items-center text-center">
          <div
            aria-hidden="true"
            className="h-px w-24 bg-gradient-to-r from-transparent via-[rgba(167,139,250,0.35)] to-transparent"
          />
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground/70">
            Sentinel
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground/60">
            Risk Intelligence Platform
          </p>
          <p className="mt-4 text-[11px] text-muted-foreground/50">
            Created by
          </p>
          <p className="mt-1 text-sm font-medium tracking-wide text-foreground/80">
            Brahamakshatriya
          </p>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Hero />
      <Features />
      <Stats />
      <FinalCTA />
      <Footer />
    </div>
  );
}

export default LandingPage;