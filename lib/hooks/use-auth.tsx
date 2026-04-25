'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { Action } from '@/lib/auth/permissions';

export interface AuthMeResponse {
  authenticated: boolean;
  user?: {
    id: string;
    nickname?: string;
    avatar?: string;
    email?: string;
    roles?: string[];
    permissions?: Action[];
  };
}

export interface AuthState {
  loading: boolean;
  authenticated: boolean;
  userId: string | null;
  roles: string[];
  permissions: Action[];
}

const INITIAL_STATE: AuthState = {
  loading: true,
  authenticated: false,
  userId: null,
  roles: [],
  permissions: [],
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

async function fetchAuthState(force = false): Promise<void> {
  if (_inflight) return _inflight;
  if (_fetched && !force) return;
  _inflight = (async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data: AuthMeResponse = res.ok
        ? await res.json().catch(() => ({ authenticated: false }))
        : { authenticated: false };
      if (data.authenticated && data.user) {
        _state = {
          loading: false,
          authenticated: true,
          userId: data.user.id,
          roles: data.user.roles ?? [],
          permissions: data.user.permissions ?? [],
        };
      } else {
        _state = { ...INITIAL_STATE, loading: false };
      }
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
 * permissions). Triggers a single `/api/auth/me` fetch on first mount and
 * shares the result across components via a module-level store.
 *
 * Use {@link refreshAuth} after sign-in/sign-out flows to re-sync.
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

export function refreshAuth(): Promise<void> {
  return fetchAuthState(true);
}

/** Convenience wrapper — returns `false` until auth has loaded. */
export function useIsAuthenticated(): boolean {
  const { authenticated, loading } = useAuth();
  return !loading && authenticated;
}

