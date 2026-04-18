import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { getTransactions } from '@/lib/server/credits';
import { isDbConfigured } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();

    if (!isDbConfigured()) {
      return NextResponse.json({ transactions: [] });
    }

    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const transactions = await getTransactions(user.id, limit, offset);
    return NextResponse.json({ transactions });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
