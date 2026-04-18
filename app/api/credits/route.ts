import { NextResponse } from 'next/server';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { getBalance, CREDIT_RATES, UNLIMITED_CREDITS } from '@/lib/server/credits';

export async function GET() {
  try {
    const user = await requireAuth();
    const balance = await getBalance(user.id);
    const unlimited = balance === UNLIMITED_CREDITS;

    return NextResponse.json({
      balance: unlimited ? -1 : balance,
      unlimited,
      rates: CREDIT_RATES,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
