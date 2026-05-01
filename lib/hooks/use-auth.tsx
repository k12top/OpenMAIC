'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { Action } from '@/lib/auth/permissions';

/** Per-menu permission bits returned by `/api/auth/me`. */
export interface MenuPermBits {
  visible: boolean;
  operable: boolean;
}

export type MenuPermMap = Record<string, MenuPermBits>;

export interface AuthMeResponse {
  authenticated: boolean;
  user?: {
    id: string;
    nickname?: string;
    avatar?: string;
    email?: string;
    roles?: string[];
    /** Legacy action grants — preserved for backwards compatibility. */
    permissions?: Action[];
    /** New: per-menu permission map keyed by menu_id. */
    menus?: MenuPermMap;
    menuSource?: 'casdoor' | 'env-fallback' | 'permissive' | 'unavailable';
  };
}

export interface AuthState {
  loading: boolean;
  authenticated: boolean;
  userId: string | null;
  roles: string[];
  permissions: Action[];
  menus: MenuPermMap;
  /**
   * Where the menu map came from. Useful for the admin UI / debug overlay
   * — `permissive` means RBAC is not configured at all and every menu is
   * allowed; `unavailable` means we couldn't reach Casdoor and the snapshot
   * is empty (UI should treat as deny-by-default until refresh succeeds).
   */
  menuSource: 'casdoor' | 'env-fallback' | 'permissive' | 'unavailable';
}

const INITIAL_STATE: AuthState = {
  loading: true,
  authenticated: false,
  userId: null,
  roles: [],
  permissions: [],
  menus: {},
  menuSource: 'unavailable',
};

// Module-level cache + simple subscription so multiple hook instances share
// one in-flight fetch and one source of truth. Avoids the need for an
// additional <AuthProvider> wrapper at the root layout level.
let _state: AuthState = INITIAL_STATE;
let _fetched = false;
let _inflight: Promise<void> | null = null;
const _subs = new Set<() => void>();

function notify() {
  for (const fn of _subs) fn();
}

function subscribe(cb: () => void) {
  _subs.add(cb);
  return () => {
    _subs.delete(cb);
  };
}

function getSnapshot() {
  return _state;
}

function getServerSnapshot() {
  return INITIAL_STATE;
}

function applyMeResponse(data: AuthMeResponse): void {
  if (data.authenticated && data.user) {
    _state = {
      loading: false,
      authenticated: true,
      userId: data.user.id,
      roles: data.user.roles ?? [],
      permissions: data.user.permissions ?? [],
      menus: data.user.menus ?? {},
      menuSource: data.user.menuSource ?? 'unavailable',
    };
  } else {
    _state = { ...INITIAL_STATE, loading: false };
  }
}

async function fetchAuthState(force = false): Promise<void> {
  if (_inflight) return _inflight;
  if (_fetched && !force) return;
  _inflight = (async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data: AuthMeResponse = res.ok
        ? await res.json().catch(() => ({ authenticated: false }))
        : { authenticated: false };
      applyMeResponse(data);
    } catch {
      _state = { ...INITIAL_STATE, loading: false };
    } finally {
      _fetched = true;
      _inflight = null;
      notify();
    }
  })();
  return _inflight;
}

/**
 * Client hook returning the current auth state (identity + roles +
 * permissions + menus). Triggers a single `/api/auth/me` fetch on first
 * mount and shares the result across components via a module-level store.
 *
 * Use {@link refreshAuth} to re-sync (after sign-in/sign-out flows) or
 * {@link refreshMenuPermissions} after an admin-side policy change.
 */
export function useAuth(): AuthState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Kick off the fetch once on first consumer mount.
  useEffect(() => {
    if (!_fetched && !_inflight) {
      void fetchAuthState();
    }
  }, []);

  return state;
}

/** Re-fetch `/api/auth/me` and update every consumer. */
export function refreshAuth(): Promise<void> {
  return fetchAuthState(true);
}

/**
 * Force the **server** to rebuild the menu permission snapshot (bypasses
 * the in-process TTL cache), then update local state with the fresh map.
 * Used when the user just changed roles in Casdoor and expects the new
 * grants to be immediately visible without logging out.
 */
export async function refreshMenuPermissions(): Promise<void> {
  try {
    const res = await fetch('/api/auth/refresh-permissions', { method: 'POST' });
    if (!res.ok) {
      // Even if the refresh failed, re-fetch /me so the UI reflects the
      // current cached snapshot (might be stale but still correct).
      await fetchAuthState(true);
      return;
    }
    const data = (await res.json().catch(() => null)) as
      | { ok: boolean; menus?: MenuPermMap; menuSource?: AuthState['menuSource'] }
      | null;
    if (!data?.ok) {
      await fetchAuthState(true);
      return;
    }
    if (_state.authenticated) {
      _state = {
        ..._state,
        menus: data.menus ?? {},
        menuSource: data.menuSource ?? 'unavailable',
      };
      notify();
    } else {
      // Not authenticated according to local state — go through the
      // canonical /me path so we pick up identity if the cookie is now
      // present.
      await fetchAuthState(true);
    }
  } catch {
    await fetchAuthState(true);
  }
}

/** Convenience wrapper — returns `false` until auth has loaded. */
export function useIsAuthenticated(): boolean {
  const { authenticated, loading } = useAuth();
  return !loading && authenticated;
}
