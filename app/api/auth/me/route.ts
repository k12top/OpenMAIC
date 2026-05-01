import { NextResponse } from 'next/server';
import { optionalAuth } from '@/lib/server/auth-guard';
import { getMenuSnapshot } from '@/lib/auth/menu-enforcer';

export async function GET() {
  const user = await optionalAuth();

  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // Build (or read from cache) the menu permission snapshot for this user.
  // Errors here should never block /me — fall back to an empty map and let
  // the client resolve UI gates conservatively (everything hidden until
  // the user retries).
  let menus: Record<string, { visible: boolean; operable: boolean }> = {};
  let menuSource: 'casdoor' | 'env-fallback' | 'permissive' | 'unavailable' = 'unavailable';
  try {
    const snap = await getMenuSnapshot(user);
    menus = snap.byMenu;
    menuSource = snap.source;
  } catch {
    /* keep empty map */
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      nickname: user.nickname,
      avatar: user.avatar,
      email: user.email,
      roles: user.roles,
      // Legacy action-list — kept for backwards compatibility. Will be
      // removed in a future major release once all UI gates have moved
      // to the menus map below.
      permissions: user.permissions,
      // New menu permission map: { menuId: { visible, operable } }.
      menus,
      menuSource,
    },
  });
}
