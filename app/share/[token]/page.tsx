'use client';

import { useState, useEffect, useCallback, useRef, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, Copy, LogIn, Globe, Loader2, Lock, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import type { Stage as StageType, Scene } from '@/lib/types/stage';

interface SharedClassroom {
  id: string;
  title: string;
  language: string;
  stage: StageType;
  scenes: Scene[];
  createdAt: string;
}

type ShareMode = 'public' | 'readonly' | 'editable' | 'sso';

// ─── Direct classroom view: used for all share modes ─────────────────────────
// public   → violet banner, Sign In button for unauth viewers
// readonly → blue banner, Sign In button for unauth viewers
// editable → emerald banner, "Copy to My Classrooms" primary button
//            (redirects to login for unauth viewers, auto-copies after return)

function DirectClassroomView({
  classroom,
  mode,
  token,
  authenticated,
  isOwnerOfSource,
  onCopy,
  copying,
}: {
  classroom: SharedClassroom;
  mode: ShareMode;
  token: string;
  authenticated: boolean;
  isOwnerOfSource: boolean;
  onCopy: () => void;
  copying: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [userActivated, setUserActivated] = useState(false);
  const stageContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    useStageStore.getState().setStage(classroom.stage);
    useStageStore.setState({
      scenes: classroom.scenes,
      currentSceneId: classroom.scenes[0]?.id ?? null,
      outlines: [],
      generatingOutlines: [],
      generationStatus: 'idle',
      failedOutlines: [],
    });
    // Share pages are normally "not owned" by the viewer. Exception: when the
    // viewer is the author of the source classroom (signed-in & same user id),
    // we keep owner-only UI enabled so they can e.g. regenerate pages directly
    // from the share link.
    useStageStore.getState().setIsOwner(isOwnerOfSource);
    useStageStore.getState().setIsSharedView(true);
    Promise.resolve().then(() => setReady(true));
    return () => {
      useStageStore.getState().clearStore();
    };
  }, [classroom, isOwnerOfSource]);

  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const bannerClass =
    mode === 'public'
      ? 'bg-violet-600 dark:bg-violet-700'
      : mode === 'readonly'
        ? 'bg-blue-600 dark:bg-blue-700'
        : mode === 'editable'
          ? 'bg-emerald-600 dark:bg-emerald-700'
          : 'bg-indigo-700 dark:bg-indigo-800';

  const BannerIcon =
    mode === 'public'
      ? Globe
      : mode === 'readonly'
        ? Eye
        : mode === 'editable'
          ? Copy
          : Lock;

  const modeLabel =
    mode === 'public'
      ? 'Public View'
      : mode === 'readonly'
        ? 'Read Only'
        : mode === 'editable'
          ? 'Editable'
          : 'SSO (Signed-in only)';

  const modeHint =
    mode === 'editable'
      ? authenticated
        ? 'You can copy this classroom to your account to edit it.'
        : 'Sign in to copy this classroom to your account and edit it.'
      : mode === 'sso'
        ? 'Access restricted to signed-in members of this organization.'
        : null;

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroom.id}>
        <div className="h-screen flex flex-col overflow-hidden">
          {/* Mode banner */}
          <div
            className={cn(
              'shrink-0 flex items-center justify-between px-4 py-1.5 text-white text-xs',
              bannerClass,
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <BannerIcon className="size-3.5 shrink-0" />
              <span className="font-medium truncate">{classroom.title}</span>
              <span className="opacity-60 shrink-0">· {modeLabel}</span>
              {modeHint && (
                <span className="opacity-75 truncate hidden sm:inline">— {modeHint}</span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {mode === 'editable' ? (
                <button
                  onClick={onCopy}
                  disabled={copying}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/20 hover:bg-white/30 transition-colors font-medium disabled:opacity-60"
                >
                  {copying ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  {authenticated ? 'Copy to My Classrooms' : 'Sign In to Copy'}
                </button>
              ) : (
                !authenticated && (
                  <a
                    href={`/api/auth/login?returnUrl=/share/${token}`}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/20 hover:bg-white/30 transition-colors font-medium"
                  >
                    <LogIn className="size-3" />
                    Sign In
                  </a>
                )
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden relative" ref={stageContainerRef}>
            <Stage autoPlayOnMount={userActivated} />

            {/* Click-to-start overlay — satisfies browser autoplay policy */}
            {!userActivated && (
              <div
                className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm cursor-pointer transition-opacity"
                onClick={() => setUserActivated(true)}
              >
                <div className="flex flex-col items-center gap-3 select-none">
                  <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center ring-2 ring-white/30 hover:ring-white/50 hover:bg-white/30 transition-all">
                    <Play className="size-7 text-white ml-1" />
                  </div>
                  <span className="text-white/90 text-sm font-medium">点击开始播放</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}

// ─── Main share page ──────────────────────────────────────────────────────────

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const shouldAutoCopy = searchParams.get('copy') === '1';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ShareMode>('public');
  const [classroom, setClassroom] = useState<SharedClassroom | null>(null);
  const [isOwnerOfSource, setIsOwnerOfSource] = useState(false);
  const [copying, setCopying] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [autoCopyHandled, setAutoCopyHandled] = useState(false);

  // Auth check (non-blocking; banner/CTA uses this)
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setAuthenticated(!!data?.authenticated))
      .catch(() => setAuthenticated(false))
      .finally(() => setAuthChecked(true));
  }, []);

  // Load share content
  useEffect(() => {
    let redirected = false;
    fetch(`/api/share/${token}`)
      .then(async (r) => {
        // SSO share + unauth viewer: server returns 401 with requiresAuth.
        // Hard redirect to Casdoor login; we never render any error state
        // because the user isn't "missing" — they just need to sign in first.
        if (r.status === 401) {
          const data = await r.json().catch(() => ({}));
          if (data?.requiresAuth) {
            redirected = true;
            const returnUrl = `/share/${token}`;
            window.location.href = `/api/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`;
            return null;
          }
        }
        if (!r.ok) throw new Error(r.status === 404 ? 'Share not found' : 'Failed to load');
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setMode(data.mode);
        setClassroom(data.classroom);
        setIsOwnerOfSource(!!data.isOwnerOfSource);
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        if (!redirected) setLoading(false);
      });
  }, [token]);

  const handleCopy = useCallback(async () => {
    if (copying) return;
    if (!authenticated) {
      // Redirect to login; on return, ?copy=1 triggers the auto-copy below.
      const returnUrl = `/share/${token}?copy=1`;
      window.location.href = `/api/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`;
      return;
    }
    setCopying(true);
    try {
      const res = await fetch(`/api/share/${token}/copy`, { method: 'POST' });
      if (res.status === 401) {
        const returnUrl = `/share/${token}?copy=1`;
        window.location.href = `/api/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`;
        return;
      }
      if (!res.ok) throw new Error('Copy failed');
      const data = await res.json();
      toast.success('Classroom copied to your account!');
      router.push(data.url);
    } catch {
      toast.error('Failed to copy classroom');
    } finally {
      setCopying(false);
    }
  }, [authenticated, copying, router, token]);

  // Auto-copy after login redirect (editable + ?copy=1 + authed)
  useEffect(() => {
    if (autoCopyHandled) return;
    if (!shouldAutoCopy) return;
    if (!authChecked || !classroom) return;
    if (mode !== 'editable') {
      // Clean the URL even if we can't honor the intent.
      setAutoCopyHandled(true);
      router.replace(`/share/${token}`);
      return;
    }
    if (!authenticated) {
      // Still not logged in — leave the flag; user can click the banner CTA.
      setAutoCopyHandled(true);
      return;
    }
    setAutoCopyHandled(true);
    // Strip ?copy=1 before kicking off to avoid loops on copy-failure retries.
    router.replace(`/share/${token}`);
    handleCopy();
  }, [
    shouldAutoCopy,
    autoCopyHandled,
    authChecked,
    authenticated,
    classroom,
    mode,
    token,
    router,
    handleCopy,
  ]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Error / Not found ──
  if (error || !classroom) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-foreground mb-2">Share Not Found</h1>
          <p className="text-sm text-muted-foreground mb-6">
            {error || 'This share link may have expired or been revoked.'}
          </p>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <DirectClassroomView
      classroom={classroom}
      mode={mode}
      token={token}
      authenticated={authenticated}
      isOwnerOfSource={isOwnerOfSource}
      onCopy={handleCopy}
      copying={copying}
    />
  );
}
