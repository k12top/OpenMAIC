/**
 * Public-ish dump of the menu registry.
 *
 * Returns the full {@link MENUS} list (id, label key, route, parent,
 * ownerBypass) so a Casdoor admin building a permission policy can browse
 * the catalog without having to grep the source. Also useful for any
 * future in-app admin UI that wants to render a tree of toggles.
 *
 * Auth: requires a logged-in user (any role) to avoid leaking the catalog
 * to unauthenticated visitors. The list itself contains no sensitive
 * data — labels and i18n keys only — so we don't gate by role.
 */

import { NextResponse } from 'next/server';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { MENUS, MENU_OPS } from '@/lib/auth/menu-registry';

export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json({
      ops: MENU_OPS,
      menus: MENUS.map((m) => ({
        id: m.id,
        labelKey: m.labelKey,
        route: m.route,
        parent: m.parent,
        ownerBypass: m.ownerBypass !== false,
      })),
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
