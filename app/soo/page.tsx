'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { nanoid } from 'nanoid';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import type { UserRequirements } from '@/lib/types/generation';

function SooTaskContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tempId = searchParams.get('tempId');
    const directContent = searchParams.get('content');
    const directContentB64 = searchParams.get('content_b64');

    if (!tempId && !directContent && !directContentB64) {
      setError('Missing parameters. Please provide a tempId, content, or content_b64.');
      setLoading(false);
      return;
    }

    const decodeBase64UTF8 = (str: string) => {
      try {
        const binaryString = window.atob(str);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new TextDecoder().decode(bytes);
      } catch (e) {
        console.error('Failed to decode base64:', e);
        return null;
      }
    };

    const processTask = async () => {
      try {
        // 0. Check authentication first
        const authResponse = await fetch('/api/auth/me');
        if (authResponse.status === 401) {
          console.warn('User not authenticated, redirecting to login...');
          const returnUrl = encodeURIComponent(window.location.href);
          window.location.href = `/api/auth/login?returnUrl=${returnUrl}`;
          return;
        }

        let content = '';

        if (directContent) {
          content = directContent;
        } else if (directContentB64) {
          const decoded = decodeBase64UTF8(directContentB64);
          if (!decoded) throw new Error('Invalid Base64 content provided.');
          content = decoded;
        } else if (tempId) {
          // Fetch from backend API which performs gRPC call
          const response = await fetch('/api/orchestration/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tempId }),
          });

          if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Failed to fetch task content');
          }

          const data = await response.json();
          if (!data.success || !data.content) {
            throw new Error('Task content is empty or invalid.');
          }
          content = data.content;
        }

        if (!content) {
          throw new Error('No content available for task generation.');
        }

        // 2. Build generationSession required by /generation-preview
        const userProfile = useUserProfileStore.getState();
        const requirements: UserRequirements = {
          requirement: content,
          language: 'zh-CN', // Default language, could be inferred from user preferences
          userNickname: userProfile.nickname || undefined,
          userBio: userProfile.bio || undefined,
          webSearch: false,
        };

        const sessionState = {
          sessionId: nanoid(),
          requirements,
          pdfText: '',
          pdfImages: [],
          imageStorageIds: [],
          sceneOutlines: null,
          currentStep: 'generating' as const,
        };

        // 3. Store in sessionStorage and redirect
        sessionStorage.setItem('generationSession', JSON.stringify(sessionState));
        setLoading(false);
        router.push('/generation-preview');
      } catch (err: any) {
        console.error('Task process error:', err);
        setError(err.message || 'An error occurred while processing the task.');
        setLoading(false);
      }
    };

    processTask();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <AnimatePresence>
        {loading ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex flex-col items-center max-w-sm w-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-8 border border-slate-100 dark:border-slate-800"
          >
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-6" />
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-2">
              Preparing Your Task
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
              Fetching temporary content structure and organizing AI generation context...
            </p>
          </motion.div>
        ) : error ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center max-w-md w-full bg-red-50 dark:bg-red-950/30 rounded-2xl p-8 border-2 border-red-100 dark:border-red-900/50 text-center"
          >
            <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
            <h2 className="text-xl font-semibold text-red-700 dark:text-red-400 mb-2">
              Could Not Fetch Task
            </h2>
            <p className="text-sm text-red-600/80 dark:text-red-400/80 mb-6">
              {error}
            </p>
            <button
              onClick={() => router.push('/')}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
            >
              Return Home
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function SOOPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
      </div>
    }>
      <SooTaskContent />
    </Suspense>
  );
}
