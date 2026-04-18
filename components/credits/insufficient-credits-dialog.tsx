'use client';

import { useRouter } from 'next/navigation';
import { Coins, AlertTriangle, ArrowRight } from 'lucide-react';

interface InsufficientCreditsDialogProps {
  open: boolean;
  onClose: () => void;
  balance?: number;
}

export function InsufficientCreditsDialog({
  open,
  onClose,
  balance = 0,
}: InsufficientCreditsDialogProps) {
  const router = useRouter();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-border/40 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Insufficient Credits</h2>
            <p className="text-xs text-muted-foreground">
              Your current balance is not enough to continue
            </p>
          </div>
        </div>

        <div className="mb-6 p-4 rounded-xl bg-muted/30 border border-border/30">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Current Balance</span>
            <div className="flex items-center gap-1.5">
              <Coins className="size-4 text-amber-500" />
              <span className="text-lg font-bold text-foreground">{balance}</span>
            </div>
          </div>
        </div>

        <p className="text-sm text-muted-foreground/70 mb-6 leading-relaxed">
          Your generation progress has been saved. After recharging, you can resume
          from where you left off.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-medium text-foreground/80 hover:bg-muted/50 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => {
              onClose();
              router.push('/credits/recharge');
            }}
            className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-all flex items-center justify-center gap-2"
          >
            Recharge
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
