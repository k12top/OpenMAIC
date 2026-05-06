'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Link2,
  Copy,
  Check,
  Pencil,
  Trash2,
  Loader2,
  Globe,
  Lock,
  ShieldCheck,
  RefreshCw,
  Presentation,
} from 'lucide-react';
import { useStageStore } from '@/lib/store/stage';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  flushClassroomSync,
  uploadMediaToServer,
} from '@/lib/sync/classroom-sync';
import { db } from '@/lib/utils/database';
import { MenuGate } from '@/components/auth/menu-gate';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ShareMode = 'public' | 'readonly' | 'editable' | 'sso';

interface ShareItem {
  id: string;
  shareToken: string;
  mode: ShareMode;
  url: string;
  createdAt: string;
}

export function ShareDialog({ open, onOpenChange }: ShareDialogProps) {
  const { t } = useI18n();
  const stageId = useStageStore((s) => s.stage?.id);
  const lectureMode = useStageStore((s) => !!s.stage?.lectureMode);
  const setLectureMode = useStageStore((s) => s.setLectureMode);

  const [mode, setMode] = useState<ShareMode>('public');
  const [share, setShare] = useState<ShareItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !stageId) return;
    setLoading(true);
    fetch(`/api/share?classroomId=${stageId}`)
      .then((r) => r.json())
      .then((data) => {
        const items = (data.shares || []) as ShareItem[];
        // Persistent-link model: at most one row per (classroom, user). The
        // GET endpoint may still return multiple legacy rows; pick the
        // earliest as the canonical one and surface that mode in the UI.
        const sorted = [...items].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        const canonical = sorted[0] || null;
        setShare(canonical);
        if (canonical) setMode(canonical.mode);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, stageId]);

  const createOrUpdate = useCallback(async () => {
    if (!stageId) return;
    setCreating(true);
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomId: stageId, mode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('share.createFailed'));
      }
      const data = await res.json();
      setShare({
        id: data.id || data.shareToken,
        shareToken: data.shareToken,
        mode: data.mode,
        url: data.url,
        createdAt: new Date().toISOString(),
      });
      toast.success(data.reused ? t('share.modeUpdated') : t('share.linkCreated'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('share.createFailed'));
    } finally {
      setCreating(false);
    }
  }, [stageId, mode, t]);

  const revokeShare = useCallback(async () => {
    if (!share?.id) return;
    setRevoking(true);
    try {
      const res = await fetch('/api/share', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareId: share.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('share.revokeFailed'));
      }
      setShare(null);
      toast.success(t('share.revoked'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('share.revokeFailed'));
    } finally {
      setRevoking(false);
    }
  }, [share?.id, t]);

  const copyLink = useCallback(() => {
    if (!share) return;
    const fullUrl = `${window.location.origin}${share.url}`;
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success(t('share.linkCopied'));
  }, [share, t]);

  const pushLatest = useCallback(async () => {
    if (!stageId || !share) return;
    setPushing(true);
    try {
      // 1. Flush any pending stage/scenes sync so the server-side reconcile
      //    sees the latest text/structure before we ask which audio is missing.
      flushClassroomSync();
      // Give the keepalive POST a brief moment to land before we query the DB.
      await new Promise((resolve) => setTimeout(resolve, 600));

      // 2. Ask the server which TTS audio rows are missing for this stage.
      const res = await fetch('/api/share/republish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomId: stageId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('share.pushFailed'));
      }
      const data = (await res.json()) as { missingAudioIds: string[]; totalAudioIds: number };

      // 3. Re-upload missing TTS blobs from IndexedDB and patch audioUrl in
      //    the store so subsequent share viewers resolve the new audio.
      let uploaded = 0;
      let skipped = 0;
      for (const audioId of data.missingAudioIds) {
        try {
          const record = await db.audioFiles.get(audioId);
          if (!record?.blob) {
            skipped += 1;
            continue;
          }
          const result = await uploadMediaToServer(
            stageId,
            'tts',
            record.blob,
            `${audioId}.${record.format || 'mp3'}`,
            audioId,
          );
          if (result?.url) {
            useStageStore.getState().updateSpeechActionAudioUrl(audioId, result.url);
            uploaded += 1;
          } else {
            skipped += 1;
          }
        } catch {
          skipped += 1;
        }
      }

      // After patching audioUrls, re-flush so the new URLs land in the
      // server's stage_json snapshot too.
      flushClassroomSync();

      if (data.missingAudioIds.length === 0) {
        toast.success(t('share.pushSuccessClean'));
      } else {
        toast.success(
          t('share.pushSuccessSummary', {
            uploaded,
            skipped,
            total: data.missingAudioIds.length,
          }),
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('share.pushFailed'));
    } finally {
      setPushing(false);
    }
  }, [stageId, share, t]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-border/40 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-border/30">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-violet-500" />
            <h2 className="text-sm font-semibold text-foreground">{t('share.title')}</h2>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Mode selector — always visible; doubles as initial creator */}
        <div className="px-5 py-4 border-b border-border/20">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <ModeButton
              active={mode === 'public'}
              onClick={() => setMode('public')}
              icon={<Globe className="size-3" />}
              label={t('share.modePublic')}
              colorClass="violet"
            />
            <ModeButton
              active={mode === 'readonly'}
              onClick={() => setMode('readonly')}
              icon={<Lock className="size-3" />}
              label={t('share.modeReadonly')}
              colorClass="blue"
            />
            <ModeButton
              active={mode === 'editable'}
              onClick={() => setMode('editable')}
              icon={<Pencil className="size-3" />}
              label={t('share.modeEditable')}
              colorClass="green"
            />
            <ModeButton
              active={mode === 'sso'}
              onClick={() => setMode('sso')}
              icon={<ShieldCheck className="size-3" />}
              label={t('share.modeSso')}
              colorClass="indigo"
            />
          </div>
          <p className="text-[11px] text-muted-foreground/60 mb-3">
            {mode === 'public'
              ? t('share.modePublicDesc')
              : mode === 'readonly'
                ? t('share.modeReadonlyDesc')
                : mode === 'editable'
                  ? t('share.modeEditableDesc')
                  : t('share.modeSsoDesc')}
          </p>
          <MenuGate menu="header.share.lectureMode" op="operable">
            <button
              type="button"
              role="switch"
              aria-checked={lectureMode}
              onClick={() => {
                if (!stageId) return;
                const next = !lectureMode;
                setLectureMode(next);
                toast.success(
                  next ? t('share.lectureModeOn') : t('share.lectureModeOff'),
                );
              }}
              disabled={!stageId}
              className={cn(
                'w-full mb-3 flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                lectureMode
                  ? 'border-purple-200 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-950/20'
                  : 'border-border/40 hover:bg-muted/30',
                !stageId && 'opacity-50 cursor-not-allowed',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg',
                  lectureMode
                    ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300'
                    : 'bg-muted/40 text-muted-foreground',
                )}
                aria-hidden
              >
                <Presentation className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {t('share.lectureModeLabel')}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded',
                      lectureMode
                        ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300'
                        : 'bg-muted/50 text-muted-foreground',
                    )}
                  >
                    {lectureMode
                      ? t('share.lectureModeOn')
                      : t('share.lectureModeOff')}
                  </span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground/70">
                  {t('share.lectureModeDesc')}
                </span>
              </span>
            </button>
          </MenuGate>
          {!share && (
            <button
              onClick={createOrUpdate}
              disabled={creating || loading}
              className="w-full px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
              {t('share.createLink')}
            </button>
          )}
          {share && share.mode !== mode && (
            <button
              onClick={createOrUpdate}
              disabled={creating}
              className="w-full px-4 py-2 rounded-xl bg-amber-500/90 text-white text-xs font-medium hover:bg-amber-500 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Pencil className="size-3.5" />}
              {t('share.applyModeChange')}
            </button>
          )}
        </div>

        {/* Existing share — single persistent link card */}
        <div className="px-5 py-4">
          {loading ? (
            <div className="py-4 text-center text-muted-foreground/50 text-sm">
              <Loader2 className="size-4 animate-spin mx-auto mb-1" />
              {t('share.loading')}
            </div>
          ) : !share ? (
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
              {t('share.persistentHint')}
            </p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-border/40 bg-muted/20 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={cn(
                      'shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium',
                      share.mode === 'public'
                        ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400'
                        : share.mode === 'readonly'
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                          : share.mode === 'editable'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                            : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
                    )}
                  >
                    {share.mode}
                  </span>
                  <span className="text-[11px] text-muted-foreground/60">
                    {t('share.persistentBadge')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground truncate flex-1 font-mono">
                    {share.url}
                  </span>
                  <button
                    onClick={copyLink}
                    className="shrink-0 p-1.5 rounded-lg hover:bg-background text-muted-foreground transition-colors"
                  >
                    {copied ? (
                      <Check className="size-3.5 text-green-500" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={pushLatest}
                  disabled={pushing}
                  className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {pushing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  {pushing ? t('share.pushing') : t('share.pushLatest')}
                </button>
                <button
                  onClick={revokeShare}
                  disabled={revoking}
                  className="px-3 py-2 rounded-xl border border-border/40 text-muted-foreground text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-500 hover:border-red-200 dark:hover:border-red-800 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {revoking ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  {t('share.revoke')}
                </button>
              </div>

              <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
                {t('share.pushExplanation')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ModeButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  colorClass: 'violet' | 'blue' | 'green' | 'indigo';
}

function ModeButton({ active, onClick, icon, label, colorClass }: ModeButtonProps) {
  const activeMap: Record<ModeButtonProps['colorClass'], string> = {
    violet:
      'bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300',
    blue:
      'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
    green:
      'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
    indigo:
      'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300',
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border',
        active ? activeMap[colorClass] : 'border-border/40 text-muted-foreground hover:bg-muted/30',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
