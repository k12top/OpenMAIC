'use client';

/**
 * Reusable dialog for renaming an AI agent's display name.
 *
 * Two scopes supported via the `scope` prop:
 *  - `'stage'`: writes `stage.agentNameOverrides[agentId]` — affects ONLY
 *    the currently loaded classroom (highest priority in the resolver).
 *  - `'global'`: writes `settings.agentNamePresets[agentId]` — affects all
 *    classrooms that don't have their own per-classroom override.
 *
 * The dialog displays the *current* effective name as the initial input
 * value and exposes a "reset to default" affordance when the chosen scope
 * already has an override on file. On save, a toast reminds the user that
 * already-generated speech text may still mention the old name and can be
 * regenerated per-action if needed.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RotateCcw } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store/stage';
import { useSettingsStore } from '@/lib/store/settings';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { resolveAgentName } from '@/lib/agents/resolve-name';
import { toast } from 'sonner';

export type AgentRenameScope = 'stage' | 'global';

interface AgentRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  /** Fallback name (e.g. registry default). Used when no overrides exist. */
  baseName: string;
  /**
   * Which storage layer to write to. Defaults to `'stage'` when a stage is
   * loaded, otherwise `'global'`. Forced values let callers be explicit
   * (e.g. the Settings panel always uses `'global'`).
   */
  scope?: AgentRenameScope;
}

export function AgentRenameDialog({
  open,
  onOpenChange,
  agentId,
  baseName,
  scope: scopeProp,
}: AgentRenameDialogProps) {
  const { t } = useI18n();
  const stage = useStageStore((s) => s.stage);
  const setAgentNameOverride = useStageStore((s) => s.setAgentNameOverride);
  const settingsPresets = useSettingsStore((s) => s.agentNamePresets);
  const setAgentNamePreset = useSettingsStore((s) => s.setAgentNamePreset);
  const updateAgent = useAgentRegistry((s) => s.updateAgent);

  // Default to per-classroom edit when the user is inside a stage; fall
  // back to global preset edit on the home page / settings dialog.
  const scope: AgentRenameScope = scopeProp ?? (stage ? 'stage' : 'global');

  const effectiveName = resolveAgentName(agentId, baseName, {
    stageOverrides: stage?.agentNameOverrides ?? null,
    generatedConfigs: stage?.generatedAgentConfigs ?? null,
    settingsPresets,
    t,
  });

  const [draft, setDraft] = useState(effectiveName);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Re-seed the draft each time the dialog (re)opens so prior aborted
  // edits don't leak back in. Auto-focus + select for fast retyping.
  useEffect(() => {
    if (open) {
      setDraft(effectiveName);
      // Defer focus until the dialog content is mounted.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, effectiveName]);

  const hasOverride =
    scope === 'stage'
      ? !!stage?.agentNameOverrides?.[agentId]
      : !!settingsPresets[agentId];

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      toast.error(t('agent.nameRequired'));
      return;
    }
    if (scope === 'stage') {
      setAgentNameOverride(agentId, trimmed);
    } else {
      setAgentNamePreset(agentId, trimmed);
      // Reflect into the registry so AgentBar / Roundtable update without
      // requiring a refresh. (Per-stage overrides flow through the
      // resolver via stage.agentNameOverrides — no registry write needed.)
      updateAgent(agentId, { name: trimmed });
    }
    toast.success(t('agent.renameSuccess'), {
      description: t('agent.renameStaleHint'),
    });
    onOpenChange(false);
  };

  const reset = () => {
    if (scope === 'stage') {
      setAgentNameOverride(agentId, null);
    } else {
      setAgentNamePreset(agentId, null);
    }
    toast.success(t('agent.renameReset'));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('agent.editName')}</DialogTitle>
          <DialogDescription>
            {scope === 'stage' ? t('agent.scopeStageDesc') : t('agent.scopeGlobalDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="agent-rename-input" className="text-xs">
            {t('agent.nameLabel')}
          </Label>
          <Input
            id="agent-rename-input"
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
            placeholder={t('agent.namePlaceholder')}
            maxLength={64}
          />
        </div>
        <DialogFooter className="flex !flex-row !justify-between gap-2 items-center">
          {hasOverride ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reset}
              className="text-muted-foreground"
            >
              <RotateCcw className="size-3.5 mr-1" />
              {t('agent.resetToDefault')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={commit}>
              {t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
