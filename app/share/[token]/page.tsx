'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { ArrowLeft, Eye, Copy, LogIn, Globe, Loader2, Lock } from 'lucide-react';
import { BRAND_NAME } from '@/lib/constants/brand';
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

// ─── Direct classroom view: used for both 'public' and 'readonly' modes ──────
// public   → violet banner + Sign In button (no auth needed)
// readonly → blue banner  + no Sign In button (user is already authenticated)

function DirectClassroomView({
  classroom,
  mode,
  token,
}: {
  classroom: SharedClassroom;
  mode: 'public' | 'readonly';
  token: string;
}) {
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
    Promise.resolve().then(() => setReady(true));
    return () => {
      useStageStore.getState().clearStore();
    };
  }, [classroom]);

  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isPublic = mode === 'public';

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroom.id}>
        <div className="h-screen flex flex-col overflow-hidden">
          {/* Mode banner */}
          <div
            className={cn(
              'shrink-0 flex items-center justify-between px-4 py-1.5 text-white text-xs',
              isPublic
                ? 'bg-violet-600 dark:bg-violet-700'
                : 'bg-blue-600 dark:bg-blue-700',
            )}
          >
            <div className="flex items-center gap-2">
              {isPublic ? (
                <Globe className="size-3.5 shrink-0" />
              ) : (
                <Eye className="size-3.5 shrink-0" />
              )}
              <span className="font-medium">{classroom.title}</span>
              <span className="opacity-60">· {isPublic ? 'Public View' : 'Read Only'}</span>
            </div>
            {/* Only show Sign In for public (unauthenticated) viewers */}
            {isPublic && (
              <a
                href={`/api/auth/login?returnUrl=/share/${token}`}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/20 hover:bg-white/30 transition-colors font-medium"
              >
                <LogIn className="size-3" />
                Sign In
              </a>
            )}
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <Stage />
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [mode, setMode] = useState<'public' | 'readonly' | 'editable'>('public');
  const [classroom, setClassroom] = useState<SharedClassroom | null>(null);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    fetch(`/api/share/${token}`)
      .then(async (r) => {
        if (r.status === 401) {
          const data = await r.json().catch(() => ({}));
          if (data.requiresAuth) {
            setRequiresAuth(true);
            return null;
          }
          throw new Error('Authentication required');
        }
        if (!r.ok) throw new Error(r.status === 404 ? 'Share not found' : 'Failed to load');
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setMode(data.mode);
        setClassroom(data.classroom);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleCopy = async () => {
    setCopying(true);
    try {
      const res = await fetch(`/api/share/${token}/copy`, { method: 'POST' });
      if (res.status === 401) {
        toast.error('Please log in to copy this classroom');
        window.location.href = `/api/auth/login?returnUrl=/share/${token}`;
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
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Login required (readonly / editable) ──
  if (requiresAuth) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-sm"
        >
          <div className="size-16 mx-auto mb-4 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Lock className="size-7 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-xl font-semibold text-foreground mb-2">Login Required</h1>
          <p className="text-sm text-muted-foreground mb-6">
            This shared classroom requires you to be signed in to view it.
          </p>
          <a
            href={`/api/auth/login?returnUrl=/share/${token}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-all"
          >
            <LogIn className="size-3.5" />
            Sign In to View
          </a>
        </motion.div>
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

  // ── Public / Readonly: render Stage directly ──
  if (mode === 'public' || mode === 'readonly') {
    return <DirectClassroomView classroom={classroom} mode={mode} token={token} />;
  }

  // ── Editable: intermediate summary page (for copy action) ──
  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col">
      {/* Header */}
      <div className="px-4 md:px-8 py-4 flex items-center justify-between border-b border-border/30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/')}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{classroom.title}</h1>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                <Copy className="size-3" />
                Editable
              </span>
              <span className="text-xs text-muted-foreground/60">
                {classroom.scenes.length} scenes · {classroom.language}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={handleCopy}
          disabled={copying}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-all disabled:opacity-50"
        >
          {copying ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
          Copy to My Classrooms
        </button>
      </div>

      {/* Scene cards */}
      <div className="flex-1 p-4 md:p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-4xl mx-auto"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {classroom.scenes.map((scene, i) => (
              <div
                key={scene.id}
                className="rounded-xl border border-border/40 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="size-6 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground uppercase">
                    {scene.type}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-foreground line-clamp-2">
                  {(scene as unknown as { title?: string }).title || `Scene ${i + 1}`}
                </h3>
              </div>
            ))}
          </div>

          {/* Editable CTA */}
          <div className="mt-8 p-6 rounded-2xl bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border border-green-200/30 dark:border-green-800/30 text-center">
            <h3 className="text-base font-semibold text-foreground mb-2">
              Want to edit this courseware?
            </h3>
            <p className="text-sm text-muted-foreground/70 mb-4">
              Copy it to your account and continue editing, adding new content, or chatting with AI agents.
            </p>
            <button
              onClick={handleCopy}
              disabled={copying}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-all disabled:opacity-50"
            >
              {copying ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
              Copy to My Classrooms
            </button>
          </div>
        </motion.div>
      </div>

      <div className="py-4 text-center text-xs text-muted-foreground/40">{BRAND_NAME}</div>
    </div>
  );
}
