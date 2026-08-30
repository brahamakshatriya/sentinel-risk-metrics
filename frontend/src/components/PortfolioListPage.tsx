'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePortfolios, useCreatePortfolio } from '@/hooks/useApi';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';
import { useForm } from 'react-hook-form';
import { useToast } from '@/hooks/use-toast';
import type { Portfolio } from '@/types/api';

export function PortfolioListPage() {
  const { data: portfolios, isLoading, error, refetch } = usePortfolios();
  const createPortfolio = useCreatePortfolio();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<{ name: string }>({
    defaultValues: { name: '' },
  });

  const onSubmit = async (data: { name: string }) => {
    try {
      await createPortfolio.mutateAsync(data);
      toast({
        title: 'Portfolio created',
        description: 'Your portfolio has been created successfully.',
      });
      reset();
      setShowCreate(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create portfolio. Please try again.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading portfolios...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">Failed to load portfolios</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
          <Button onClick={() => refetch()} className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Separate owned and shared portfolios
  const ownedPortfolios = (portfolios || []).filter((p: Portfolio) => p.is_owner);
  const sharedPortfolios = (portfolios || []).filter((p: Portfolio) => !p.is_owner);

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Portfolios</h1>
            <p className="text-muted-foreground mt-1">
              Manage your portfolios and analyze Sentinel
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)}>New Portfolio</Button>
        </div>

        {createPortfolio.isPending && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="bg-card p-6 rounded-lg border shadow-lg animate-pulse">Creating...</div>
          </div>
        )}

        {showCreate && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="w-full max-w-md mx-4 rounded-lg border bg-card p-6 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Create Portfolio</h2>
                <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                  ✕
                </button>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label htmlFor="name" className="text-sm font-medium text-foreground block mb-1">
                    Portfolio Name
                  </label>
                  <Input
                    id="name"
                    {...register('name', {
                      required: 'Name is required',
                      minLength: { value: 2, message: 'Name must be at least 2 characters' },
                    })}
                    placeholder="My Portfolio"
                    disabled={createPortfolio.isPending}
                  />
                  {errors.name && (
                    <p className="text-sm text-red-400">{errors.name.message}</p>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowCreate(false)} disabled={createPortfolio.isPending}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createPortfolio.isPending}>
                    {createPortfolio.isPending ? 'Creating...' : 'Create'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {ownedPortfolios.length === 0 && sharedPortfolios.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">No portfolios yet</p>
            <Button onClick={() => setShowCreate(true)}>Create Your First Portfolio</Button>
          </div>
        )}

        {/* My Portfolios Section */}
        {ownedPortfolios.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              My Portfolios
              <Badge variant="secondary">{ownedPortfolios.length}</Badge>
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {ownedPortfolios.map((portfolio: Portfolio) => (
                <Link key={portfolio.id} href={`/portfolios/${portfolio.id}`} className="group">
                  <Card className="hover:shadow-lg transition-shadow cursor-pointer border-green-500/20">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{portfolio.name}</CardTitle>
                        <Badge variant="default" className="bg-green-500/20 text-green-400">Owner</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Created {formatDate(portfolio.created_at)}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">ID</span>
                          <span className="font-mono">{portfolio.id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Updated</span>
                          <span>{formatDate(portfolio.updated_at)}</span>
                        </div>
                        {portfolio.holdings && portfolio.holdings.length > 0 && (
                          <div className="flex justify-between pt-2 border-t">
                            <span className="text-muted-foreground">Holdings</span>
                            <span className="font-medium">{portfolio.holdings.length}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Shared with Me Section */}
        {sharedPortfolios.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              Shared with Me
              <Badge variant="secondary">{sharedPortfolios.length}</Badge>
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sharedPortfolios.map((portfolio: Portfolio) => (
                <Link key={portfolio.id} href={`/portfolios/${portfolio.id}`} className="group">
                  <Card className="hover:shadow-lg transition-shadow cursor-pointer border-blue-500/20">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{portfolio.name}</CardTitle>
                        <Badge variant={portfolio.permission === 'edit' ? 'default' : 'outline'}>
                          {portfolio.permission === 'edit' ? 'Can edit' : 'View only'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {portfolio.owner_email ? `Shared by ${portfolio.owner_email}` : 'Shared portfolio'}
                        {' • '}
                        Created {formatDate(portfolio.created_at)}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">ID</span>
                          <span className="font-mono">{portfolio.id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Updated</span>
                          <span>{formatDate(portfolio.updated_at)}</span>
                        </div>
                        {portfolio.holdings && portfolio.holdings.length > 0 && (
                          <div className="flex justify-between pt-2 border-t">
                            <span className="text-muted-foreground">Holdings</span>
                            <span className="font-medium">{portfolio.holdings.length}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}