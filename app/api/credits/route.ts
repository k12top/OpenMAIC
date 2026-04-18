import { NextResponse } from 'next/server';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { getBalance, CREDIT_RATES } from '@/lib/server/credits';
import { isDbConfigured } from '@/lib/db';

export async function GET() {
  try {
    const user = await requireAuth();

    if (!isDbConfigured()) {
      return NextResponse.json({
        balance: Infinity,
        rates: CREDIT_RATES,
        configured: false,
      });
    }

    const balance = await getBalance(user.id);
    return NextResponse.json({
      balance,
      rates: CREDIT_RATES,
      configured: true,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
