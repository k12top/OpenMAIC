'use client';

import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { ArrowLeft, CreditCard, Sparkles } from 'lucide-react';
import { BRAND_NAME } from '@/lib/constants/brand';

export default function RechargePage() {
  const router = useRouter();

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center p-4 md:p-8">
      <div className="w-full max-w-2xl">
        <button
          onClick={() => router.push('/credits')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="size-4" />
          Back to Credits
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl"
      >
        <div className="rounded-2xl border border-border/40 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm p-8 md:p-12 text-center">
          <div className="mx-auto mb-6 size-16 rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/30 dark:to-blue-900/30 flex items-center justify-center">
            <CreditCard className="size-8 text-violet-600 dark:text-violet-400" />
          </div>

          <h1 className="text-2xl font-semibold text-foreground mb-3">
            Credits Recharge
          </h1>

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-800/40 mb-6">
            <Sparkles className="size-3.5 text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
              Coming Soon
            </span>
          </div>

          <p className="text-sm text-muted-foreground/70 max-w-md mx-auto leading-relaxed mb-8">
            The recharge feature is under development. You will be able to purchase
            credits to continue using AI-powered courseware generation, TTS, image
            generation, and more.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {[
              { credits: 100, price: '$9.99', popular: false },
              { credits: 500, price: '$39.99', popular: true },
              { credits: 2000, price: '$129.99', popular: false },
            ].map((plan) => (
              <div
                key={plan.credits}
                className={`relative rounded-xl border p-4 ${
                  plan.popular
                    ? 'border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/20'
                    : 'border-border/40'
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-violet-500 text-white text-[10px] font-medium">
                    Popular
                  </span>
                )}
                <p className="text-2xl font-bold text-foreground">{plan.credits}</p>
                <p className="text-xs text-muted-foreground mb-3">credits</p>
                <p className="text-sm font-semibold text-foreground">{plan.price}</p>
              </div>
            ))}
          </div>

          <button
            disabled
            className="px-6 py-2.5 rounded-xl bg-muted text-muted-foreground/50 font-medium cursor-not-allowed"
          >
            Payment Coming Soon
          </button>
        </div>
      </motion.div>

      <div className="mt-auto pt-12 pb-4 text-center text-xs text-muted-foreground/40">
        {BRAND_NAME}
      </div>
    </div>
  );
}
