'use client';

import { SignUp } from '@clerk/nextjs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { LiquidGlassCard } from '@/components/ui/LiquidGlass';

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <LiquidGlassCard intensity="medium" className="w-full max-w-md" p={0}>
        <Card className="bg-transparent border-none shadow-none">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Create your Sentinel account</CardTitle>
          </CardHeader>
          <CardContent>
            <SignUp
              appearance={{
                elements: {
                  formButtonPrimary: 'bg-primary text-primary-foreground hover:bg-primary/90',
                  card: 'shadow-none border-none bg-transparent',
                  headerTitle: 'text-2xl font-bold',
                  headerSubtitle: 'text-muted-foreground',
                  socialButtonsBlockButton: 'border border-input bg-transparent hover:bg-accent',
                },
              }}
              routing="path"
              path="/sign-up"
              signInUrl="/sign-in"
              redirectUrl="/"
            />
          </CardContent>
        </Card>
      </LiquidGlassCard>
    </div>
  );
}