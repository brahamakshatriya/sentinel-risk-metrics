'use client';

import { SignIn } from '@clerk/nextjs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Sign in to Sentinel</CardTitle>
        </CardHeader>
        <CardContent>
          <SignIn
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
            path="/sign-in"
            signUpUrl="/sign-up"
            redirectUrl="/"
          />
        </CardContent>
      </Card>
    </div>
  );
}