'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { ArrowLeft, Coins, ArrowUpRight, ArrowDownLeft, Gift, RefreshCw } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { BRAND_NAME } from '@/lib/constants/brand';
import { cn } from '@/lib/utils';

interface CreditTransaction {
  id: string;
  amount: number;
  type: 'grant' | 'consume' | 'recharge';
  description: string;
  relatedApi: string;
  tokenCount: number;
  createdAt: string;
}

export default function CreditsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [unlimited, setUnlimited] = useState(false);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/credits').then((r) => r.json()),
      fetch('/api/credits/transactions').then((r) => r.json()),
    ])
      .then(([creditsData, txData]) => {
        if (creditsData.unlimited) {
          setUnlimited(true);
          setBalance(-1);
        } else {
          setBalance(creditsData.balance ?? 0);
        }
        setTransactions(txData.transactions ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case 'grant':
        return <Gift className="size-4 text-green-500" />;
      case 'consume':
        return <ArrowUpRight className="size-4 text-red-500" />;
      case 'recharge':
        return <ArrowDownLeft className="size-4 text-blue-500" />;
      default:
        return <Coins className="size-4 text-gray-400" />;
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center p-4 md:p-8">
      {/* Header */}
      <div className="w-full max-w-2xl">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="size-4" />
          {BRAND_NAME}
        </button>
      </div>

      {/* Balance Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl"
      >
        <div className="rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 p-6 text-white shadow-xl shadow-violet-500/20 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Coins className="size-5" />
              <span className="text-sm font-medium opacity-90">{t('credits.balance')}</span>
            </div>
            <button
              onClick={() => router.push('/credits/recharge')}
              className="px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-xs font-medium transition-colors"
            >
              {t('credits.recharge')}
            </button>
          </div>
          <div className="text-4xl font-bold">
            {loading ? (
              <RefreshCw className="size-6 animate-spin" />
            ) : unlimited ? (
              <span className="text-2xl">∞ {t('credits.unlimited')}</span>
            ) : (
              balance?.toLocaleString()
            )}
          </div>
          <p className="text-xs opacity-70 mt-1">
            {unlimited
              ? t('credits.unlimitedDesc')
              : t('credits.balanceDesc')}
          </p>
        </div>

        {/* Transactions */}
        <div className="rounded-2xl border border-border/40 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border/30">
            <h2 className="text-sm font-semibold text-foreground">{t('credits.history')}</h2>
          </div>

          {loading ? (
            <div className="p-8 text-center text-muted-foreground/50">
              <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
              {t('credits.loading')}
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground/50 text-sm">
              {t('credits.noTransactions')}
            </div>
          ) : (
            <div className="divide-y divide-border/20">
              {transactions.map((tx) => (
                <div key={tx.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="shrink-0 size-8 rounded-full bg-muted/50 flex items-center justify-center">
                    {typeIcon(tx.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {tx.description}
                    </p>
                    <p className="text-xs text-muted-foreground/60">
                      {formatDate(tx.createdAt)}
                      {tx.tokenCount > 0 && ` · ${tx.tokenCount.toLocaleString()} ${t('credits.tokens')}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'text-sm font-semibold tabular-nums',
                      tx.amount > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500',
                    )}
                  >
                    {tx.amount > 0 ? '+' : ''}
                    {tx.amount}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
