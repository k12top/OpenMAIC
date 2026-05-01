'use client';

import { useMemo, type ReactNode } from 'react';
import { useAuth } from '@/lib/hooks/use-auth';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store/stage';
import { MENUS_BY_ID, type MenuOp } from '@/lib/auth/menu-registry';

/**
 * Resolve whether the current viewer may perform `op` on a given menu_id.
 *
 * Resolution order:
 *  1. While auth is still loading → `false` (UI hides until we know).
 *  2. If the menu's `ownerBypass` is not explicitly disabled AND the
 *     viewer is the classroom owner AND the requested op is `operable`,
 *     allow. (Owners always operate their own classroom — they don't
 *     need a Casdoor policy for stage-edit actions.)
 *  3. Look up `menus[menuId][op]` from the snapshot returned by
 *     `/api/auth/me` (Casdoor or env-fallback source).
 */
export function useMenuPerm(menuId: string, op: MenuOp = 'visible'): boolean {
  const isOwner = useStageStore((s) => s.isOwner);
  const { menus, loading, menuSource } = useAuth();

  return useMemo(() => {
    if (loading) return false;

    const meta = MENUS_BY_ID.get(menuId);
    const bypassAllowed = meta?.ownerBypass !== false;
    if (bypassAllowed && isOwner && op === 'operable') {
      return true;
    }

    const bits = menus[menuId];
    if (bits) return !!bits[op];

    // Unknown menu — be permissive only when RBAC isn't configured at all
    // (matches server-side `isMenuAllowed` semantics; deploy can opt in
    // by setting `CASDOOR_RBAC_ENABLED=true` or `OPENMAIC_ROLE_PERMISSIONS`).
    return menuSource === 'permissive';
  }, [loading, isOwner, menus, menuSource, menuId, op]);
}

interface MenuGateProps {
  /** Stable menu_id from `lib/auth/menu-registry.ts`. */
  menu: string;
  /** Which permission to check. Defaults to `visible`. */
  op?: MenuOp;
  /**
   * Behavior when the viewer is denied:
   *  - `hide` (default): render `fallback` (or nothing).
   *  - `disable`: render children but visually muted and non-interactive,
   *    with a tooltip explaining why. Useful when the operator wants to
   *    advertise a feature that requires upgrade or admin grant.
   */
  mode?: 'hide' | 'disable';
  /** Rendered when not allowed and `mode='hide'`. */
  fallback?: ReactNode;
  children: ReactNode;
}

export function MenuGate({
  menu,
  op = 'visible',
  mode = 'hide',
  fallback = null,
  children,
}: MenuGateProps) {
  const allowed = useMenuPerm(menu, op);
  const { t } = useI18n();

  if (allowed) return <>{children}</>;

  if (mode === 'disable') {
    return (
      <span
        title={t('menu.noPermission')}
        className="opacity-40 cursor-not-allowed pointer-events-none inline-flex"
        aria-disabled="true"
      >
        {children}
      </span>
    );
  }

  return <>{fallback}</>;
}
