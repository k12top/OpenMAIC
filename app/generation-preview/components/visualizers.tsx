'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ScanLine,
  Search,
  Globe,
  MousePointer2,
  BarChart3,
  Puzzle,
  Clapperboard,
  MessageSquare,
  Focus,
  Play,
  FileText,
  Bot,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { SceneOutline } from '@/lib/types/generation';

// Step-specific visualizers
export function StepVisualizer({
  stepId,
  outlines,
  webSearchSources,
  outlineSlot,
}: {
  stepId: string;
  outlines?: SceneOutline[] | null;
  webSearchSources?: Array<{ title: string; url: string }>;
  /**
   * When provided AND the active step is 'outline', this slot replaces the
   * default streaming visualizer. Used by the generation-preview page to
   * swap in the editable outline review panel during user-confirmation.
   */
  outlineSlot?: React.ReactNode;
}) {
  switch (stepId) {
    case 'pdf-analysis':
      return <PdfScanVisualizer />;
    case 'web-search':
      return <WebSearchVisualizer sources={webSearchSources || []} />;
    case 'outline':
      return outlineSlot ?? <StreamingOutlineVisualizer outlines={outlines || []} />;
    case 'agent-generation':
      return <AgentGenerationVisualizer />;
    case 'slide-content':
      return <ContentVisualizer />;
    case 'actions':
      return <ActionsVisualizer />;
    default:
      return null;
  }
}

