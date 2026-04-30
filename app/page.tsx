'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Coins,
  Copy,
  ImagePlus,
  Pencil,
  Trash2,
  Settings,
  Sun,
  Moon,
  Monitor,
  BotOff,
  ChevronUp,
  LogIn,
  LogOut,
  Volume2,
  CheckCircle2,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { LanguageSwitcher } from '@/components/language-switcher';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { Textarea as UITextarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SettingsDialog } from '@/components/settings';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { AgentBar } from '@/components/agent/agent-bar';
import { useTheme } from '@/lib/hooks/use-theme';
import { nanoid } from 'nanoid';
import { storePdfBlob } from '@/lib/utils/image-storage';
import type { UserRequirements } from '@/lib/types/generation';
import { useSettingsStore } from '@/lib/store/settings';
import { useUserProfileStore, AVATAR_OPTIONS } from '@/lib/store/user-profile';
import {
  StageListItem,
  listStages,
  deleteStageData,
  renameStage,
  getFirstSlideByStages,
} from '@/lib/utils/stage-storage';
import { ThumbnailSlide } from '@/components/slide-renderer/components/ThumbnailSlide';
import type { Slide } from '@/lib/types/slides';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDraftCache } from '@/lib/hooks/use-draft-cache';
import { SpeechButton } from '@/components/audio/speech-button';
import { LandingPage } from '@/components/landing/landing-page';
import { Can } from '@/components/auth/can';
import { BRAND_NAME } from '@/lib/constants/brand';

const log = createLogger('Home');

const WEB_SEARCH_STORAGE_KEY = 'webSearchEnabled';
const OUTLINE_CONFIRM_STORAGE_KEY = 'outlineConfirmEnabled';
const LANGUAGE_STORAGE_KEY = 'generationLanguage';
const RECENT_OPEN_STORAGE_KEY = 'recentClassroomsOpen';

interface FormState {
  pdfFile: File | null;
  requirement: string;
  language: string;
  webSearch: boolean;
  outlineConfirm: boolean;
}

const initialFormState: FormState = {
  pdfFile: null,
  requirement: '',
  language: 'zh-CN',
  webSearch: false,
  outlineConfirm: true,
};

