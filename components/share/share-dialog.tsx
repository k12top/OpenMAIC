'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Link2,
  Copy,
  Check,
  Eye,
  Pencil,
  Trash2,
  Loader2,
  Globe,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { useStageStore } from '@/lib/store/stage';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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
  const [mode, setMode] = useState<ShareMode>('public');
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const stageId = useStageStore((s) => s.stage?.id);

  useEffect(() => {
    if (open && stageId) {
      setLoading(true);
      fetch(`/api/share?classroomId=${stageId}`)
        .then((r) => r.json())
        .then((data) => setShares(data.shares || []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [open, stageId]);

  const createShare = async () => {
    if (!stageId) return;
    setCreating(true);
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomId: stageId, mode }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create share');
      }
      const data = await res.json();
      setShares((prev) => [
        { id: data.shareToken, shareToken: data.shareToken, mode: data.mode, url: data.url, createdAt: new Date().toISOString() },
        ...prev,
      ]);
      toast.success('Share link created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create share');
    } finally {
      setCreating(false);
    }
  };

  const deleteShare = async (shareId: string) => {
    try {
      await fetch('/api/share', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareId }),
      });
      setShares((prev) => prev.filter((s) => s.id !== shareId));
      toast.success('Share revoked');
    } catch {
      toast.error('Failed to revoke share');
    }
  };

  const copyLink = (url: string, id: string) => {
    const fullUrl = `${window.location.origin}${url}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Link copied to clipboard');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-border/40 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-border/30">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-violet-500" />
            <h2 className="text-sm font-semibold text-foreground">Share Classroom</h2>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Create new share */}
        <div className="px-5 py-4 border-b border-border/20">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              onClick={() => setMode('public')}
              className={cn(
                'px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border',
                mode === 'public'
                  ? 'bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300'
                  : 'border-border/40 text-muted-foreground hover:bg-muted/30',
              )}
            >
              <Globe className="size-3" />
              Public
            </button>
            <button
              onClick={() => setMode('readonly')}
              className={cn(
                'px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border',
                mode === 'readonly'
                  ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                  : 'border-border/40 text-muted-foreground hover:bg-muted/30',
              )}
            >
              <Lock className="size-3" />
              Read Only
            </button>
            <button
              onClick={() => setMode('editable')}
              className={cn(
                'px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border',
                mode === 'editable'
                  ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                  : 'border-border/40 text-muted-foreground hover:bg-muted/30',
              )}
            >
              <Pencil className="size-3" />
              Editable
            </button>
            <button
              onClick={() => setMode('sso')}
              className={cn(
                'px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border',
                mode === 'sso'
                  ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                  : 'border-border/40 text-muted-foreground hover:bg-muted/30',
              )}
            >
              <ShieldCheck className="size-3" />
              SSO
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground/60 mb-3">
            {mode === 'public'
              ? 'Anyone can view this link without logging in.'
              : mode === 'readonly'
                ? 'Anyone with the link can view in read-only mode. Sign-in not required.'
                : mode === 'editable'
                  ? 'Anyone with the link can view; signed-in viewers can copy this courseware to their account and edit it.'
                  : 'Requires organization sign-in. Unauthenticated visitors are redirected to SSO login before they can view.'}
          </p>
          <button
            onClick={createShare}
            disabled={creating}
            className="w-full px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
            Create Share Link
          </button>
        </div>

        {/* Existing shares */}
        <div className="max-h-60 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-muted-foreground/50 text-sm">
              <Loader2 className="size-4 animate-spin mx-auto mb-1" />
              Loading...
            </div>
          ) : shares.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground/50 text-sm">
              No active share links
            </div>
          ) : (
            <div className="divide-y divide-border/20">
              {shares.map((share) => (
                <div key={share.id || share.shareToken} className="px-5 py-3 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
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
                      <span className="text-xs text-muted-foreground/60 truncate">
                        {share.url}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => copyLink(share.url, share.id || share.shareToken)}
                    className="shrink-0 p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors"
                  >
                    {copiedId === (share.id || share.shareToken) ? (
                      <Check className="size-3.5 text-green-500" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => deleteShare(share.id)}
                    className="shrink-0 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
