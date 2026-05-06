'use client';

import { useMenuPerm } from '@/components/auth/menu-gate';
import { type MenuOp } from '@/lib/auth/menu-registry';
import { type Action } from '@/lib/auth/permissions';

/**
 * Backwards-compatible mapping from the legacy `Action` vocabulary to the
 * new menu permission system. Every existing `<Can action="...">` /
 * `useCan('...')` call site is preserved; the resolution path goes
 * Action → menu_id → snapshot lookup → owner-bypass.
 *
 * NOTE: When adding a new action here, also add the corresponding row in
 * `lib/auth/menu-enforcer.ts > ACTION_TO_MENU_OPS` so the env-fallback
 * mode (legacy `OPENMAIC_ROLE_PERMISSIONS`) continues to grant it.
 */
const ACTION_TO_MENU: Record<Action, { menu: string; op: MenuOp }> = {
  regenerate: { menu: 'toolbar.regenerate', op: 'operable' },
  'edit-source': { menu: 'toolbar.editSource', op: 'operable' },
  reorder: { menu: 'sidebar.reorderScenes', op: 'operable' },
  'delete-scene': { menu: 'sidebar.deleteScene', op: 'operable' },
  'add-scene': { menu: 'sidebar.addScene', op: 'operable' },
  share: { menu: 'header.share', op: 'operable' },
  'delete-classroom': { menu: 'home.deleteClassroom', op: 'operable' },
};

/**
 * Resolve whether the current viewer is allowed to perform `action`.
 *
 * This is now a thin alias over {@link useMenuPerm} — every action is
 * routed through a fixed menu_id so policy lives in one place. The
 * classroom owner-bypass behavior is unchanged: see
 * `lib/auth/menu-registry.ts > ownerBypass` for the per-menu opt-out.
 *
 * Existing call sites:
 *  - `components/header.tsx` — `share`
 *  - `components/canvas/canvas-toolbar.tsx` — `regenerate`, `edit-source`
 *  - `components/stage/scene-sidebar.tsx` — `reorder`, `delete-scene`, `add-scene`
 *  - `app/page.tsx` — `delete-classroom`
 */
export function useCan(action: Action): boolean {
  const mapping = ACTION_TO_MENU[action];
  // Fallback to a deny if a future caller passes an unmapped action —
  // this should never happen at runtime since `Action` is a closed union.
  return useMenuPerm(mapping?.menu ?? '__unknown__', mapping?.op ?? 'operable');
}

interface CanProps {
  action: Action;
  /** Rendered when the viewer is NOT allowed. Defaults to nothing. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Conditionally render children based on whether the current viewer may
 * perform `action`. See {@link useCan}.
 */
export function Can({ action, fallback = null, children }: CanProps) {
  const allowed = useCan(action);
  return <>{allowed ? children : fallback}</>;
}
