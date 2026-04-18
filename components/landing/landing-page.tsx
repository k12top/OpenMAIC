'use client';

import { motion } from 'motion/react';
import {
  BookOpen,
  Globe,
  Mic,
  Share2,
  Sparkles,
  Play,
  ArrowRight,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { BRAND_NAME } from '@/lib/constants/brand';

const FEATURES = [
  {
    icon: Sparkles,
    titleKey: 'landing.feature.aiGeneration',
    descKey: 'landing.feature.aiGenerationDesc',
    fallbackTitle: 'AI Courseware Generation',
    fallbackDesc: 'Upload a PDF or describe your topic — AI generates immersive, multi-scene interactive courseware in seconds.',
  },
  {
    icon: Globe,
    titleKey: 'landing.feature.multiLang',
    descKey: 'landing.feature.multiLangDesc',
    fallbackTitle: 'Multi-Language Support',
    fallbackDesc: 'Generate courseware in Chinese, English, Japanese, Korean, French, and many more languages with auto TTS.',
  },
  {
    icon: BookOpen,
    titleKey: 'landing.feature.interactive',
    descKey: 'landing.feature.interactiveDesc',
    fallbackTitle: 'Interactive Classroom',
    fallbackDesc: 'Quizzes, PBL projects, whiteboard, and multi-agent discussion — a fully immersive learning experience.',
  },
  {
    icon: Mic,
    titleKey: 'landing.feature.tts',
    descKey: 'landing.feature.ttsDesc',
    fallbackTitle: 'Text-to-Speech & ASR',
    fallbackDesc: 'Natural voice narration for every slide with speech recognition for voice-driven interaction.',
  },
  {
    icon: Share2,
    titleKey: 'landing.feature.share',
    descKey: 'landing.feature.shareDesc',
    fallbackTitle: 'Share & Collaborate',
    fallbackDesc: 'Share courseware via link — read-only for anyone or editable copies for collaborators.',
  },
  {
    icon: Play,
    titleKey: 'landing.feature.playback',
    descKey: 'landing.feature.playbackDesc',
    fallbackTitle: 'Presentation Playback',
    fallbackDesc: 'Present your courseware with smooth animations, agent roundtable discussions, and auto-play.',
  },
];

export function LandingPage() {
  const { t } = useI18n();

  const safeT = (key: string, fallback: string) => {
    const val = t(key);
    return val === key ? fallback : val;
  };

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center overflow-x-hidden">
      {/* Background decor */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '4s' }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '6s' }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-violet-500/5 rounded-full blur-3xl"
        />
      </div>

      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        className="relative z-10 flex flex-col items-center text-center px-4 pt-24 md:pt-32 pb-16 max-w-3xl"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 200, damping: 22 }}
          className="mb-6 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-100/80 dark:bg-violet-900/30 border border-violet-200/50 dark:border-violet-800/40"
        >
          <Sparkles className="size-3.5 text-violet-600 dark:text-violet-400" />
          <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
            {safeT('landing.badge', 'AI-Powered Courseware Platform')}
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 200, damping: 22 }}
          className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-4"
        >
          {BRAND_NAME}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="text-base md:text-lg text-muted-foreground/70 max-w-2xl mb-10 leading-relaxed"
        >
          {safeT('landing.subtitle', 'Transform any topic into an immersive, multi-agent interactive learning experience. Upload a PDF or describe your content — AI does the rest.')}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <a
            href="/api/auth/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium shadow-lg shadow-primary/20 hover:opacity-90 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            {safeT('landing.getStarted', 'Get Started')}
            <ArrowRight className="size-4" />
          </a>
          <a
            href="#features"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-border/60 text-foreground/80 font-medium hover:bg-muted/50 transition-all"
          >
            {safeT('landing.learnMore', 'Learn More')}
          </a>
        </motion.div>
      </motion.div>

      {/* Features Section */}
      <div id="features" className="relative z-10 w-full max-w-5xl px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-2xl md:text-3xl font-semibold text-foreground mb-3">
            {safeT('landing.featuresTitle', 'Everything you need for interactive learning')}
          </h2>
          <p className="text-muted-foreground/60 max-w-xl mx-auto">
            {safeT('landing.featuresSubtitle', 'Powered by the latest AI models, designed for educators and learners.')}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.titleKey}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              className="group p-5 rounded-2xl border border-border/40 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm hover:bg-white/90 dark:hover:bg-slate-800/80 hover:shadow-lg hover:shadow-violet-500/5 transition-all duration-300"
            >
              <div className="mb-3 inline-flex items-center justify-center size-10 rounded-xl bg-violet-100/80 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 group-hover:scale-110 transition-transform">
                <feature.icon className="size-5" />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1.5">
                {safeT(feature.titleKey, feature.fallbackTitle)}
              </h3>
              <p className="text-xs text-muted-foreground/70 leading-relaxed">
                {safeT(feature.descKey, feature.fallbackDesc)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* CTA Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-3xl px-4 py-16 text-center"
      >
        <div className="p-8 md:p-12 rounded-3xl bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-950/40 dark:to-blue-950/40 border border-violet-200/30 dark:border-violet-800/30">
          <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-3">
            {safeT('landing.ctaTitle', 'Ready to transform your teaching?')}
          </h2>
          <p className="text-sm text-muted-foreground/70 mb-6 max-w-lg mx-auto">
            {safeT('landing.ctaDesc', 'Sign in to start creating AI-powered interactive courseware. Free credits included for new users.')}
          </p>
          <a
            href="/api/auth/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium shadow-lg shadow-primary/20 hover:opacity-90 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            {safeT('landing.signIn', 'Sign In / Register')}
            <ArrowRight className="size-4" />
          </a>
        </div>
      </motion.div>

      {/* Footer */}
      <div className="mt-auto pt-8 pb-6 text-center text-xs text-muted-foreground/40">
        {BRAND_NAME}
      </div>
    </div>
  );
}
