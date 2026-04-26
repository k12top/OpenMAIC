'use client';

import { useState, useRef, useMemo } from 'react';
import { Bot, Check, ChevronLeft, ChevronDown, Globe, Paperclip, FileText, X, Globe2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import type { PDFProviderId } from '@/lib/pdf/types';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import type { WebSearchProviderId } from '@/lib/web-search/types';
import type { ProviderId } from '@/lib/ai/providers';
import type { SettingsSection } from '@/lib/types/settings';
import { MediaPopover } from '@/components/generation/media-popover';

// ─── Constants ───────────────────────────────────────────────
const MAX_PDF_SIZE_MB = 50;
const MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024;

// ─── Supported Course Languages ──────────────────────────────
const COURSE_LANGUAGES = [
  { code: 'zh-CN', label: '中文', flag: '🇨🇳' },
  { code: 'en-US', label: 'English', flag: '🇺🇸' },
  { code: 'ja-JP', label: '日本語', flag: '🇯🇵' },
  { code: 'ko-KR', label: '한국어', flag: '🇰🇷' },
  { code: 'fr-FR', label: 'Français', flag: '🇫🇷' },
  { code: 'de-DE', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es-ES', label: 'Español', flag: '🇪🇸' },
  { code: 'pt-BR', label: 'Português', flag: '🇧🇷' },
  { code: 'ru-RU', label: 'Русский', flag: '🇷🇺' },
  { code: 'ar-SA', label: 'العربية', flag: '🇸🇦' },
] as const;

// ─── Types ───────────────────────────────────────────────────
export interface GenerationToolbarProps {
  language: string;
  onLanguageChange: (lang: string) => void;
  webSearch: boolean;
  onWebSearchChange: (v: boolean) => void;
  onSettingsOpen: (section?: SettingsSection) => void;
  // PDF
  pdfFile: File | null;
  onPdfFileChange: (file: File | null) => void;
  onPdfError: (error: string | null) => void;
  // Layout mode handling
  layoutMode?: 'left' | 'bottom' | 'all';
}

// ─── Component ───────────────────────────────────────────────
export function GenerationToolbar({
  language,
  onLanguageChange,
  webSearch,
  onWebSearchChange,
  onSettingsOpen,
  pdfFile,
  onPdfFileChange,
  onPdfError,
  layoutMode = 'all',
}: GenerationToolbarProps) {
  const { t } = useI18n();
  const currentProviderId = useSettingsStore((s) => s.providerId);
  const currentModelId = useSettingsStore((s) => s.modelId);
  const providersConfig = useSettingsStore((s) => s.providersConfig);
  const setModel = useSettingsStore((s) => s.setModel);
  const pdfProviderId = useSettingsStore((s) => s.pdfProviderId);
  const pdfProvidersConfig = useSettingsStore((s) => s.pdfProvidersConfig);
  const setPDFProvider = useSettingsStore((s) => s.setPDFProvider);
  const webSearchProviderId = useSettingsStore((s) => s.webSearchProviderId);
  const webSearchProvidersConfig = useSettingsStore((s) => s.webSearchProvidersConfig);
  const setWebSearchProvider = useSettingsStore((s) => s.setWebSearchProvider);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Check if the selected web search provider has a valid config (API key or server-configured)
  const webSearchProvider = WEB_SEARCH_PROVIDERS[webSearchProviderId];
  const webSearchConfig = webSearchProvidersConfig[webSearchProviderId];
  const webSearchAvailable = webSearchProvider
    ? !webSearchProvider.requiresApiKey ||
      !!webSearchConfig?.apiKey ||
      !!webSearchConfig?.isServerConfigured
    : false;

  // Configured LLM providers (only those with valid credentials + models + endpoint)
  const configuredProviders = providersConfig
    ? Object.entries(providersConfig)
        .filter(
          ([, config]) =>
            (!config.requiresApiKey || config.apiKey || config.isServerConfigured) &&
            config.models.length >= 1 &&
            (config.baseUrl || config.defaultBaseUrl || config.serverBaseUrl),
        )
        .map(([id, config]) => ({
          id: id as ProviderId,
          name: config.name,
          icon: config.icon,
          isServerConfigured: config.isServerConfigured,
          models:
            config.isServerConfigured && !config.apiKey && config.serverModels?.length
              ? config.models.filter((m) => new Set(config.serverModels).has(m.id))
              : config.models,
        }))
    : [];

  const currentProviderConfig = providersConfig?.[currentProviderId];

  // PDF / Document handler
  const handleFileSelect = (file: File) => {
    const validTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ];
    
    // Also check extensions as a fallback if mime type is missing
    const validExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx'];
    const hasValidExtension = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

    if (!validTypes.includes(file.type) && !hasValidExtension) {
      onPdfError(t('upload.invalidFileType'));
      return;
    }
    
    if (file.size > MAX_PDF_SIZE_BYTES) {
      onPdfError(t('upload.fileTooLarge'));
      return;
    }
    onPdfError(null);
    onPdfFileChange(file);
  };

  // ─── Pill button helper ─────────────────────────────
  const pillCls =
    'inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer select-none whitespace-nowrap bg-white dark:bg-slate-800 shadow-sm hover:shadow-md';
  const pillMuted = `${pillCls} border border-border/60 text-muted-foreground/80 hover:text-foreground hover:bg-slate-50 dark:hover:bg-slate-700/50`;
  const pillActive = `${pillCls} border border-violet-500/50 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 ring-4 ring-violet-500/10`;

  return (
    <div className={cn("flex items-center gap-2", layoutMode === 'bottom' && "gap-3")}>
      {/* Model selector (All only — not in left sidebar) */}
      {layoutMode === 'all' && (configuredProviders.length > 0 ? (
        <ModelSelectorPopover
          configuredProviders={configuredProviders}
          currentProviderId={currentProviderId}
          currentModelId={currentModelId}
          currentProviderConfig={currentProviderConfig}
          setModel={setModel}
          t={t}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onSettingsOpen('providers')}
              className={cn(
                pillCls,
                'text-amber-600 dark:text-amber-400 animate-pulse',
                'bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50',
              )}
            >
              <Bot className="size-3.5" />
              <span>{t('toolbar.configureProvider')}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('toolbar.configureProviderHint')}</TooltipContent>
        </Tooltip>
      ))}

      {/* Language selector (Left / All) */}
      {(layoutMode === 'all' || layoutMode === 'left') && (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    pillCls,
                    'bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-border/30 px-2.5 flex items-center gap-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all group'
                  )}
                >
                  <span className="size-5 rounded flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-xs shrink-0">
                    {COURSE_LANGUAGES.find((l) => l.code === language)?.flag || '🌐'}
                  </span>
                  <span className="truncate flex-1 text-left font-bold">
                    {COURSE_LANGUAGES.find((l) => l.code === language)?.label || language}
                  </span>
                  <ChevronDown className="size-3 opacity-40 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('toolbar.languageHint')}</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" sideOffset={8} className="w-56 p-2 rounded-xl border-border/80 shadow-2xl">
            <div className="max-h-64 overflow-y-auto pr-1 custom-scrollbar flex flex-col gap-1">
              {COURSE_LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => onLanguageChange(lang.code)}
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm rounded-lg transition-all flex items-center gap-3',
                    language === lang.code
                      ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/20'
                      : 'hover:bg-muted text-foreground',
                  )}
                >
                  <span className="size-6 rounded-md bg-white/10 flex items-center justify-center text-sm shadow-inner shrink-0">
                    {lang.flag}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">{lang.label}</div>
                    <div className={cn("text-[10px] uppercase tracking-widest opacity-60", language === lang.code ? "text-white/80" : "text-muted-foreground")}>
                      {lang.code}
                    </div>
                  </div>
                  {language === lang.code && <Check className="size-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Model selector (Bottom only) */}
      {layoutMode === 'bottom' && (configuredProviders.length > 0 ? (
        <ModelSelectorPopover
          configuredProviders={configuredProviders}
          currentProviderId={currentProviderId}
          currentModelId={currentModelId}
          currentProviderConfig={currentProviderConfig}
          setModel={setModel}
          t={t}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onSettingsOpen('providers')}
              className={cn(
                pillCls,
                'text-amber-600 dark:text-amber-400 animate-pulse',
                'bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50',
              )}
            >
              <Bot className="size-3.5" />
              <span>{t('toolbar.configureProvider')}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('toolbar.configureProviderHint')}</TooltipContent>
        </Tooltip>
      ))}

      {/* PDF / Document upload simple button (Bottom / All) */}
      {(layoutMode === 'all' || layoutMode === 'bottom') && (
        <>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".pdf,.doc,.docx,.ppt,.pptx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
              e.target.value = '';
            }}
          />
          {pdfFile ? (
            <button className={pillActive} onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="size-3.5" />
              <span className="max-w-[100px] truncate">{pdfFile.name}</span>
              <span
                role="button"
                className="size-4 rounded-full inline-flex items-center justify-center hover:bg-violet-200 dark:hover:bg-violet-800 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onPdfFileChange(null);
                }}
              >
                <X className="size-2.5" />
              </span>
            </button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button className={pillMuted} onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('toolbar.pdfUpload')}</TooltipContent>
            </Tooltip>
          )}
        </>
      )}

      {/* Web Search simple toggle (Bottom / All) */}
      {(layoutMode === 'all' || layoutMode === 'bottom') && webSearchAvailable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={webSearch ? pillActive : pillMuted}
              onClick={() => onWebSearchChange(!webSearch)}
            >
              <Globe2 className={cn('size-3.5', webSearch && 'animate-pulse')} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {webSearch ? t('toolbar.webSearchOn') : t('toolbar.webSearchOff')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ─── ModelSelectorPopover (two-level: provider → model) ─────
export interface ConfiguredProvider {
  id: ProviderId;
  name: string;
  icon?: string;
  isServerConfigured?: boolean;
  models: { id: string; name: string }[];
}

export function ModelSelectorPopover({
  configuredProviders,
  currentProviderId,
  currentModelId,
  currentProviderConfig,
  setModel,
  t,
}: {
  configuredProviders: ConfiguredProvider[];
  currentProviderId: ProviderId;
  currentModelId: string;
  currentProviderConfig: { name: string; icon?: string } | undefined;
  setModel: (providerId: ProviderId, modelId: string) => void;
  t: (key: string) => string;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  // null = provider list, ProviderId = model list for that provider
  const [drillProvider, setDrillProvider] = useState<ProviderId | null>(null);

  const activeProvider = useMemo(
    () => configuredProviders.find((p) => p.id === drillProvider),
    [configuredProviders, drillProvider],
  );

  return (
    <Popover
      open={popoverOpen}
      onOpenChange={(open) => {
        setPopoverOpen(open);
        if (open) setDrillProvider(null);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'inline-flex items-center justify-center size-7 rounded-full transition-all cursor-pointer select-none',
                'ring-1 ring-border/60 hover:ring-border hover:bg-muted/60',
                currentModelId &&
                  'ring-violet-300 dark:ring-violet-700 bg-violet-50 dark:bg-violet-950/20',
              )}
            >
              {currentProviderConfig?.icon ? (
                <img
                  src={currentProviderConfig.icon}
                  alt={currentProviderConfig.name}
                  className="size-4 rounded-sm"
                />
              ) : (
                <Bot className="size-3.5 text-muted-foreground" />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {currentModelId
            ? `${currentProviderConfig?.name || currentProviderId} / ${currentModelId}`
            : t('settings.selectModel')}
        </TooltipContent>
      </Tooltip>

      <PopoverContent align="start" className="w-64 p-0">
        {/* Level 1: Provider list */}
        {!drillProvider && (
          <div className="max-h-72 overflow-y-auto">
            <div className="px-3 py-2 border-b">
              <span className="text-xs font-semibold text-muted-foreground">
                {t('toolbar.selectProvider')}
              </span>
            </div>
            {configuredProviders.map((provider) => {
              const isActive = currentProviderId === provider.id;
              return (
                <button
                  key={provider.id}
                  onClick={() => setDrillProvider(provider.id)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-border/30',
                    isActive ? 'bg-violet-50/50 dark:bg-violet-950/10' : 'hover:bg-muted/50',
                  )}
                >
                  {provider.icon ? (
                    <img
                      src={provider.icon}
                      alt={provider.name}
                      className="size-5 rounded-sm shrink-0"
                    />
                  ) : (
                    <Bot className="size-5 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{provider.name}</span>
                    {provider.isServerConfigured && (
                      <span className="text-[9px] px-1 py-0 rounded border text-muted-foreground ml-1.5">
                        {t('settings.serverConfigured')}
                      </span>
                    )}
                  </div>
                  {isActive && currentModelId && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                      {currentModelId}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Level 2: Model list for selected provider */}
        {drillProvider && activeProvider && (
          <div className="max-h-72 overflow-y-auto">
            {/* Back header */}
            <button
              onClick={() => setDrillProvider(null)}
              className="w-full flex items-center gap-2 px-3 py-2 border-b bg-muted/40 hover:bg-muted/60 transition-colors"
            >
              <ChevronLeft className="size-3.5 text-muted-foreground" />
              {activeProvider.icon ? (
                <img
                  src={activeProvider.icon}
                  alt={activeProvider.name}
                  className="size-4 rounded-sm"
                />
              ) : (
                <Bot className="size-4 text-muted-foreground" />
              )}
              <span className="text-xs font-semibold">{activeProvider.name}</span>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {activeProvider.models.length} {t('settings.modelCount')}
              </span>
            </button>
            {/* Models */}
            {activeProvider.models.map((model) => {
              const isSelected = currentProviderId === drillProvider && currentModelId === model.id;
              return (
                <button
                  key={model.id}
                  onClick={() => {
                    setModel(drillProvider, model.id);
                    setPopoverOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors border-b border-border/30',
                    isSelected
                      ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <span className="flex-1 truncate font-mono text-xs">{model.name}</span>
                  {isSelected && (
                    <Check className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