function HomePage() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { nickname } = useUserProfileStore();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialFormState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    import('@/lib/types/settings').SettingsSection | undefined
  >(undefined);

  // Draft cache for requirement text
  const { cachedValue: cachedRequirement, updateCache: updateRequirementCache } =
    useDraftCache<string>({ key: 'requirementDraft' });

  // Model setup state
  const currentModelId = useSettingsStore((s) => s.modelId);
  const [recentOpen, setRecentOpen] = useState(true);

  // Credits
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [creditsUnlimited, setCreditsUnlimited] = useState(false);

  useEffect(() => {
    fetch('/api/credits')
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        if (data.unlimited) {
          setCreditsUnlimited(true);
          setCreditBalance(-1);
        } else if (data.balance !== undefined) {
          setCreditBalance(data.balance);
        }
      })
      .catch(() => {});
  }, []);

  // Hydrate client-only state after mount (avoids SSR mismatch)
  /* eslint-disable react-hooks/set-state-in-effect -- Hydration from localStorage must happen in effect */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_OPEN_STORAGE_KEY);
      if (saved !== null) setRecentOpen(saved !== 'false');
    } catch {
      /* localStorage unavailable */
    }
    try {
      const savedWebSearch = localStorage.getItem(WEB_SEARCH_STORAGE_KEY);
      const savedOutlineConfirm = localStorage.getItem(OUTLINE_CONFIRM_STORAGE_KEY);
      const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      const updates: Partial<FormState> = {};
      if (savedWebSearch === 'true') updates.webSearch = true;
      // Outline confirm: per-task value falls back to global persisted setting (default true).
      if (savedOutlineConfirm !== null) {
        updates.outlineConfirm = savedOutlineConfirm !== 'false';
      } else {
        updates.outlineConfirm = useSettingsStore.getState().outlineConfirmEnabled ?? true;
      }
      if (savedLanguage) {
        updates.language = savedLanguage;
      } else {
        // Auto-detect from browser language
        const browserLang = navigator.language || 'en-US';
        updates.language = browserLang;
      }
      if (Object.keys(updates).length > 0) {
        setForm((prev) => ({ ...prev, ...updates }));
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Restore requirement draft from cache (derived state pattern — no effect needed)
  const [prevCachedRequirement, setPrevCachedRequirement] = useState(cachedRequirement);
  if (cachedRequirement !== prevCachedRequirement) {
    setPrevCachedRequirement(cachedRequirement);
    if (cachedRequirement) {
      setForm((prev) => ({ ...prev, requirement: cachedRequirement }));
    }
  }

  const [themeOpen, setThemeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<StageListItem[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, Slide>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!themeOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [themeOpen]);

  const loadClassrooms = async () => {
    try {
      const list = await listStages();
      setClassrooms(list);
      // Load first slide thumbnails
      if (list.length > 0) {
        const slides = await getFirstSlideByStages(list.map((c) => c.id));
        setThumbnails(slides);
      }
    } catch (err) {
      log.error('Failed to load classrooms:', err);
    }
  };

  useEffect(() => {
    // Clear stale media store to prevent cross-course thumbnail contamination.
    // The store may hold tasks from a previously visited classroom whose elementIds
    // (gen_img_1, etc.) collide with other courses' placeholders.
    useMediaGenerationStore.getState().revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Store hydration on mount
    loadClassrooms();
  }, []);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  };

  const confirmDelete = async (id: string) => {
    setPendingDeleteId(null);
    try {
      await deleteStageData(id);
      await loadClassrooms();
    } catch (err) {
      log.error('Failed to delete classroom:', err);
      toast.error('Failed to delete classroom');
    }
  };

  const handleRename = async (id: string, newName: string) => {
    try {
      await renameStage(id, newName);
      setClassrooms((prev) => prev.map((c) => (c.id === id ? { ...c, name: newName } : c)));
    } catch (err) {
      log.error('Failed to rename classroom:', err);
      toast.error(t('classroom.renameFailed'));
    }
  };

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    try {
      if (field === 'webSearch') localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(value));
      if (field === 'outlineConfirm')
        localStorage.setItem(OUTLINE_CONFIRM_STORAGE_KEY, String(value));
      if (field === 'language') localStorage.setItem(LANGUAGE_STORAGE_KEY, String(value));
      if (field === 'requirement') updateRequirementCache(value as string);
    } catch {
      /* ignore */
    }
  };

  const showSetupToast = (icon: React.ReactNode, title: string, desc: string) => {
    toast.custom(
      (id) => (
        <div
          className="w-[356px] rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-gradient-to-r from-amber-50 via-white to-amber-50 dark:from-amber-950/60 dark:via-slate-900 dark:to-amber-950/60 shadow-lg shadow-amber-500/8 dark:shadow-amber-900/20 p-4 flex items-start gap-3 cursor-pointer"
          onClick={() => {
            toast.dismiss(id);
            setSettingsOpen(true);
          }}
        >
          <div className="shrink-0 mt-0.5 size-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center ring-1 ring-amber-200/50 dark:ring-amber-800/30">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 leading-tight">
              {title}
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/70 mt-0.5 leading-relaxed">
              {desc}
            </p>
          </div>
          <div className="shrink-0 mt-1 text-[10px] font-medium text-amber-500 dark:text-amber-500/70 tracking-wide">
            <Settings className="size-3.5 animate-[spin_3s_linear_infinite]" />
          </div>
        </div>
      ),
      { duration: 4000 },
    );
  };

  const handleGenerate = async () => {
    // Validate setup before proceeding
    if (!currentModelId) {
      showSetupToast(
        <BotOff className="size-4.5 text-amber-600 dark:text-amber-400" />,
        t('settings.modelNotConfigured'),
        t('settings.setupNeeded'),
      );
      setSettingsOpen(true);
      return;
    }

    if (!form.requirement.trim()) {
      setError(t('upload.requirementRequired'));
      return;
    }

    setError(null);

    try {
      const userProfile = useUserProfileStore.getState();
      const requirements: UserRequirements = {
        requirement: form.requirement,
        language: form.language,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        webSearch: form.webSearch || undefined,
      };

      let pdfStorageKey: string | undefined;
      let pdfFileName: string | undefined;
      let pdfProviderId: string | undefined;
      let pdfProviderConfig: { apiKey?: string; baseUrl?: string } | undefined;

      if (form.pdfFile) {
        pdfStorageKey = await storePdfBlob(form.pdfFile);
        pdfFileName = form.pdfFile.name;

        const settings = useSettingsStore.getState();
        pdfProviderId = settings.pdfProviderId;
        const providerCfg = settings.pdfProvidersConfig?.[settings.pdfProviderId];
        if (providerCfg) {
          pdfProviderConfig = {
            apiKey: providerCfg.apiKey,
            baseUrl: providerCfg.baseUrl,
          };
        }
      }

      const sessionState = {
        sessionId: nanoid(),
        requirements,
        pdfText: '',
        pdfImages: [],
        imageStorageIds: [],
        pdfStorageKey,
        pdfFileName,
        pdfProviderId,
        pdfProviderConfig,
        sceneOutlines: null,
        currentStep: 'generating' as const,
        outlineConfirmEnabled: form.outlineConfirm,
      };
      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));

      router.push('/generation-preview');
    } catch (err) {
      log.error('Error preparing generation:', err);
      setError(err instanceof Error ? err.message : t('upload.generateFailed'));
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('classroom.today');
    if (diffDays === 1) return t('classroom.yesterday');
    if (diffDays < 7) return `${diffDays} ${t('classroom.daysAgo')}`;
    return date.toLocaleDateString();
  };

  const canGenerate = !!form.requirement.trim();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canGenerate) handleGenerate();
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 flex flex-col md:flex-row overflow-hidden relative">
      {/* ═══ Background Decor ═══ */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[800px] h-[800px] bg-purple-500/5 rounded-full blur-3xl block" />
      </div>

      {/* ═══ Top-right pill ═══ */}
      <div
        ref={toolbarRef}
        className="fixed top-4 right-6 z-50 flex items-center gap-1 bg-white/60 dark:bg-gray-800/60 backdrop-blur-md px-2 py-1.5 rounded-full border border-gray-100/50 dark:border-gray-700/50 shadow-sm"
      >
        <LanguageSwitcher onOpen={() => setThemeOpen(false)} />
        <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700" />
        <div className="relative">
          <button
            onClick={() => setThemeOpen(!themeOpen)}
            className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all"
          >
            {theme === 'light' && <Sun className="w-4 h-4" />}
            {theme === 'dark' && <Moon className="w-4 h-4" />}
            {theme === 'system' && <Monitor className="w-4 h-4" />}
          </button>
          {themeOpen && (
            <div className="absolute top-full mt-2 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-50 min-w-[140px]">
              <button
                onClick={() => {
                  setTheme('light');
                  setThemeOpen(false);
                }}
                className={cn(
                  'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                  theme === 'light' &&
                    'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                )}
              >
                <Sun className="w-4 h-4" />
                {t('settings.themeOptions.light')}
              </button>
              <button
                onClick={() => {
                  setTheme('dark');
                  setThemeOpen(false);
                }}
                className={cn(
                  'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                  theme === 'dark' &&
                    'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                )}
              >
                <Moon className="w-4 h-4" />
                {t('settings.themeOptions.dark')}
              </button>
              <button
                onClick={() => {
                  setTheme('system');
                  setThemeOpen(false);
                }}
                className={cn(
                  'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                  theme === 'system' &&
                    'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                )}
              >
                <Monitor className="w-4 h-4" />
                {t('settings.themeOptions.system')}
              </button>
            </div>
          )}
        </div>
        {creditBalance !== null && (
          <>
            <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700" />
            <button
              onClick={() => router.push('/credits')}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors',
                creditsUnlimited
                  ? 'text-green-700 dark:text-green-300 bg-green-50/80 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-900/40'
                  : creditBalance <= 10
                    ? 'text-red-700 dark:text-red-300 bg-red-50/80 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40'
                    : 'text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40',
              )}
              title="Credits"
            >
              <Coins className="size-3" />
              <span className="tabular-nums">{creditsUnlimited ? '∞' : creditBalance}</span>
            </button>
          </>
        )}
      </div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsSection(undefined);
        }}
        initialSection={settingsSection}
      />

      {/* ═══ Left Configuration Sidebar ═══ */}
      <div className="w-full md:w-[320px] lg:w-[380px] shrink-0 h-auto md:h-full flex flex-col bg-white dark:bg-slate-900 border-r border-border/40 z-10 relative overflow-y-auto hidden-scrollbar shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        <div className="p-6 md:p-8 flex flex-col min-h-full">
          {/* Brand + Profile */}
          <div className="mb-8 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 overflow-hidden">
                <img
                  src="/logos/xiangyu-logo.png"
                  alt={BRAND_NAME}
                  className="size-full object-cover scale-110"
                />
              </div>
              <div className="flex flex-col">
                <h1 className="text-lg font-black tracking-tight text-slate-900 dark:text-white leading-tight uppercase select-none">
                  {BRAND_NAME}
                </h1>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6 flex-1">
            {/* Language Section */}
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('generation.outputLanguage')}
              </h3>
              <GenerationToolbar
                layoutMode="left"
                language={form.language}
                onLanguageChange={(lang) => updateForm('language', lang)}
                webSearch={form.webSearch}
                onWebSearchChange={(v) => updateForm('webSearch', v)}
                outlineConfirm={form.outlineConfirm}
                onOutlineConfirmChange={(v) => updateForm('outlineConfirm', v)}
                onSettingsOpen={(section) => {
                  setSettingsSection(section);
                  setSettingsOpen(true);
                }}
                pdfFile={form.pdfFile}
                onPdfFileChange={(f) => updateForm('pdfFile', f)}
                onPdfError={setError}
              />
            </div>

            {/* Roles Section */}
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('generation.classroomRoles')}
              </h3>
              <div className="p-3 rounded-xl border border-border/60 bg-slate-50/50 dark:bg-slate-800/50">
                <AgentBar inline={true} />
              </div>
            </div>
          </div>

          {/* Footer with Logout */}
          <SidebarFooter />
        </div>
      </div>

      {/* ═══ Right Main Workspace Panel (70%) ═══ */}
      <div className="flex-1 h-full overflow-y-auto bg-slate-50/40 dark:bg-slate-950/40 z-10 relative scrollbar-hide flex flex-col">
        <div className="w-full max-w-5xl mx-auto px-4 py-8 md:px-10 md:py-12 flex flex-col gap-10 flex-1">
          {/* Main Prompt Card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="w-full relative shadow-sm"
          >
            <div className="relative z-20 flex items-center justify-between mb-4 h-12">
              <div className="flex flex-col gap-0.5 animate-in fade-in slide-in-from-left-2 duration-700">
                <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-none">
                  {t('home.greetingWithName', { name: nickname || t('profile.defaultNickname') })}
                </h2>
              </div>
            </div>

            <div className="w-full rounded-2xl border border-slate-200 dark:border-border/80 bg-white dark:bg-slate-900 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-black/20 focus-within:shadow-violet-500/[0.08] focus-within:border-violet-500/40 transition-all duration-300 overflow-hidden flex flex-col">
              <textarea
                ref={textareaRef}
                placeholder={t('upload.requirementPlaceholder')}
                className="w-full resize-none border-0 bg-transparent px-6 py-6 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:outline-none min-h-[160px] md:min-h-[200px]"
                value={form.requirement}
                onChange={(e) => updateForm('requirement', e.target.value)}
                onKeyDown={handleKeyDown}
              />

              <div className="px-6 pb-4 pt-4 flex items-center justify-between border-t border-border/30 bg-slate-50/50 dark:bg-slate-900/50">
                <div className="flex items-center gap-3">
                  <SpeechButton
                    size="md"
                    onTranscription={(text) => {
                      setForm((prev) => {
                        const next = prev.requirement + (prev.requirement ? ' ' : '') + text;
                        updateRequirementCache(next);
                        return { ...prev, requirement: next };
                      });
                    }}
                  />
                  <div className="h-6 w-px bg-border/60" />
                  <GenerationToolbar
                    layoutMode="bottom"
                    language={form.language}
                    onLanguageChange={(lang) => updateForm('language', lang)}
                    webSearch={form.webSearch}
                    onWebSearchChange={(v) => updateForm('webSearch', v)}
                    outlineConfirm={form.outlineConfirm}
                    onOutlineConfirmChange={(v) => updateForm('outlineConfirm', v)}
                    onSettingsOpen={(section) => {
                      setSettingsSection(section);
                      setSettingsOpen(true);
                    }}
                    pdfFile={form.pdfFile}
                    onPdfFileChange={(f) => updateForm('pdfFile', f)}
                    onPdfError={setError}
                  />
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className={cn(
                    'h-11 rounded-xl flex items-center justify-center gap-2 transition-all px-8 select-none',
                    canGenerate
                      ? 'bg-violet-600 text-white shadow-md shadow-violet-600/20 hover:bg-violet-700 hover:-translate-y-0.5 active:translate-y-0 text-sm font-bold tracking-wide'
                      : 'bg-muted text-muted-foreground/40 cursor-not-allowed text-sm font-bold',
                  )}
                >
                  <span>{t('toolbar.enterClassroom')}</span>
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -10, height: 0 }}
                  className="overflow-hidden mt-4"
                >
                  <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl">
                    <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          {/* Historic Library Section */}
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-foreground/80 flex items-center gap-2">
                <Clock className="size-4 text-violet-500" />
                {t('classroom.recentClassrooms')}
                <span className="ml-2 px-2 py-0.5 rounded-md bg-border/40 text-[10px] font-bold text-muted-foreground">
                  {classrooms.length}
                </span>
              </h2>
            </div>

            {classrooms.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
                {classrooms.map((classroom, i) => (
                  <motion.div
                    key={classroom.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(i * 0.04, 0.4),
                      duration: 0.4,
                    }}
                  >
                    <ClassroomCard
                      classroom={classroom}
                      slide={thumbnails[classroom.id]}
                      formatDate={formatDate}
                      onDelete={handleDelete}
                      onRename={handleRename}
                      confirmingDelete={pendingDeleteId === classroom.id}
                      onConfirmDelete={() => confirmDelete(classroom.id)}
                      onCancelDelete={() => setPendingDeleteId(null)}
                      onClick={() => router.push(`/classroom/${classroom.id}`)}
                    />
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="mt-8 flex flex-col items-center justify-center p-12 border border-dashed border-border/80 rounded-3xl text-center bg-white/40 dark:bg-slate-900/40">
                <div className="size-16 rounded-3xl bg-violet-100/50 dark:bg-violet-900/20 text-violet-500/50 flex items-center justify-center mb-4">
                  <BookOpen className="size-8" />
                </div>
                <h3 className="text-lg font-semibold text-foreground/80 mb-2">No Documents Yet</h3>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Use the prompt workspace above to generate your first interactive document!
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Greeting Bar — avatar + "Hi, Name", click to edit in-place ────
function GreetingBar({ isSidebar = false }: { isSidebar?: boolean } = {}) {
  const { t } = useI18n();
  const { nickname, bio, avatar, setNickname, setBio, setAvatar } = useUserProfileStore();
  const [editing, setEditing] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState(nickname);
  const [bioDraft, setBioDraft] = useState(bio);
  const [avatarDraft, setAvatarDraft] = useState(avatar);

  useEffect(() => {
    setNicknameDraft(nickname);
    setBioDraft(bio);
    setAvatarDraft(avatar);
  }, [nickname, bio, avatar]);

  const handleSave = () => {
    setNickname(nicknameDraft);
    setBio(bioDraft);
    setAvatar(avatarDraft);
    setEditing(false);
  };

  return (
    <div className={cn('flex items-center gap-3 transition-all', isSidebar ? 'w-full' : 'w-fit')}>
      {/* ── Avatar Dropdown ── */}
      <Popover>
        <PopoverTrigger asChild>
          <div
            className={cn(
              'relative group cursor-pointer shrink-0 transition-transform hover:scale-105 active:scale-95',
              isSidebar ? 'size-9' : 'size-11',
            )}
          >
            <div className="size-full rounded-2xl overflow-hidden ring-2 ring-white dark:ring-slate-800 shadow-xl">
              <img src={avatar} alt="Avatar" className="size-full object-cover" />
            </div>
            <div className="absolute -bottom-1 -right-1 size-5 bg-emerald-500 rounded-lg flex items-center justify-center border-2 border-white dark:border-slate-800 shadow-sm animate-in zoom-in duration-300">
              <CheckCircle2 className="size-3 text-white" />
            </div>
          </div>
        </PopoverTrigger>
        <PopoverContent
          align={isSidebar ? 'start' : 'center'}
          side={isSidebar ? 'right' : 'bottom'}
          sideOffset={12}
          className="w-56 p-1 rounded-2xl border-border/60 shadow-2xl"
        >
          <div className="p-2 flex flex-col gap-1">
            <div className="px-2 py-1.5 mb-1 pb-2 border-b border-border/30">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                {t('profile.title')}
              </p>
            </div>
            <button
              onClick={() => {
                setEditing(true);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-foreground/80 hover:text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"
            >
              <Pencil className="size-3.5" />
              {t('profile.editNickname')}
            </button>
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.reload();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-all"
            >
              <LogOut className="size-3.5" />
              {t('home.logout')}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* ── Nickname & Bio (Editable) ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div
          className="flex items-center gap-2 group cursor-pointer"
          onClick={() => setEditing(true)}
        >
          <h2
            className={cn(
              'font-black text-slate-900 dark:text-white tracking-tight leading-none truncate',
              isSidebar ? 'text-[14px]' : 'text-[17px]',
            )}
          >
            {nickname || t('profile.defaultNickname')}
          </h2>
          {!isSidebar && (
            <Pencil className="size-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
        <p
          className={cn(
            'text-muted-foreground leading-none truncate hover:text-foreground/80 transition-colors cursor-pointer',
            isSidebar ? 'text-[10px]' : 'text-[11px]',
          )}
          onClick={() => setEditing(true)}
        >
          {bio || t('profile.defaultBioDesc')}
        </p>
      </div>

      {/* ── Edit Modal ── */}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-[425px] rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">{t('profile.editProfile')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            {/* Avatar Selection */}
            <div className="grid gap-3">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t('profile.chooseAvatar')}
              </label>
              <div className="flex flex-wrap gap-3">
                {AVATAR_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setAvatarDraft(opt)}
                    className={cn(
                      'size-12 rounded-xl overflow-hidden ring-2 transition-all',
                      avatarDraft === opt
                        ? 'ring-violet-500 scale-110 shadow-lg'
                        : 'ring-transparent opacity-60 hover:opacity-100',
                    )}
                  >
                    <img src={opt} alt="Option" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t('profile.nickname')}
              </label>
              <input
                value={nicknameDraft}
                onChange={(e) => setNicknameDraft(e.target.value)}
                className="w-full h-11 px-4 rounded-xl border border-border/60 bg-slate-50 dark:bg-slate-900 focus:border-violet-500 outline-none font-bold"
                placeholder={t('profile.nicknamePlaceholder')}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t('profile.bio')}
              </label>
              <textarea
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
                className="w-full min-h-[100px] px-4 py-3 rounded-xl border border-border/60 bg-slate-50 dark:bg-slate-900 focus:border-violet-500 outline-none text-sm resize-none"
                placeholder={t('profile.bioPlaceholder')}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setEditing(false)}
              className="px-6 py-2.5 rounded-xl font-bold text-sm text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2.5 rounded-xl bg-violet-600 text-white font-bold text-sm shadow-lg shadow-violet-600/20 hover:bg-violet-700 transition-all"
            >
              {t('common.save')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── SidebarFooter — logout + branding at sidebar bottom ────
function SidebarFooter() {
  const { t } = useI18n();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [casdoorUser, setCasdoorUser] = useState<any>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setCasdoorUser(data.user);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="mt-auto pt-6 flex flex-col gap-4 border-t border-border/30">
      {/* Profile Bar */}
      <div className="px-1">
        <GreetingBar isSidebar={true} />
      </div>

      <div className="flex items-center justify-between opacity-60">
        <span className="text-[10px] text-muted-foreground/80 font-bold uppercase tracking-[0.15em]">
          {t('home.sidebarBranding')} &middot; {t('home.workspace')}
        </span>
        {!casdoorUser && (
          <button
            onClick={() => {
              window.location.href = '/api/auth/login';
            }}
            className="flex items-center gap-1.5 text-[11px] text-violet-500/70 hover:text-violet-600 transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-950/30"
          >
            <LogIn className="size-3" />
            Login
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Classroom Card — clean, minimal style ──────────────────────
function ClassroomCard({
  classroom,
  slide,
  formatDate,
  onDelete,
  onRename,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
  onClick,
}: {
  classroom: StageListItem;
  slide?: Slide;
  formatDate: (ts: number) => string;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onRename: (id: string, newName: string) => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const thumbRef = useRef<HTMLDivElement>(null);
  const [thumbWidth, setThumbWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setThumbWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing]);

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNameDraft(classroom.name);
    setEditing(true);
  };

  const commitRename = () => {
    if (!editing) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== classroom.name) {
      onRename(classroom.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <div className="group cursor-pointer" onClick={confirmingDelete ? undefined : onClick}>
      {/* Thumbnail — large radius, no border, subtle bg */}
      <div
        ref={thumbRef}
        className="relative w-full aspect-[16/9] rounded-2xl bg-slate-100 dark:bg-slate-800/80 overflow-hidden transition-transform duration-200 group-hover:scale-[1.02]"
      >
        {slide && thumbWidth > 0 ? (
          <ThumbnailSlide
            slide={slide}
            size={thumbWidth}
            viewportSize={slide.viewportSize ?? 1000}
            viewportRatio={slide.viewportRatio ?? 0.5625}
          />
        ) : !slide ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="size-12 rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/30 dark:to-blue-900/30 flex items-center justify-center">
              <span className="text-xl opacity-50">📄</span>
            </div>
          </div>
        ) : null}

        {/* Delete — top-right, only on hover. Gated by `delete-classroom` permission. */}
        <AnimatePresence>
          {!confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Can action="delete-classroom">
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute top-2 right-2 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 hover:bg-destructive/80 text-white hover:text-white backdrop-blur-sm rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(classroom.id, e);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </Can>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-11 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 hover:bg-black/50 text-white hover:text-white backdrop-blur-sm rounded-full"
                onClick={startRename}
              >
                <Pencil className="size-3.5" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Inline delete confirmation overlay */}
        <AnimatePresence>
          {confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-[6px]"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[13px] font-medium text-white/90">
                {t('classroom.deleteConfirmTitle')}?
              </span>
              <div className="flex gap-2">
                <button
                  className="px-3.5 py-1 rounded-lg text-[12px] font-medium bg-white/15 text-white/80 hover:bg-white/25 backdrop-blur-sm transition-colors"
                  onClick={onCancelDelete}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="px-3.5 py-1 rounded-lg text-[12px] font-medium bg-red-500/90 text-white hover:bg-red-500 transition-colors"
                  onClick={onConfirmDelete}
                >
                  {t('classroom.delete')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Info — outside the thumbnail */}
      <div className="mt-2.5 px-1 flex items-center gap-2">
        <span className="shrink-0 inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400">
          {classroom.sceneCount} {t('classroom.slides')} · {formatDate(classroom.updatedAt)}
        </span>
        {editing ? (
          <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={commitRename}
              maxLength={100}
              placeholder={t('classroom.renamePlaceholder')}
              className="w-full bg-transparent border-b border-violet-400/60 text-[15px] font-medium text-foreground/90 outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className="font-medium text-[15px] truncate text-foreground/90 min-w-0 cursor-text"
                onDoubleClick={startRename}
              >
                {classroom.name}
              </p>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              sideOffset={4}
              className="!max-w-[min(90vw,32rem)] break-words whitespace-normal"
            >
              <div className="flex items-center gap-1.5">
                <span className="break-all">{classroom.name}</span>
                <button
                  className="shrink-0 p-0.5 rounded hover:bg-foreground/10 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(classroom.name);
                    toast.success(t('classroom.nameCopied'));
                  }}
                >
                  <Copy className="size-3 opacity-60" />
                </button>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => setIsAuthenticated(!!data.authenticated))
      .catch(() => setIsAuthenticated(false));
  }, []);

  // Show nothing while checking auth
  if (isAuthenticated === null) {
    return (
      <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900" />
    );
  }

  if (!isAuthenticated) {
    return <LandingPageView />;
  }

  return <HomePage />;
}

function LandingPageView() {
  return <LandingPage />;
}
