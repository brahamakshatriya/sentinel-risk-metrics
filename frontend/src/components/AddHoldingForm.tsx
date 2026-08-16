'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/utils';

interface HoldingFormData {
  symbol: string;
  quantity: string;
  avg_cost: string;
}

interface AddHoldingFormProps {
  onSubmit: (data: HoldingFormData) => Promise<void>;
  isPending?: boolean;
}

export function AddHoldingForm({ onSubmit, isPending }: AddHoldingFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<HoldingFormData>({
    defaultValues: {
      symbol: '',
      quantity: '',
      avg_cost: '',
    },
  });

  const handleClose = () => {
    setIsOpen(false);
    reset();
  };

  const handleOpen = () => setIsOpen(true);

  return (
    <>
      <Button variant="outline" onClick={handleOpen} disabled={isPending}>
        + Add Holding
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-lg border bg-card p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Add Holding</h2>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit(async (data) => {
              await onSubmit(data);
              handleClose();
            })} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="symbol">Symbol</Label>
                <Input
                  id="symbol"
                  {...register('symbol', {
                    required: 'Symbol is required',
                    pattern: { value: /^[A-Z]{1,5}$/, message: 'Use uppercase letters only (1-5 chars)' },
                  })}
                  placeholder="AAPL"
                  className="text-uppercase"
                  disabled={isPending}
                />
                {errors.symbol && (
                  <p className="text-sm text-red-400">{errors.symbol.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    {...register('quantity', {
                      required: 'Quantity is required',
                      min: { value: 0.0001, message: 'Must be greater than 0' },
                    })}
                    placeholder="10"
                    disabled={isPending}
                  />
                  {errors.quantity && (
                    <p className="text-sm text-red-400">{errors.quantity.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="avg_cost">Avg Cost ($)</Label>
                  <Input
                    id="avg_cost"
                    type="number"
                    step="0.01"
                    min="0"
                    {...register('avg_cost', {
                      required: 'Average cost is required',
                      min: { value: 0, message: 'Must be positive' },
                    })}
                    placeholder="150.00"
                    disabled={isPending}
                  />
                  {errors.avg_cost && (
                    <p className="text-sm text-red-400">{errors.avg_cost.message}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={handleClose} disabled={isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? 'Adding...' : 'Add Holding'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}