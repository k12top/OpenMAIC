'use client';

import { useMemo } from 'react';
import { useAuth } from '@/lib/hooks/use-auth';
import { useStageStore } from '@/lib/store/stage';
import {
  OWNER_IMPLICIT_ACTIONS,
  hasPermission,
  type Action,
} from '@/lib/auth/permissions';

/**
 * Resolve whether the current viewer is allowed to perform `action`.
 *
 * Resolution order:
 * 1. If the viewer is the owner of the current classroom (`stage.isOwner`)
 *    and `action` is in `OWNER_IMPLICIT_ACTIONS`, always allow. This is
 *    the common case — owners don't need RBAC config.
 * 2. Otherwise consult the user's role-derived permissions from
 *    `/api/auth/me` (server computes them from `OPENMAIC_ROLE_PERMISSIONS`).
 *
 * `delete-classroom` is intentionally excluded from the implicit owner
 * grant — even owners may need an admin override if the deploy wants to
 * restrict destructive ops.
 */
export function useCan(action: Action): boolean {
  const isOwner = useStageStore((s) => s.isOwner);
  const { permissions, loading } = useAuth();

  return useMemo(() => {
    if (loading) return false;
    if (isOwner && (OWNER_IMPLICIT_ACTIONS as readonly Action[]).includes(action)) {
      return true;
    }
    return hasPermission(permissions, action);
  }, [loading, isOwner, permissions, action]);
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
