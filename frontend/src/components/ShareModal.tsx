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
import { LiquidGlassModal } from '@/components/ui/LiquidGlass';

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
  // Permission is held in explicit component state (controlled RadioGroup).
  // A previous implementation piped the selection through
  // register('permission').onChange({ target: { value } }), but RHF resolves
  // the field from event.target.name — absent on that synthetic event — so
  // the value silently never updated and every share was stored as 'view'.
  const [permission, setPermission] = useState<PermissionLevel>('view');
  // Pending EDIT grant awaiting explicit agreement confirmation.
  const [pendingEditEmail, setPendingEditEmail] = useState<string | null>(null);
  const [agreementChecked, setAgreementChecked] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<{ email: string }>({
    defaultValues: {
      email: '',
    },
  });

  const resetAddShareForm = () => {
    reset();
    setPermission('view');
    setPendingEditEmail(null);
    setAgreementChecked(false);
    setShowAddShare(false);
  };

  const doShare = async (email: string, level: PermissionLevel) => {
    try {
      await shareMutation.mutateAsync({ portfolioId, data: { email, permission: level } });
      toast({
        title: 'Portfolio shared',
        description: `Shared with ${email} (${level} access)`,
      });
      resetAddShareForm();
      refetch();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to share portfolio',
        variant: 'destructive',
      });
    }
  };

  const onSubmit = async (data: { email: string }) => {
    // EDIT grants require explicit agreement first; VIEW proceeds directly.
    if (permission === 'edit') {
      setAgreementChecked(false);
      setPendingEditEmail(data.email);
      return;
    }
    await doShare(data.email, 'view');
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

  return (
    <LiquidGlassModal 
      isOpen={isOpen} 
      onClose={onClose} 
      intensity="medium"
      className="max-w-lg max-h-[85vh] overflow-y-auto"
    >
      <div className="p-6">
        <div className="flex items-center justify-between mb-1">
          <p className="eyebrow">Portfolio sharing</p>
          <button onClick={() => { resetAddShareForm(); onClose(); }} className="rounded-md p-1 text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={shareMutation.isPending || revokingId !== null} aria-label="Close share dialog">
            ✕
          </button>
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Share &ldquo;{portfolioName}&rdquo;</h2>
        <p className="mt-1 text-sm text-muted-foreground">Viewers analyze · Editors manage holdings · Only owners delete or share.</p>

        {/* Add Share Form */}
        {showAddShare && pendingEditEmail === null && (
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
              <RadioGroup value={permission} onValueChange={(value) => setPermission(value as PermissionLevel)} className="gap-2">
                {/* P1: permission options use the R-micro inner-row treatment.
                    Selectability, copy, and agreement flow preserved. */}
                <div
                  className="flex cursor-pointer items-center space-x-4 rounded-lg border p-3 transition-colors duration-200 focus-within:ring-2 focus-within:ring-ring border-[rgba(167,139,250,0.16)] hover:border-[rgba(34,211,238,0.35)]"
                  onClick={() => setPermission('view')}
                >
                  <RadioGroupItem value="view" id="view" disabled={shareMutation.isPending} />
                  <Label htmlFor="view" className="cursor-pointer">
                    <div className="text-sm font-medium">View only</div>
                    <div className="text-xs text-muted-foreground">Can view portfolio and run analyses</div>
                  </Label>
                </div>
                <div
                  className="flex cursor-pointer items-center space-x-4 rounded-lg border p-3 transition-colors duration-200 focus-within:ring-2 focus-within:ring-ring border-[rgba(167,139,250,0.16)] hover:border-[rgba(124,58,237,0.5)]"
                  onClick={() => setPermission('edit')}
                >
                  <RadioGroupItem value="edit" id="edit" disabled={shareMutation.isPending} />
                  <Label htmlFor="edit" className="cursor-pointer">
                    <div className="text-sm font-medium">Can edit</div>
                    <div className="text-xs text-muted-foreground">Can add/remove holdings, run analyses (cannot delete portfolio or manage shares)</div>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={resetAddShareForm} disabled={shareMutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={shareMutation.isPending}>
                {shareMutation.isPending ? 'Sharing...' : permission === 'edit' ? 'Continue' : 'Share Portfolio'}
              </Button>
            </div>
          </form>
        )}

        {/* Edit-access agreement (EDIT grants only) — semantic warning
            treatment preserved; confirmation behavior untouched. */}
        {showAddShare && pendingEditEmail !== null && (
          <div className="mb-6 space-y-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-4">
            <div>
              <h3 className="text-sm font-semibold">Grant Edit access to {pendingEditEmail}?</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Please review what this permission allows before continuing.
              </p>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>They will be able to add, edit, and remove holdings in this portfolio.</li>
              <li>Their changes may affect portfolio analytics and risk metrics.</li>
              <li>They cannot delete the portfolio, manage sharing, or transfer ownership.</li>
              <li>You can revoke this access at any time from the shares list.</li>
            </ul>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={agreementChecked}
                onChange={(e) => setAgreementChecked(e.target.checked)}
                disabled={shareMutation.isPending}
                className="mt-0.5 h-4 w-4 accent-current"
              />
              <span>I understand and want to grant Edit access.</span>
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingEditEmail(null)}
                disabled={shareMutation.isPending}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={() => pendingEditEmail && doShare(pendingEditEmail, 'edit')}
                disabled={!agreementChecked || shareMutation.isPending}
              >
                {shareMutation.isPending ? 'Sharing...' : 'Confirm & Share'}
              </Button>
            </div>
          </div>
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
                // P1: dense inset rows — compact spacing, subtle border.
                <div key={share.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[rgba(167,139,250,0.16)] bg-white/[0.015]">
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
    </LiquidGlassModal>
  );
}