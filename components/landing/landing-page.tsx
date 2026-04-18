'use client';

import { motion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';
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
  const { scrollY } = useScroll();

  // Parallax transforms based on window scroll
  const yBlob1 = useTransform(scrollY, [0, 1000], [0, 250]);
  const yBlob2 = useTransform(scrollY, [0, 1000], [0, -200]);
  const yBlob3 = useTransform(scrollY, [0, 1000], [0, 150]);
  const yBlob4 = useTransform(scrollY, [0, 1000], [0, -300]);
  
  const yHeroText = useTransform(scrollY, [0, 500], [0, 100]);
  const opacityHero = useTransform(scrollY, [0, 400], [1, 0]);

  const safeT = (key: string, fallback: string) => {
    const val = t(key);
    return val === key ? fallback : val;
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#FAFAFA] dark:bg-[#0A0A0B] flex flex-col items-center overflow-x-hidden relative selection:bg-violet-500/30">
      
      {/* ═══ Parallax Background Elements ═══ */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <motion.div
          style={{ y: yBlob1 }}
          className="absolute -top-[10%] -left-[10%] w-[50vw] h-[50vw] max-w-[800px] max-h-[800px] bg-blue-500/10 dark:bg-blue-600/10 rounded-full blur-[100px] opacity-80 mix-blend-multiply dark:mix-blend-screen"
        />
        <motion.div
          style={{ y: yBlob2 }}
          className="absolute top-[20%] -right-[15%] w-[60vw] h-[60vw] max-w-[1000px] max-h-[1000px] bg-violet-500/10 dark:bg-violet-600/10 rounded-full blur-[120px] opacity-70 mix-blend-multiply dark:mix-blend-screen"
        />
        <motion.div
          style={{ y: yBlob3 }}
          className="absolute top-[60%] -left-[20%] w-[40vw] h-[40vw] max-w-[600px] max-h-[600px] bg-purple-500/10 dark:bg-purple-600/10 rounded-full blur-[90px] opacity-60 mix-blend-multiply dark:mix-blend-screen"
        />
        <motion.div
          style={{ y: yBlob4 }}
          className="absolute bottom-[-10%] right-[10%] w-[45vw] h-[45vw] max-w-[700px] max-h-[700px] bg-indigo-500/10 dark:bg-indigo-600/10 rounded-full blur-[110px] opacity-80 mix-blend-multiply dark:mix-blend-screen"
        />
      </div>

      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none z-0 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />

      {/* ═══ Hero Section ═══ */}
      <motion.div
        style={{ y: yHeroText, opacity: opacityHero }}
        className="relative z-10 flex flex-col items-center text-center px-4 pt-32 md:pt-48 pb-20 max-w-4xl w-full"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/60 dark:bg-white/5 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-sm"
        >
          <Sparkles className="size-4 text-violet-600 dark:text-violet-400" />
          <span className="text-sm font-semibold bg-gradient-to-r from-violet-600 to-indigo-600 dark:from-violet-400 dark:to-indigo-400 bg-clip-text text-transparent">
            {safeT('landing.badge', 'AI-Powered Courseware Platform')}
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tighter text-slate-900 dark:text-white mb-6 leading-[1.1] drop-shadow-sm"
        >
          {BRAND_NAME}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-lg md:text-xl text-slate-600 dark:text-slate-300 max-w-2xl mb-12 leading-relaxed"
        >
          {safeT('landing.subtitle', 'Transform any topic into an immersive, multi-agent interactive learning experience. Upload a PDF or describe your content — AI does the rest.')}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col sm:flex-row gap-4"
        >
          <a
            href="/api/auth/login"
            className="group relative inline-flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold overflow-hidden transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(139,92,246,0.3)] dark:hover:shadow-[0_0_40px_rgba(255,255,255,0.2)] active:scale-95"
          >
            <span className="relative z-10">{safeT('landing.getStarted', 'Get Started Free')}</span>
            <ArrowRight className="relative z-10 size-4 transition-transform group-hover:translate-x-1" />
            <div className="absolute inset-0 bg-gradient-to-r from-violet-600 to-indigo-600 opacity-0 group-hover:opacity-100 dark:from-violet-400 dark:to-indigo-400 transition-opacity duration-300" />
          </a>
          <a
            href="#features"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur-md border border-black/5 dark:border-white/10 text-slate-700 dark:text-slate-200 font-semibold hover:bg-white/60 dark:hover:bg-white/10 transition-all hover:scale-105 active:scale-95"
          >
            {safeT('landing.learnMore', 'Explore Features')}
          </a>
        </motion.div>
      </motion.div>

      {/* ═══ Floating 3D Elements Placeholder (Glass Cards) ═══ */}
      <div className="w-full max-w-6xl mx-auto px-4 relative z-10 hidden lg:block h-32 mb-16">
         <motion.div 
            style={{ y: useTransform(scrollY, [0, 800], [0, -100]) }}
            className="absolute left-[10%] top-0 p-4 rounded-2xl bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border border-white/40 dark:border-slate-700/50 shadow-2xl rotate-[-6deg]"
         >
            <div className="w-32 h-24 rounded-lg bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30" />
         </motion.div>
         <motion.div 
            style={{ y: useTransform(scrollY, [0, 800], [0, -180]) }}
            className="absolute right-[15%] -top-10 p-4 rounded-2xl bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border border-white/40 dark:border-slate-700/50 shadow-2xl rotate-[8deg]"
         >
            <div className="w-40 h-32 rounded-lg bg-gradient-to-br from-blue-100 to-cyan-100 dark:from-blue-900/30 dark:to-cyan-900/30" />
         </motion.div>
      </div>

      {/* ═══ Features Section ═══ */}
      <div id="features" className="relative z-10 w-full max-w-6xl px-4 py-24 md:py-32">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-20"
        >
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900 dark:text-white mb-6">
            {safeT('landing.featuresTitle', 'Designed for maximum engagement')}
          </h2>
          <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
            {safeT('landing.featuresSubtitle', 'Powered by the latest AI models, built natively for interactive education.')}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.titleKey}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: i * 0.1, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="group relative p-8 rounded-3xl border border-black/5 dark:border-white/10 bg-white/40 dark:bg-white/5 backdrop-blur-xl hover:bg-white/80 dark:hover:bg-white/10 transition-colors duration-500 overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500/0 via-transparent to-transparent opacity-0 group-hover:opacity-10 dark:from-violet-500/0 transition-opacity duration-500" />
              <div className="relative z-10">
                <div className="mb-6 inline-flex size-14 items-center justify-center rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 group-hover:scale-110 transition-transform duration-500 ease-out shadow-lg">
                  <feature.icon className="size-6" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                  {safeT(feature.titleKey, feature.fallbackTitle)}
                </h3>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  {safeT(feature.descKey, feature.fallbackDesc)}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ═══ CTA Section ═══ */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-20 w-full max-w-5xl px-4 py-24 mb-16"
      >
        <div className="relative overflow-hidden p-12 md:p-20 rounded-[3rem] bg-slate-900 dark:bg-white border text-center shadow-2xl">
          {/* Internal gradient blob for shiny effect */}
          <div className="absolute inset-0 rounded-[3rem] opacity-30 dark:opacity-50 pointer-events-none">
             <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500 rounded-full blur-[100px] animate-pulse" />
             <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-500 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '2s' }} />
          </div>
          
          <div className="relative z-10">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white dark:text-slate-900 mb-6">
              {safeT('landing.ctaTitle', 'Start teaching the future')}
            </h2>
            <p className="text-lg text-slate-300 dark:text-slate-600 mb-10 max-w-xl mx-auto">
              {safeT('landing.ctaDesc', 'Join thousands of educators leveraging 翔宇文书 to build deeply engaging interactive courseware.')}
            </p>
            <a
              href="/api/auth/login"
              className="inline-flex items-center gap-3 px-10 py-5 rounded-2xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold text-lg hover:scale-105 active:scale-95 transition-transform shadow-xl"
            >
              {safeT('landing.signIn', 'Launch 翔宇文书')}
              <Sparkles className="size-5" />
            </a>
          </div>
        </div>
      </motion.div>

      {/* Footer */}
      <div className="relative z-10 w-full py-8 text-center text-sm font-medium text-slate-400 dark:text-slate-600 border-t border-black/5 dark:border-white/5">
        &copy; {new Date().getFullYear()} {BRAND_NAME}. All rights reserved.
      </div>
    </div>
  );
}
