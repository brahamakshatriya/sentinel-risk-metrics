'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import dynamic from 'next/dynamic';
import { BarChart2, Activity, Zap, Shield, TrendingUp, Globe, Cpu, Lock } from 'lucide-react';
import { LiquidGlassCard } from '@/components/ui/LiquidGlass';

const VolatilitySurface = dynamic(
  () => import('@/components/VolatilitySurface').then((mod) => mod.default),
  { ssr: false, loading: () => <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" /> }
);

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
      className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-muted-foreground/60"
      style={{ opacity, y }}
      animate={{ y: [0, 8, 0] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
    >
      <span className="text-xs uppercase tracking-widest">Scroll</span>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 5v14M19 12l-7 7-7-7" />
      </svg>
    </motion.div>
  );
}

function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 z-0">
        <VolatilitySurface />
      </div>
      
      <div className="relative z-10 px-6 py-20 text-center">
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
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-medium mb-6"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            Now in Beta — Institutional Grade
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight bg-gradient-to-r from-foreground via-primary to-primary/70 bg-clip-text text-transparent leading-[1.05]"
          >
            Sentinel
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
          >
            Institutional-grade portfolio risk analytics. Real-time VaR, Monte Carlo simulations, 
            correlation analysis, and scenario stress testing — built for precision.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Button 
              size="lg" 
              className="w-full sm:w-auto px-8 py-3.5 text-lg bg-primary hover:bg-primary/90"
              asChild
            >
              <Link href="/sign-up">Get Started Free</Link>
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="w-full sm:w-auto px-8 py-3.5 text-lg border-primary/30 hover:bg-primary/5"
              asChild
            >
              <Link href="/sign-in">Sign In</Link>
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
            className="mt-12 flex items-center justify-center gap-8 text-sm text-muted-foreground/60"
          >
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4" />
              <span>SOC 2 Type II Certified</span>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4" />
              <span>Global Market Data</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              <span>Sub-second Analytics</span>
            </div>
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
              <div className="text-4xl md:text-5xl lg:text-6xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent mb-2">
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
    <section className="py-24 px-6 bg-gradient-to-b from-background via-primary/5 to-background">
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
          <Button size="lg" className="px-10 py-4 text-lg" asChild>
            <Link href="/sign-up">Start Free Trial</Link>
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