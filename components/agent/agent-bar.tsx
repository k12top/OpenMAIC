'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { resolveAgentVoice, getAvailableProvidersWithVoices } from '@/lib/audio/voice-resolver';
import { playBrowserTTSPreview } from '@/lib/audio/browser-tts-preview';
import {
  Sparkles,
  ChevronDown,
  Shuffle,
  Volume2,
  VolumeX,
  Loader2,
  Check,
  User,
  GraduationCap,
  Users,
  Pencil,
} from 'lucide-react';
import { useStageStore } from '@/lib/store/stage';
import { resolveAgentName } from '@/lib/agents/resolve-name';
import { AgentRenameDialog } from '@/components/agent/agent-rename-dialog';
import { useMenuPerm } from '@/components/auth/menu-gate';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import type { TTSProviderId } from '@/lib/audio/types';
import type { ProviderWithVoices } from '@/lib/audio/voice-resolver';

/**
 * Role Badge Component
 */
function RoleBadge({ role }: { role: string }) {
  const { t } = useI18n();
  const getLabel = () => {
    if (role === 'teacher') return t('settings.agentRoles.teacher') || 'Teacher';
    if (role === 'assistant') return t('settings.agentRoles.assistant') || 'Assistant';
    return t('settings.agentRoles.student') || 'Student';
  };

  return (
    <span
      className={cn(
        'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-sm transition-all',
        role === 'teacher' && 'bg-blue-500 text-white dark:bg-blue-600',
        role === 'assistant' && 'bg-violet-500 text-white dark:bg-violet-600',
        role === 'student' && 'bg-emerald-500 text-white dark:bg-emerald-600',
      )}
    >
      {getLabel()}
    </span>
  );
}

/**
 * Voice Selection Item
 */
function VoiceSelectionItem({
  provider,
  group,
  voice,
  isActive,
  isPreviewing,
  onSelect,
  onPreview,
}: {
  provider: ProviderWithVoices;
  group: { modelId: string; modelName: string };
  voice: { id: string; name: string };
  isActive: boolean;
  isPreviewing: boolean;
  onSelect: () => void;
  onPreview: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-2 py-1.5 rounded-md transition-all cursor-pointer mb-0.5',
        isActive ? 'bg-primary/10 border border-primary/20' : 'hover:bg-accent border border-transparent',
      )}
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('text-[13px] truncate', isActive ? 'text-primary font-semibold' : 'text-foreground')}>
            {voice.name}
          </span>
          {isActive && <Check className="size-3 text-primary shrink-0" />}
        </div>
        <div className="text-[10px] text-muted-foreground/60 truncate">
          {group.modelId ? `${provider.providerName} · ${group.modelName}` : provider.providerName}
        </div>
      </div>
      <button
        type="button"
        onClick={onPreview}
        className={cn(
          'shrink-0 size-7 flex items-center justify-center rounded-full transition-all',
          isPreviewing ? 'bg-primary text-white shadow-lg' : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {isPreviewing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Volume2 className="size-3.5" />
        )}
      </button>
    </div>
  );
}

/**
 * Universal Agent Voice Selector Popover Content
 */