// PDF: Large Document with scanning laser line
function PdfScanVisualizer() {
  return (
    <div className="w-full h-full relative flex items-center justify-center p-8">
      <motion.div
        className="absolute inset-10 bg-cyan-500/5 rounded-full blur-[100px]"
        animate={{ opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 3, repeat: Infinity }}
      />
      <div className="w-full max-w-2xl aspect-[1/1.414] max-h-[80%] bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xl relative overflow-hidden flex flex-col p-8 md:p-12">
        {/* Header Skeleton */}
        <div className="space-y-4 mb-12">
          <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-700 rounded-full" />
          <div className="h-4 w-1/2 bg-slate-100 dark:bg-slate-700 rounded-full" />
        </div>
        
        {/* Body Skeleton */}
        <div className="space-y-6 flex-1">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <motion.div
              key={i}
              className="space-y-2"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.15 }}
            >
              <div className="h-2.5 bg-slate-100 dark:bg-slate-700/50 rounded-full w-full" />
              <div className="h-2.5 bg-slate-100 dark:bg-slate-700/50 rounded-full w-[90%]" />
              <div className="h-2.5 bg-slate-100 dark:bg-slate-700/50 rounded-full w-[95%]" />
              <div className="h-2.5 bg-slate-100 dark:bg-slate-700/50 rounded-full w-[80%]" />
            </motion.div>
          ))}
        </div>

        {/* Scanning laser */}
        <motion.div
          className="absolute inset-x-0 h-[3px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_20px_rgba(34,211,238,0.8)] z-10"
          animate={{ top: ['0%', '100%', '0%'] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
      
      {/* Decorative Icon */}
      <motion.div
        className="absolute top-12 right-12 bg-white/50 dark:bg-slate-800/50 p-4 rounded-2xl backdrop-blur-md shadow-lg border border-cyan-100 dark:border-cyan-900/50"
        animate={{ y: [-10, 10, -10] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <ScanLine className="size-12 text-cyan-500" />
      </motion.div>
    </div>
  );
}

// Web Search: Full width list of actual search results
function WebSearchVisualizer({ sources }: { sources: Array<{ title: string; url: string }> }) {
  const { t } = useI18n();
  // Skeleton placeholders
  const skeletonResults = [
    { titleW: 70, urlW: 45, snippetW: [90, 60, 80] },
    { titleW: 55, urlW: 50, snippetW: [80, 75, 60] },
    { titleW: 65, urlW: 40, snippetW: [85, 50, 90] },
    { titleW: 50, urlW: 55, snippetW: [70, 65, 55] },
  ];

  return (
    <div className="w-full h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-teal-100 dark:border-teal-900/30">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-teal-100 dark:bg-teal-900/40 rounded-xl text-teal-600 dark:text-teal-400">
            <Search className="size-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t('generation.visualizer.webSearchTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('generation.visualizer.webSearchDesc')}</p>
          </div>
        </div>
        {sources.length > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="flex items-center gap-2 px-4 py-2 bg-teal-500 text-white rounded-full font-bold shadow-lg shadow-teal-500/20"
          >
            <Globe className="size-4" />
            <span>{t('generation.visualizer.sourcesFound', { count: sources.length })}</span>
          </motion.div>
        )}
      </div>

      {/* Results List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-4 space-y-4">
        {sources.length === 0 ? (
          // Skeleton loading
          skeletonResults.map((item, i) => (
            <motion.div
              key={i}
              className="p-6 bg-white/60 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-700/50 space-y-3"
              animate={{ opacity: [0.4, 0.8, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
            >
              <div className="h-4 bg-teal-200/40 dark:bg-teal-800/30 rounded" style={{ width: `${item.titleW}%` }} />
              <div className="h-3 bg-slate-100 dark:bg-slate-700/50 rounded" style={{ width: `${item.urlW}%` }} />
              <div className="space-y-1.5 pt-2">
                {item.snippetW.map((w, j) => (
                  <div key={j} className="h-2 bg-slate-100 dark:bg-slate-700/50 rounded" style={{ width: `${w}%` }} />
                ))}
              </div>
            </motion.div>
          ))
        ) : (
          // Live Results
          sources.map((source, i) => (
            <motion.div
              key={source.url}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              className="p-6 bg-white dark:bg-slate-800/90 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow group"
            >
              <h4 className="text-lg font-semibold text-teal-700 dark:text-teal-400 mb-1 group-hover:underline decoration-teal-500/50 underline-offset-2">
                {source.title}
              </h4>
              <p className="text-sm text-emerald-600/70 dark:text-emerald-400/70 truncate mb-3 flex items-center gap-1.5">
                <Globe className="size-3.5" />
                {source.url}
              </p>
              <div className="space-y-2">
                <div className="h-1.5 bg-slate-100 dark:bg-slate-700/50 rounded-full w-full" />
                <div className="h-1.5 bg-slate-100 dark:bg-slate-700/50 rounded-full w-[85%]" />
                <div className="h-1.5 bg-slate-100 dark:bg-slate-700/50 rounded-full w-[60%]" />
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

// Outline: Streams real outline data as it arrives from SSE
function StreamingOutlineVisualizer({ outlines }: { outlines: SceneOutline[] }) {
  const { t } = useI18n();
  // Build display lines from outlines
  const allLines: Array<{ text: string; isTitle: boolean }> = [];
  outlines.forEach((outline, i) => {
    allLines.push({ text: `${i + 1}. ${outline.title}`, isTitle: true });
    outline.keyPoints?.forEach((kp) => {
      allLines.push({ text: kp, isTitle: false });
    });
  });

  return (
    <div className="w-full h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-blue-100 dark:border-blue-900/30">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-100 dark:bg-blue-900/40 rounded-xl text-blue-600 dark:text-blue-400">
            <FileText className="size-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t('generation.visualizer.outlineTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('generation.visualizer.outlineDesc')}</p>
          </div>
        </div>
        {outlines.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2"
          >
            <div className="size-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{t('generation.visualizer.streaming')}</span>
          </motion.div>
        )}
      </div>

      {/* Document Area */}
      <div className="flex-1 bg-white/60 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 p-8 overflow-y-auto custom-scrollbar shadow-inner relative">
        <div className="max-w-3xl mx-auto space-y-4">
          {allLines.length === 0 ? (
            // Skeleton State
            <div className="space-y-8">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-3">
                  <motion.div
                    className="h-6 bg-slate-200 dark:bg-slate-700/80 rounded w-1/3"
                    animate={{ opacity: [0.3, 0.7, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity, delay: i * 0.2 }}
                  />
                  <div className="pl-6 space-y-2">
                    <motion.div
                      className="h-4 bg-slate-100 dark:bg-slate-700/50 rounded w-[80%]"
                      animate={{ opacity: [0.3, 0.7, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity, delay: i * 0.2 + 0.1 }}
                    />
                    <motion.div
                      className="h-4 bg-slate-100 dark:bg-slate-700/50 rounded w-[60%]"
                      animate={{ opacity: [0.3, 0.7, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity, delay: i * 0.2 + 0.2 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // Live Outline Data
            allLines.map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className={cn(
                  'leading-relaxed',
                  line.isTitle
                    ? 'text-lg font-bold text-slate-900 dark:text-slate-100 mt-6 first:mt-0'
                    : 'text-base text-slate-600 dark:text-slate-400 pl-6 flex items-start'
                )}
              >
                {!line.isTitle && (
                  <span className="text-blue-500 mr-2 mt-1.5 shrink-0 text-xl leading-none">•</span>
                )}
                <span>{line.text}</span>
              </motion.div>
            ))
          )}
        </div>
        
        {/* Blinking cursor at the end if we have content */}
        {allLines.length > 0 && (
          <motion.div
            className="w-2 h-5 bg-blue-500 mt-2 ml-6 inline-block"
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 0.8, repeat: Infinity }}
          />
        )}
      </div>
    </div>
  );
}

// Agent Generation: Show cards representing characters being configured
function AgentGenerationVisualizer() {
  const { t } = useI18n();
  return (
    <div className="w-full h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-purple-100 dark:border-purple-900/30">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-purple-100 dark:bg-purple-900/40 rounded-xl text-purple-600 dark:text-purple-400">
            <Bot className="size-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t('generation.visualizer.agentGenTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('generation.visualizer.agentGenDesc')}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center relative">
        <div className="flex gap-8 flex-wrap justify-center max-w-4xl">
          {[
            { role: 'Tutor', color: 'bg-blue-500', delay: 0 },
            { role: 'Student', color: 'bg-purple-500', delay: 0.2 },
            { role: 'Assistant', color: 'bg-emerald-500', delay: 0.4 },
          ].map((agent, i) => (
            <motion.div
              key={i}
              className="w-56 h-72 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl flex flex-col items-center justify-center p-6 relative overflow-hidden"
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: agent.delay, duration: 0.5, type: 'spring' }}
            >
              {/* Background glow */}
              <div className={cn("absolute inset-0 opacity-10 blur-xl", agent.color)} />
              
              <motion.div 
                className={cn("size-20 rounded-full flex items-center justify-center text-white shadow-lg mb-6 z-10", agent.color)}
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity, delay: agent.delay }}
              >
                <Bot className="size-10" />
              </motion.div>
              
              <div className="space-y-3 w-full z-10">
                <div className="h-4 w-1/2 bg-slate-100 dark:bg-slate-700 rounded-full mx-auto" />
                <div className="h-3 w-3/4 bg-slate-50 dark:bg-slate-700/50 rounded-full mx-auto" />
                <div className="h-3 w-2/3 bg-slate-50 dark:bg-slate-700/50 rounded-full mx-auto" />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Content: Large preview cards showing different page layouts being constructed
function ContentVisualizer() {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const totalTypes = 4;

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % totalTypes);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const getTheme = (idx: number) => {
    switch (idx) {
      case 0:
        return {
          color: 'blue',
          label: t('generation.visualizer.slideLayout'),
          desc: t('generation.visualizer.slideLayoutDesc'),
          icon: BarChart3,
          bg: 'bg-blue-500/10',
          text: 'text-blue-600 dark:text-blue-400',
          border: 'border-blue-200 dark:border-blue-800/50',
        };
      case 1:
        return {
          color: 'purple',
          label: t('generation.visualizer.quizInterface'),
          desc: t('generation.visualizer.quizInterfaceDesc'),
          icon: Focus,
          bg: 'bg-purple-500/10',
          text: 'text-purple-600 dark:text-purple-400',
          border: 'border-purple-200 dark:border-purple-800/50',
        };
      case 2:
        return {
          color: 'amber',
          label: t('generation.visualizer.pblScenario'),
          desc: t('generation.visualizer.pblScenarioDesc'),
          icon: Puzzle,
          bg: 'bg-amber-500/10',
          text: 'text-amber-600 dark:text-amber-400',
          border: 'border-amber-200 dark:border-amber-800/50',
        };
      case 3:
        return {
          color: 'emerald',
          label: t('generation.visualizer.webContent'),
          desc: t('generation.visualizer.webContentDesc'),
          icon: Globe,
          bg: 'bg-emerald-500/10',
          text: 'text-emerald-600 dark:text-emerald-400',
          border: 'border-emerald-200 dark:border-emerald-800/50',
        };
      default:
        return { color: 'blue', label: '', desc: '', icon: BarChart3, bg: '', text: '', border: '' };
    }
  };

  const theme = getTheme(index);
  const Icon = theme.icon;

  return (
    <div className="w-full h-full flex flex-col p-4 relative overflow-hidden">
      {/* Background glow transition */}
      <motion.div
        key={`glow-${index}`}
        className={cn('absolute inset-0 blur-[100px] transition-colors duration-1000 -z-10 opacity-30', theme.bg)}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-4">
          <motion.div 
            key={`icon-${index}`}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            className={cn("p-3 rounded-xl", theme.bg, theme.text)}
          >
            <Icon className="size-6" />
          </motion.div>
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t('generation.visualizer.pageContentTitle')}</h3>
            <motion.p 
              key={`desc-${index}`}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm text-muted-foreground"
            >
              {theme.desc}
            </motion.p>
          </div>
        </div>
        
        <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-semibold tracking-wider text-slate-500">
          {t('generation.visualizer.buildingUi')}
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.05, y: -20 }}
            transition={{ duration: 0.5, type: 'spring' }}
            className={cn(
              "w-full max-w-2xl aspect-[16/9] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border flex flex-col overflow-hidden",
              theme.border
            )}
          >
            {/* Browser-like Header */}
            <div className="h-10 border-b border-slate-100 dark:border-slate-800 flex items-center px-4 gap-2 bg-slate-50 dark:bg-slate-900/50">
              <div className="size-3 rounded-full bg-red-400" />
              <div className="size-3 rounded-full bg-amber-400" />
              <div className="size-3 rounded-full bg-green-400" />
              <div className="flex-1 ml-4 h-5 bg-white dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700" />
            </div>

            {/* Simulated Content Body based on type */}
            <div className="flex-1 p-8 flex flex-col relative overflow-hidden">
              <div className="text-sm font-bold tracking-widest mb-6 opacity-50 flex items-center gap-2">
                <Icon className="size-4" /> {theme.label}
              </div>

              {index === 0 && ( // SLIDE
                <div className="flex gap-8 h-full">
                  <div className="w-1/3 h-full bg-slate-100 dark:bg-slate-800 rounded-xl" />
                  <div className="flex-1 space-y-4">
                    <div className="h-8 bg-slate-100 dark:bg-slate-800 rounded-lg w-3/4" />
                    <div className="space-y-2 mt-8">
                      {[1,2,3,4].map(i => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="size-2 rounded-full bg-blue-400" />
                          <div className="h-4 bg-slate-50 dark:bg-slate-800/50 rounded flex-1" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {index === 1 && ( // QUIZ
                <div className="max-w-md mx-auto w-full h-full flex flex-col justify-center space-y-6">
                  <div className="h-12 bg-slate-100 dark:bg-slate-800 rounded-xl w-full" />
                  <div className="grid grid-cols-2 gap-4">
                    {[1,2,3,4].map(i => (
                      <div key={i} className={cn(
                        "h-16 rounded-xl border-2 flex items-center px-4",
                        i === 2 ? "border-purple-400 bg-purple-50 dark:bg-purple-900/20" : "border-slate-100 dark:border-slate-800"
                      )}>
                        <div className={cn("size-4 rounded-full border-2 mr-3", i === 2 ? "border-purple-500 bg-purple-500" : "border-slate-300")} />
                        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full w-24" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {index === 2 && ( // PBL
                <div className="h-full flex flex-col">
                  <div className="flex gap-4 mb-4">
                    <div className="flex-1 h-24 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-xl p-4" />
                  </div>
                  <div className="flex-1 flex gap-4">
                    <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 rounded-xl" />
                    <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 rounded-xl" />
                    <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 rounded-xl" />
                  </div>
                </div>
              )}

              {index === 3 && ( // WEB
                <div className="h-full w-full bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/50 rounded-xl flex items-center justify-center relative">
                  <Globe className="size-20 text-emerald-300 dark:text-emerald-700/50" />
                  <motion.div 
                    className="absolute"
                    animate={{ x: [-50, 50, -20, 0], y: [-20, 30, -40, 0] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <MousePointer2 className="size-8 text-emerald-600 drop-shadow-md" />
                  </motion.div>
                </div>
              )}

              {/* Scanning overlay */}
              <motion.div
                className="absolute inset-y-0 w-32 bg-gradient-to-r from-transparent via-white/40 dark:via-white/10 to-transparent skew-x-[-20deg]"
                initial={{ left: '-20%' }}
                animate={{ left: '120%' }}
                transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// Actions: Large Timeline of speech, spotlight, and interactions being orchestrated
function ActionsVisualizer() {
  const { t } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);

  const actionItems = [
    {
      icon: MessageSquare,
      label: t('generation.visualizer.tutorSpeech'),
      color: 'text-violet-500',
      bg: 'bg-violet-500/10',
      border: 'border-violet-200 dark:border-violet-800',
    },
    {
      icon: Focus,
      label: t('generation.visualizer.cameraSpotlight'),
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
      border: 'border-amber-200 dark:border-amber-800',
    },
    {
      icon: MessageSquare,
      label: t('generation.visualizer.studentQuery'),
      color: 'text-purple-500',
      bg: 'bg-purple-500/10',
      border: 'border-purple-200 dark:border-purple-800',
    },
    {
      icon: Play,
      label: t('generation.visualizer.interactiveEvents'),
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-200 dark:border-emerald-800',
    },
    {
      icon: Clapperboard,
      label: t('generation.visualizer.sceneTimeline'),
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
      border: 'border-blue-200 dark:border-blue-800',
    },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % actionItems.length);
    }, 1800);
    return () => clearInterval(timer);
  }, [actionItems.length]);

  return (
    <div className="w-full h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-violet-100 dark:border-violet-900/30">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-violet-100 dark:bg-violet-900/40 rounded-xl text-violet-600 dark:text-violet-400">
            <Clapperboard className="size-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t('generation.visualizer.actionsGenTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('generation.visualizer.actionsGenDesc')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-violet-500 animate-pulse" />
          <span className="text-sm font-medium text-violet-600 dark:text-violet-400">{t('generation.visualizer.processingTimeline')}</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center max-w-4xl mx-auto w-full space-y-4">
        {actionItems.map((item, i) => {
          const Icon = item.icon;
          const isActive = i === activeIdx;
          const isPast = i < activeIdx;
          
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: isPast ? 0.5 : 1, x: 0 }}
              transition={{ duration: 0.4 }}
              className={cn(
                "flex items-center gap-6 p-4 rounded-2xl border transition-all duration-500",
                isActive ? cn("bg-white dark:bg-slate-800 shadow-xl scale-[1.02]", item.border) : "bg-white/50 dark:bg-slate-800/50 border-transparent shadow-sm"
              )}
            >
              {/* Status Indicator */}
              <div className="w-12 flex justify-center shrink-0">
                {isPast ? (
                  <CheckCircle2 className={cn("size-6", item.color)} />
                ) : isActive ? (
                  <div className="relative flex items-center justify-center">
                    <div className={cn("absolute size-8 rounded-full animate-ping opacity-20", item.bg.replace('/10', ''))} />
                    <div className={cn("size-4 rounded-full", item.color.replace('text-', 'bg-'))} />
                  </div>
                ) : (
                  <div className="size-4 rounded-full bg-slate-200 dark:bg-slate-700" />
                )}
              </div>

              {/* Icon Container */}
              <div className={cn("size-12 rounded-xl flex items-center justify-center shrink-0", isActive ? item.bg : "bg-slate-100 dark:bg-slate-800")}>
                <Icon className={cn("size-6", isActive ? item.color : "text-slate-400")} />
              </div>

              {/* Text Content */}
              <div className="flex-1">
                <h4 className={cn("text-lg font-semibold", isActive ? item.color : "text-slate-600 dark:text-slate-400")}>
                  {item.label}
                </h4>
                {isActive && (
                  <motion.div 
                    initial={{ width: 0 }} 
                    animate={{ width: "100%" }} 
                    transition={{ duration: 1.8, ease: "linear" }}
                    className={cn("h-1 mt-2 rounded-full", item.color.replace('text-', 'bg-').replace('-500', '-200 dark:bg-opacity-20'))} 
                  >
                    <div className={cn("h-full rounded-full w-full", item.color.replace('text-', 'bg-'))} />
                  </motion.div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
