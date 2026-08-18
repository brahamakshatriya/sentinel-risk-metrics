'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Separator } from '@/components/ui/Separator';
import { useSharePortfolio, useRevokeShare, useShares } from '@/hooks/useApi';
import { useToast } from '@/hooks/use-toast';
import type { PortfolioShare, PermissionLevel } from '@/types/api';

interface ShareModalProps {
  portfolioId: number;
  portfolioName: string;
  isOpen: boolean;
  onClose: () => void;
  isOwner: boolean;
}

export function ShareModal({ portfolioId, portfolioName, isOpen, onClose, isOwner }: ShareModalProps) {
  const { toast } = useToast();
  const shareMutation = useSharePortfolio();
  const revokeMutation = useRevokeShare();
  const { data: shares, isLoading, refetch } = useShares(portfolioId);
  
  const [showAddShare, setShowAddShare] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<{ email: string; permission: PermissionLevel }>({
    defaultValues: {
      email: '',
      permission: 'view',
    },
  });

  const onSubmit = async (data: { email: string; permission: PermissionLevel }) => {
    try {
      await shareMutation.mutateAsync({ portfolioId, data });
      toast({
        title: 'Portfolio shared',
        description: `Shared with ${data.email} (${data.permission} access)`,
      });
      reset();
      setShowAddShare(false);
      refetch();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to share portfolio',
        variant: 'destructive',
      });
    }
  };

  const handleRevoke = async (shareId: number, email: string) => {
    if (!confirm(`Revoke access for ${email}?`)) return;
    
    setRevokingId(shareId);
    try {
      await revokeMutation.mutateAsync({ portfolioId, shareId });
      toast({
        title: 'Access revoked',
        description: `Removed ${email}'s access to this portfolio`,
      });
      refetch();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to revoke access',
        variant: 'destructive',
      });
    } finally {
      setRevokingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 rounded-lg border bg-card p-6 shadow-lg max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Share "{portfolioName}"</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" disabled={shareMutation.isPending || revokingId !== null}>
            ✕
          </button>
        </div>

        {/* Add Share Form */}
        {showAddShare && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mb-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                {...register('email', {
                  required: 'Email is required',
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Invalid email format' },
                })}
                placeholder="user@example.com"
                disabled={shareMutation.isPending}
              />
              {errors.email && (
                <p className="text-sm text-red-400">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Permission Level</Label>
              <RadioGroup defaultValue="view" onValueChange={(value) => register('permission').onChange({ target: { value } } as any)}>
                <div className="flex items-center space-x-4">
                  <RadioGroupItem value="view" id="view" disabled={shareMutation.isPending} />
                  <Label htmlFor="view" className="cursor-pointer">
                    <div className="text-sm font-medium">View only</div>
                    <div className="text-xs text-muted-foreground">Can view portfolio and run analyses</div>
                  </Label>
                </div>
                <div className="flex items-center space-x-4">
                  <RadioGroupItem value="edit" id="edit" disabled={shareMutation.isPending} />
                  <Label htmlFor="edit" className="cursor-pointer">
                    <div className="text-sm font-medium">Can edit</div>
                    <div className="text-xs text-muted-foreground">Can add/remove holdings, run analyses (cannot delete portfolio or manage shares)</div>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => { reset(); setShowAddShare(false); }} disabled={shareMutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={shareMutation.isPending}>
                {shareMutation.isPending ? 'Sharing...' : 'Share Portfolio'}
              </Button>
            </div>
          </form>
        )}

        {!showAddShare && (
          <div className="mb-6">
            <Button onClick={() => setShowAddShare(true)} disabled={shareMutation.isPending}>
              + Share with Someone
            </Button>
          </div>
        )}

        <Separator />

        {/* Current Shares List */}
        <div className="mt-4">
          <h3 className="text-sm font-medium mb-3">Current Shares ({shares?.length || 0})</h3>
          
          {isLoading ? (
            <div className="text-center py-4 text-muted-foreground">Loading shares...</div>
          ) : shares && shares.length > 0 ? (
            <div className="space-y-3">
              {shares.map((share: PortfolioShare) => (
                <div key={share.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium">{share.shared_with_email}</p>
                      <p className="text-xs text-muted-foreground">Shared {new Date(share.created_at).toLocaleDateString()}</p>
                    </div>
                    <Badge variant={share.permission === 'edit' ? 'default' : 'outline'}>
                      {share.permission === 'edit' ? 'Can edit' : 'View only'}
                    </Badge>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRevoke(share.id, share.shared_with_email)}
                    disabled={revokingId === share.id || revokeMutation.isPending}
                  >
                    {revokingId === share.id ? 'Revoking...' : 'Revoke'}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              No shares yet. Click "Share with Someone" to grant access.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}