function VoiceSelectorContent({
  availableProviders,
  currentProviderId,
  currentVoiceId,
  currentModelId,
  previewingId,
  onSelect,
  handlePreview,
}: {
  availableProviders: ProviderWithVoices[];
  currentProviderId: string;
  currentVoiceId: string;
  currentModelId: string;
  previewingId: string | null;
  onSelect: (providerId: TTSProviderId, voiceId: string, modelId?: string) => void;
  handlePreview: (providerId: TTSProviderId, voiceId: string, modelId?: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="w-[320px] max-h-[400px] overflow-y-auto p-2 flex flex-col gap-1.5 custom-scrollbar bg-white dark:bg-slate-900">
      <div className="px-2 py-2 mb-1 border-b border-border/40">
        <h4 className="text-[13px] font-bold text-foreground flex items-center gap-2">
          <Volume2 className="size-3.5 text-primary" />
          {t('toolbar.voiceSettings') || 'Voice Settings'}
        </h4>
      </div>
      {availableProviders.map((provider) =>
        provider.modelGroups.map((group) => (
          <div key={`${provider.providerId}::${group.modelId}`} className="mb-2 last:mb-0">
            {group.voices.map((voice) => {
              const isActive =
                currentProviderId === provider.providerId &&
                currentVoiceId === voice.id &&
                (currentModelId || '') === (group.modelId || '');
              const previewKey = `${provider.providerId}::${voice.id}`;
              const isPreviewing = previewingId === previewKey;
              return (
                <VoiceSelectionItem
                  key={previewKey}
                  provider={provider}
                  group={group}
                  voice={voice}
                  isActive={isActive}
                  isPreviewing={isPreviewing}
                  onSelect={() => onSelect(provider.providerId, voice.id, group.modelId || undefined)}
                  onPreview={(e) => {
                    e.stopPropagation();
                    handlePreview(provider.providerId, voice.id, group.modelId);
                  }}
                />
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}

/**
 * Agent Voice Pill
 */
function AgentVoicePill({
  agent,
  agentIndex,
  availableProviders,
  disabled,
}: {
  agent: AgentConfig;
  agentIndex: number;
  availableProviders: ProviderWithVoices[];
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const updateAgent = useAgentRegistry((s) => s.updateAgent);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const resolved = resolveAgentVoice(agent, agentIndex, availableProviders);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewCancelRef = useRef<(() => void) | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  const displayName = (() => {
    for (const p of availableProviders) {
      if (p.providerId === resolved.providerId) {
        const v = p.voices.find((voice) => voice.id === resolved.voiceId);
        if (v) return v.name;
      }
    }
    return resolved.voiceId;
  })();

  const stopPreview = useCallback(() => {
    previewCancelRef.current?.();
    previewCancelRef.current = null;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = '';
      previewAudioRef.current = null;
    }
    setPreviewingId(null);
  }, []);

  const handlePreview = useCallback(
    async (providerId: TTSProviderId, voiceId: string, modelId?: string) => {
      const key = `${providerId}::${voiceId}`;
      if (previewingId === key) {
        stopPreview();
        return;
      }
      stopPreview();
      setPreviewingId(key);

      const courseLanguage =
        (typeof localStorage !== 'undefined' && localStorage.getItem('generationLanguage')) ||
        'zh-CN';
      const previewText = courseLanguage === 'en-US' ? 'Welcome to AI Classroom' : t('agentBar.readyToLearn');

      if (providerId === 'browser-native-tts') {
        const { promise, cancel } = playBrowserTTSPreview({ text: previewText, voice: voiceId });
        previewCancelRef.current = cancel;
        try {
          await promise;
        } catch {
          // ignore abort
        }
        setPreviewingId(null);
        return;
      }

      try {
        const controller = new AbortController();
        previewAbortRef.current = controller;
        const providerConfig = ttsProvidersConfig[providerId];
        const res = await fetch('/api/generate/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: previewText,
            audioId: 'voice-preview',
            ttsProviderId: providerId,
            ttsModelId: modelId || providerConfig?.modelId,
            ttsVoice: voiceId,
            ttsSpeed: 1,
            ttsApiKey: providerConfig?.apiKey,
            ttsBaseUrl: providerConfig?.serverBaseUrl || providerConfig?.baseUrl,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('TTS error');
        const data = await res.json();
        if (!data.base64) throw new Error('No audio');
        const audio = new Audio(`data:audio/${data.format || 'mp3'};base64,${data.base64}`);
        previewAudioRef.current = audio;
        audio.addEventListener('ended', () => setPreviewingId(null));
        audio.addEventListener('error', () => setPreviewingId(null));
        await audio.play();
      } catch {
        setPreviewingId(null);
      }
    },
    [previewingId, stopPreview, ttsProvidersConfig],
  );

  useEffect(() => () => stopPreview(), [stopPreview]);

  if (disabled) {
    return (
      <div className="flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-muted/40 text-[11px] text-muted-foreground/30 ring-1 ring-border/20 cursor-not-allowed">
        <VolumeX className="size-3 shrink-0" />
        <span className="truncate">{displayName}</span>
      </div>
    );
  }

  return (
    <Popover open={popoverOpen} onOpenChange={(open) => { setPopoverOpen(open); if (!open) stopPreview(); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="group flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-primary/5 hover:bg-primary/10 border border-primary/20 hover:border-primary/40 text-[11px] text-primary/80 hover:text-primary transition-all shrink-0 shadow-sm"
        >
          <Volume2 className={cn("size-3 shrink-0", previewingId && "animate-pulse")} />
          <span className="truncate max-w-[60px]">{displayName}</span>
          <ChevronDown className="size-3 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="p-0 border-border select-none shadow-2xl rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <VoiceSelectorContent
          availableProviders={availableProviders}
          currentProviderId={resolved.providerId}
          currentVoiceId={resolved.voiceId}
          currentModelId={resolved.modelId || ''}
          previewingId={previewingId}
          onSelect={(pid, vid, mid) => {
            updateAgent(agent.id, { voiceConfig: { providerId: pid, modelId: mid, voiceId: vid } });
            setPopoverOpen(false);
          }}
          handlePreview={handlePreview}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Teacher Voice Pill — Global sync
 */
function TeacherVoicePill({ availableProviders, disabled }: { availableProviders: ProviderWithVoices[]; disabled?: boolean; }) {
  const { t } = useI18n();
  const ttsProviderId = useSettingsStore((s) => s.ttsProviderId);
  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const setTTSProvider = useSettingsStore((s) => s.setTTSProvider);
  const setTTSVoice = useSettingsStore((s) => s.setTTSVoice);
  const setTTSProviderConfig = useSettingsStore((s) => s.setTTSProviderConfig);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewCancelRef = useRef<(() => void) | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  const displayName = (() => {
    for (const p of availableProviders) {
      if (p.providerId === ttsProviderId) {
        const v = p.voices.find((voice) => voice.id === ttsVoice);
        if (v) return v.name;
      }
    }
    return ttsVoice || 'default';
  })();

  const stopPreview = useCallback(() => {
    previewCancelRef.current?.();
    previewCancelRef.current = null;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = '';
      previewAudioRef.current = null;
    }
    setPreviewingId(null);
  }, []);

  const handlePreview = useCallback(
    async (providerId: TTSProviderId, voiceId: string, modelId?: string) => {
      const key = `${providerId}::${voiceId}`;
      if (previewingId === key) {
        stopPreview();
        return;
      }
      stopPreview();
      setPreviewingId(key);

      const courseLanguage = (typeof localStorage !== 'undefined' && localStorage.getItem('generationLanguage')) || 'zh-CN';
      const previewText = courseLanguage === 'en-US' ? 'Welcome to AI Classroom' : t('agentBar.readyToLearn');

      if (providerId === 'browser-native-tts') {
        const { promise, cancel } = playBrowserTTSPreview({ text: previewText, voice: voiceId });
        previewCancelRef.current = cancel;
        try { await promise; } catch { }
        setPreviewingId(null);
        return;
      }

      try {
        const controller = new AbortController();
        previewAbortRef.current = controller;
        const providerConfig = ttsProvidersConfig[providerId];
        const res = await fetch('/api/generate/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: previewText,
            audioId: 'voice-preview',
            ttsProviderId: providerId,
            ttsModelId: modelId || providerConfig?.modelId,
            ttsVoice: voiceId,
            ttsSpeed: 1,
            ttsApiKey: providerConfig?.apiKey,
            ttsBaseUrl: providerConfig?.serverBaseUrl || providerConfig?.baseUrl,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('TTS error');
        const data = await res.json();
        if (!data.base64) throw new Error('No audio');
        const audio = new Audio(`data:audio/${data.format || 'mp3'};base64,${data.base64}`);
        previewAudioRef.current = audio;
        audio.addEventListener('ended', () => setPreviewingId(null));
        audio.addEventListener('error', () => setPreviewingId(null));
        await audio.play();
      } catch { setPreviewingId(null); }
    },
    [previewingId, stopPreview, ttsProvidersConfig],
  );

  useEffect(() => () => stopPreview(), [stopPreview]);

  if (disabled) {
    return (
      <div className="flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-muted/40 text-[11px] text-muted-foreground/30 ring-1 ring-border/20 cursor-not-allowed">
        <VolumeX className="size-3 shrink-0" />
        <span className="truncate">{displayName}</span>
      </div>
    );
  }

  const currentModelId = ttsProvidersConfig[ttsProviderId]?.modelId || '';

  return (
    <Popover open={popoverOpen} onOpenChange={(open) => { setPopoverOpen(open); if (!open) stopPreview(); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="group flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/40 text-[11px] text-blue-600 dark:text-blue-400 font-medium transition-all shrink-0 shadow-sm"
        >
          <Volume2 className={cn("size-3 shrink-0", previewingId && "animate-pulse")} />
          <span className="truncate max-w-[60px]">{displayName}</span>
          <ChevronDown className="size-3 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="p-0 border-border select-none shadow-2xl rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <VoiceSelectorContent
          availableProviders={availableProviders}
          currentProviderId={ttsProviderId}
          currentVoiceId={ttsVoice}
          currentModelId={currentModelId}
          previewingId={previewingId}
          onSelect={(pid, vid, mid) => {
            setTTSProvider(pid);
            setTTSVoice(vid);
            if (mid) setTTSProviderConfig(pid, { modelId: mid });
            setPopoverOpen(false);
          }}
          handlePreview={handlePreview}
        />
      </PopoverContent>
    </Popover>
  );
}

export function AgentBar({ inline = false }: { inline?: boolean } = {}) {
  const { t } = useI18n();
  const { listAgents } = useAgentRegistry();
  const selectedAgentIds = useSettingsStore((s) => s.selectedAgentIds);
  const setSelectedAgentIds = useSettingsStore((s) => s.setSelectedAgentIds);
  const agentMode = useSettingsStore((s) => s.agentMode);
  const setAgentMode = useSettingsStore((s) => s.setAgentMode);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const stage = useStageStore((s) => s.stage);
  const settingsPresets = useSettingsStore((s) => s.agentNamePresets);
  const canRenameAgents = useMenuPerm('settings.agents', 'operable');

  const [open, setOpen] = useState(false);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [renameTarget, setRenameTarget] = useState<{ id: string; baseName: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const getDisplayName = (agentId: string, baseName: string) =>
    resolveAgentName(agentId, baseName, {
      stageOverrides: stage?.agentNameOverrides ?? null,
      generatedConfigs: stage?.generatedAgentConfigs ?? null,
      settingsPresets,
      t,
    });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const loadVoices = () => setBrowserVoices(speechSynthesis.getVoices());
    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const agents = listAgents().filter((a) => !a.isGenerated);
  const teacherAgent = agents.find((a) => a.role === 'teacher');
  const otherAgents = agents.filter((a) => a.role !== 'teacher');

  const serverProviders = getAvailableProvidersWithVoices(ttsProvidersConfig);
  const availableProviders: ProviderWithVoices[] = [
    ...serverProviders,
    ...(browserVoices.length > 0
      ? [{
          providerId: 'browser-native-tts' as TTSProviderId,
          providerName: 'Browser Native',
          voices: browserVoices.map((v) => ({ id: v.voiceURI, name: v.name })),
          modelGroups: [{ modelId: '', modelName: 'Browser Native', voices: browserVoices.map((v) => ({ id: v.voiceURI, name: v.name })) }],
        }]
      : []),
  ];
  const showVoice = availableProviders.length > 0;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && containerRef.current.contains(e.target as Node)) return;
      if ((e.target as Element).closest?.('[data-radix-popper-content-wrapper]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleModeChange = (mode: 'preset' | 'auto') => {
    setAgentMode(mode);
    if (mode === 'preset') {
      const presetIds = selectedAgentIds.filter((id) => agents.some((a) => a.id === id));
      if (teacherAgent && !presetIds.includes(teacherAgent.id)) presetIds.unshift(teacherAgent.id);
      setSelectedAgentIds(presetIds.length > 0 ? presetIds : ['default-1', 'default-2', 'default-3']);
    }
  };

  const toggleAgent = (agentId: string) => {
    if (selectedAgentIds.includes(agentId)) {
      setSelectedAgentIds(selectedAgentIds.filter((id) => id !== agentId));
    } else {
      setSelectedAgentIds([...selectedAgentIds, agentId]);
    }
  };

  const contentNode = (
    <div className={cn("flex flex-col gap-3", !inline && "w-[400px] p-4 bg-white dark:bg-slate-900 ring-1 ring-border/50 shadow-2xl rounded-2xl z-[100]")}>
      {/* ─── Teacher Card — Always Prominent ─── */}
      {teacherAgent && (
        <div className="relative group/teacher overflow-hidden p-4 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50/50 dark:from-blue-950/20 dark:to-slate-800/40 border border-blue-200/50 dark:border-blue-900/30 transition-all hover:shadow-lg">
          <div className="flex items-center gap-4 relative z-10">
            <div className="size-16 rounded-2xl overflow-hidden ring-4 ring-white dark:ring-slate-800 shadow-xl shrink-0 transition-transform group-hover/teacher:scale-105">
              <img src={teacherAgent.avatar} alt={getDisplayName(teacherAgent.id, teacherAgent.name)} className="size-full object-cover" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <h4 className="text-[17px] font-bold text-slate-900 dark:text-white tracking-tight truncate">
                  {getDisplayName(teacherAgent.id, teacherAgent.name)}
                </h4>
                <RoleBadge role="teacher" />
                {canRenameAgents && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameTarget({ id: teacherAgent.id, baseName: teacherAgent.name });
                    }}
                    className="size-6 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-700/50 opacity-0 group-hover/teacher:opacity-100 transition-opacity"
                    aria-label={t('agent.editName')}
                    title={t('agent.editName')}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-normal line-clamp-2">
                {t('settings.agentRoles.teacherShortDesc')}
              </p>
              {showVoice && (
                <div className="mt-1">
                  <TeacherVoicePill availableProviders={availableProviders} disabled={!ttsEnabled} />
                </div>
              )}
            </div>
          </div>
          {/* Subtle background icon */}
          <GraduationCap className="absolute -right-4 -bottom-4 size-24 text-blue-500/5 dark:text-blue-400/5 rotate-12" />
        </div>
      )}

      {/* ─── Mode Selection Tabs ─── */}
      <div className="flex p-1 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-border/40">
        <button
          onClick={() => handleModeChange('preset')}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 text-[12px] font-bold rounded-lg transition-all",
            agentMode === 'preset' ? "bg-white dark:bg-slate-700 text-primary shadow-sm ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Users className="size-3.5" />
          {t('settings.agentModePreset') || 'Preset'}
        </button>
        <button
          onClick={() => handleModeChange('auto')}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 text-[12px] font-bold rounded-lg transition-all",
            agentMode === 'auto' ? "bg-white dark:bg-slate-700 text-primary shadow-sm ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Sparkles className="size-3.5" />
          {t('settings.agentModeAuto') || 'Auto'}
        </button>
      </div>

      {/* ─── Roles Container ─── */}
      <div className="flex flex-col gap-2 min-h-[160px]">
        {agentMode === 'preset' ? (
          <div className="grid grid-cols-1 gap-2 max-h-[360px] overflow-y-auto px-0.5 py-0.5 custom-scrollbar">
            {otherAgents.map((agent, idx) => {
              const isSelected = selectedAgentIds.includes(agent.id);
              return (
                <div
                  key={agent.id}
                  onClick={() => toggleAgent(agent.id)}
                  className={cn(
                    "group flex flex-col gap-2 p-2.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden",
                    isSelected
                      ? "bg-white dark:bg-slate-800 border-primary/40 shadow-md ring-1 ring-primary/10"
                      : "bg-slate-50/50 dark:bg-transparent border-transparent hover:bg-white dark:hover:bg-slate-800/50 hover:border-border/60"
                  )}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="size-10 rounded-xl overflow-hidden shadow-sm shrink-0 ring-1 ring-border/20 mt-0.5">
                      <img src={agent.avatar} alt={getDisplayName(agent.id, agent.name)} className="size-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-0.5">
                        <span
                          className={cn(
                            'text-[13px] font-bold min-w-0 break-words [overflow-wrap:anywhere]',
                            isSelected ? 'text-primary' : 'text-foreground',
                          )}
                        >
                          {getDisplayName(agent.id, agent.name)}
                        </span>
                        <RoleBadge role={agent.role} />
                        {canRenameAgents && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenameTarget({ id: agent.id, baseName: agent.name });
                            }}
                            className="size-5 inline-flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label={t('agent.editName')}
                            title={t('agent.editName')}
                          >
                            <Pencil className="size-3" />
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-2 italic leading-snug">
                        {agent.role === 'assistant' ? t('settings.agentRoles.assistantShortDesc') : t('settings.agentRoles.studentShortDesc')}
                      </p>
                    </div>
                    <Checkbox
                      checked={isSelected}
                      className={cn(
                        'pointer-events-none rounded-md shrink-0 border-2 mt-0.5',
                        !isSelected && 'opacity-20',
                      )}
                    />
                  </div>
                  {isSelected && (
                    <div className="flex justify-end min-w-0 pl-[52px]">
                      <motion.div
                        initial={{ scale: 0.96, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="min-w-0 max-w-full"
                      >
                        <AgentVoicePill
                          agent={agent}
                          agentIndex={idx + 1}
                          availableProviders={availableProviders}
                          disabled={!ttsEnabled}
                        />
                      </motion.div>
                    </div>
                  )}
                  {/* Active highlight bar */}
                  {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-full my-3" />}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center rounded-2xl border border-dashed border-violet-200 dark:border-violet-900/30 bg-violet-50/20 dark:bg-violet-950/10">
            <div className="relative mb-4">
              <div className="absolute inset-0 bg-violet-400/20 rounded-full animate-ping [animation-duration:3s]" />
              <div className="relative size-12 flex items-center justify-center bg-violet-500 rounded-2xl shadow-lg shadow-violet-500/20">
                <Shuffle className="size-6 text-white" />
              </div>
            </div>
            <h5 className="text-[14px] font-bold text-violet-600 dark:text-violet-400 mb-1 flex items-center justify-center gap-2">
              <Sparkles className="size-3.5" /> {t('agentBar.smartModeOn')}
            </h5>
            <p className="text-[11px] text-muted-foreground/80 leading-relaxed max-w-[240px]">
              {t('agentBar.smartModeDesc')}
            </p>
            <div className="mt-4 px-3 py-1.5 rounded-full bg-violet-500/5 border border-violet-500/10 text-[10px] text-violet-500 font-bold uppercase tracking-widest">
              Dynamic orchestration
            </div>
          </div>
        )}
      </div>
      {renameTarget && (
        <AgentRenameDialog
          open={!!renameTarget}
          onOpenChange={(o) => {
            if (!o) setRenameTarget(null);
          }}
          agentId={renameTarget.id}
          baseName={renameTarget.baseName}
        />
      )}
    </div>
  );

  if (inline) return contentNode;

  return (
    <div ref={containerRef} className="relative inline-block">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setOpen(!open)}
            className={cn(
              "group flex items-center gap-2.5 px-3 py-1.5 rounded-full transition-all border shadow-sm h-10",
              open
                ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent shadow-xl"
                : "bg-white dark:bg-slate-800 border-border/50 hover:border-primary/40 hover:bg-slate-50 dark:hover:bg-slate-700/50"
            )}
          >
            <div className="size-7 rounded-full overflow-hidden shrink-0 border border-border/20 shadow-inner">
               <img src={teacherAgent?.avatar} alt="" className="size-full object-cover" />
            </div>
            <div className="hidden sm:flex flex-col items-start leading-tight min-w-[70px]">
             <span className="text-[11px] font-bold truncate">
               {open ? t('agentBar.settingUp') : (teacherAgent ? getDisplayName(teacherAgent.id, teacherAgent.name) : t('agentBar.teacherSettings'))}
             </span>
             <span className={cn("text-[9px] font-medium opacity-60", !open && "text-primary/80")}>
               {agentMode === 'auto' ? t('agentBar.autoOrchestrating') : t('agentBar.rolesSelected', { count: selectedAgentIds.length })}
             </span>
            </div>
            <div className={cn("size-6 rounded-full flex items-center justify-center transition-transform duration-300 bg-slate-100 dark:bg-slate-800 group-hover:bg-slate-200 dark:group-hover:bg-slate-700", open && "rotate-180 bg-white/20 dark:bg-slate-900/10")}>
               <ChevronDown className="size-3.5" />
            </div>
          </button>
        </TooltipTrigger>
        {!open && <TooltipContent side="bottom" sideOffset={8}>{t('agentBar.configTooltip')}</TooltipContent>}
      </Tooltip>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 mt-3 z-[100]"
          >
            {contentNode}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
