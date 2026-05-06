/**
 * Force-refresh the calling user's menu permission snapshot.
 *
 * The snapshot built by `lib/auth/menu-enforcer.ts` is cached in-process
 * for `MENU_PERMISSIONS_TTL_MS` (default 30 minutes). When an admin tweaks
 * a Casdoor policy and wants the change reflected immediately for a user
 * without forcing them to log out, the user (or a future webhook) hits
 * this endpoint to invalidate + rebuild the entry.
 */

import { NextResponse } from 'next/server';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { getMenuSnapshot, invalidateMenuSnapshot } from '@/lib/auth/menu-enforcer';

export async function POST() {
  try {
    const user = await requireAuth();
    invalidateMenuSnapshot(user.id);
    const snap = await getMenuSnapshot(user);
    return NextResponse.json({
      ok: true,
      menus: snap.byMenu,
      menuSource: snap.source,
      generatedAt: snap.generatedAt,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Internal error', detail }, { status: 500 });
  }
}
