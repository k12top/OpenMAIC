'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Copy, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';
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
// 顶栏（可复制说明 + 复制按钮）仅在 editable 模式显示。讲解 / 自动切换由
// 底部 CanvasToolbar 统一承载（详见 components/canvas/canvas-toolbar.tsx
// 里的 viewerLectureToggle 分支），分享页本身不再绘制单独的浮窗按钮。

function DirectClassroomView({
  classroom,
  mode,
  authenticated,
  isOwnerOfSource,
  onCopy,
  copying,
}: {
  classroom: SharedClassroom;
  mode: ShareMode;
  authenticated: boolean;
  isOwnerOfSource: boolean;
  onCopy: () => void;
  copying: boolean;
}) {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);

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

    // Hydrate agents from stage.generatedAgentConfigs so roundtable discussions
    // work on share pages. Without this, the agent registry is empty and
    // discussions would have no participants.
    const hydrateAgents = async () => {
      const configs = classroom.stage.generatedAgentConfigs;
      if (configs && configs.length > 0) {
        const { saveGeneratedAgents } = await import('@/lib/orchestration/registry/store');
        const { useSettingsStore } = await import('@/lib/store/settings');
        const agentIds = await saveGeneratedAgents(classroom.stage.id, configs);
        useSettingsStore.getState().setSelectedAgentIds(agentIds);
      }
    };
    hydrateAgents();

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

  const copyPrimaryClass = cn(
    'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold',
    'bg-white text-emerald-900 shadow-lg shadow-black/15 ring-1 ring-white/60',
    'transition-all hover:bg-emerald-50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55',
  );

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroom.id}>
        <div className="h-screen flex flex-col overflow-hidden">
          {/* 可复制模式专用顶栏（说明 + 复制按钮） */}
          {mode === 'editable' && (
            <header
              className={cn(
                'shrink-0 border-b border-black/10 bg-emerald-600 text-white dark:bg-emerald-700',
                'shadow-[0_4px_24px_rgba(0,0,0,0.12)]',
              )}
            >
              <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4 sm:py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25"
                    aria-hidden
                  >
                    <Copy className="size-5 text-white" strokeWidth={2} />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <h1 className="text-sm font-semibold tracking-tight text-white sm:text-base">
                      {t('share.viewer.bannerEditableTitle')}
                    </h1>
                    <p className="mt-0.5 max-w-2xl text-xs leading-snug text-white/80 sm:text-[13px]">
                      {t('share.viewer.bannerEditableHint')}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
                  <button type="button" onClick={onCopy} disabled={copying} className={copyPrimaryClass}>
                    {copying ? (
                      <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                    ) : (
                      <Copy className="size-4 shrink-0" aria-hidden />
                    )}
                    {authenticated ? t('share.viewer.copyToMine') : t('share.viewer.signInToCopy')}
                  </button>
                </div>
              </div>
            </header>
          )}

          <div className="flex-1 flex flex-col overflow-hidden relative">
            <Stage autoPlayOnMount={false} />
          </div>
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}

// ─── Main share page ──────────────────────────────────────────────────────────

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { t } = useI18n();
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
        // Any non-public share + unauth viewer: server returns 401 with
        // requiresAuth. Hard redirect to Casdoor login; we never render any
        // error state because the user isn't "missing" — they just need to
        // sign in first. (See app/api/share/[token]/route.ts.)
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
      toast.success(t('share.viewer.copySuccess'));
      router.push(data.url);
    } catch {
      toast.error(t('share.viewer.copyFailed'));
    } finally {
      setCopying(false);
    }
  }, [authenticated, copying, router, t, token]);

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
      authenticated={authenticated}
      isOwnerOfSource={isOwnerOfSource}
      onCopy={handleCopy}
      copying={copying}
    />
  );
}
