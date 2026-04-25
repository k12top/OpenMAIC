'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic,
  MicOff,
  Send,
  MessageSquare,
  Pause,
  Play,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Loader2,
  Volume2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AudioIndicatorState } from './audio-indicator';
import { CanvasToolbar } from '@/components/canvas/canvas-toolbar';
import { useAudioRecorder } from '@/lib/hooks/use-audio-recorder';
import { useI18n } from '@/lib/hooks/use-i18n';
import { toast } from 'sonner';
import { useSettingsStore, PLAYBACK_SPEEDS } from '@/lib/store/settings';
import { ProactiveCard } from '@/components/chat/proactive-card';
import { PresentationSpeechOverlay } from '@/components/roundtable/presentation-speech-overlay';
import { AvatarDisplay } from '@/components/ui/avatar-display';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { DEFAULT_TEACHER_AVATAR, DEFAULT_USER_AVATAR } from '@/components/roundtable/constants';
import type { DiscussionAction } from '@/lib/types/action';
import type { EngineMode, PlaybackView } from '@/lib/playback';
import type { Participant } from '@/lib/types/roundtable';

export interface DiscussionRequest {
  topic: string;
  prompt?: string;
  agentId?: string; // Agent ID to initiate discussion (default: 'default-1')
}

interface RoundtableProps {
  readonly mode?: 'playback' | 'autonomous';
  readonly initialParticipants?: Participant[];
  readonly playbackView?: PlaybackView; // Centralised derived state from Stage
  readonly currentSpeech?: string | null; // Live SSE speech (from StreamBuffer — discussion/QA)
  readonly lectureSpeech?: string | null; // Active lecture speech (from PlaybackEngine, full text)
  readonly idleText?: string | null; // Static idle text (first speech action)
  readonly playbackCompleted?: boolean; // True when engine finished all actions (show restart icon)
  readonly discussionRequest?: DiscussionAction | null;
  readonly engineMode?: EngineMode;
  readonly isStreaming?: boolean;
  readonly sessionType?: 'qa' | 'discussion';
  readonly speakingAgentId?: string | null;
  readonly audioIndicatorState?: AudioIndicatorState;
  readonly audioAgentId?: string | null;
  readonly speechProgress?: number | null; // StreamBuffer reveal progress (0–1) for auto-scroll
  readonly showEndFlash?: boolean;
  readonly endFlashSessionType?: 'qa' | 'discussion';
  readonly thinkingState?: { stage: string; agentId?: string } | null;
  readonly isCueUser?: boolean;
  readonly isTopicPending?: boolean;
  readonly onMessageSend?: (message: string) => void;
  readonly onDiscussionStart?: (request: DiscussionAction) => void;
  readonly onDiscussionSkip?: () => void;
  readonly onStopDiscussion?: () => void;
  readonly onInputActivate?: () => void;
  /** Owner-only: regenerate the currently visible scene (passed through to CanvasToolbar). */
  readonly onRegenerateScene?: () => void;

  readonly onResumeTopic?: () => void;
  readonly onPlayPause?: () => void;
  readonly isDiscussionPaused?: boolean;
  readonly onDiscussionPause?: () => void;
  readonly onDiscussionResume?: () => void;
  readonly totalActions?: number;
  readonly currentActionIndex?: number;
  // Toolbar props (merged from CanvasArea)
  readonly currentSceneIndex?: number;
  readonly scenesCount?: number;
  readonly whiteboardOpen?: boolean;
  readonly sidebarCollapsed?: boolean;
  readonly chatCollapsed?: boolean;
  readonly onToggleSidebar?: () => void;
  readonly onToggleChat?: () => void;
  readonly onPrevSlide?: () => void;
  readonly onNextSlide?: () => void;
  readonly onWhiteboardClose?: () => void;
  readonly isPresenting?: boolean;
  readonly controlsVisible?: boolean;
  readonly onTogglePresentation?: () => void;
  readonly onPresentationInteractionChange?: (active: boolean) => void;
  /** Ref to the fullscreen container — passed to ProactiveCard so its portal
   *  renders inside the top-layer during presentation mode. */
  readonly fullscreenContainerRef?: React.RefObject<HTMLDivElement | null>;
}

const VOICE_WAVE_BARS = [
  { peak: 18, duration: 0.55 },
  { peak: 24, duration: 0.72 },
  { peak: 15, duration: 0.63 },
  { peak: 22, duration: 0.68 },
  { peak: 27, duration: 0.78 },
  { peak: 19, duration: 0.61 },
  { peak: 26, duration: 0.74 },
  { peak: 17, duration: 0.58 },
  { peak: 23, duration: 0.7 },
  { peak: 16, duration: 0.57 },
  { peak: 21, duration: 0.66 },
  { peak: 14, duration: 0.53 },
] as const;

function VoiceWaveformBars({ barClassName }: { readonly barClassName: string }) {
  return VOICE_WAVE_BARS.map((bar, i) => (
    <motion.div
      key={i}
      animate={{
        height: [4, bar.peak, 4],
        opacity: [0.3, 1, 0.3],
      }}
      transition={{
        repeat: Infinity,
        duration: bar.duration,
        delay: i * 0.05,
        ease: 'easeInOut',
      }}
      className={cn('w-1 rounded-full', barClassName)}
    />
  ));
}

export function Roundtable({
  mode: _mode = 'autonomous',
  initialParticipants = [],
  playbackView,
  currentSpeech,
  lectureSpeech,
  idleText,
  playbackCompleted,
  discussionRequest,
  engineMode = 'idle',
  isStreaming,
  sessionType,
  speakingAgentId,
  audioIndicatorState,
  audioAgentId,
  speechProgress: _speechProgress,
  showEndFlash,
  endFlashSessionType = 'discussion',
  thinkingState,
  isCueUser,
  isTopicPending,
  onMessageSend,
  onDiscussionStart,
  onDiscussionSkip,
  onStopDiscussion,
  onInputActivate,
  onRegenerateScene,

  onResumeTopic,
  onPlayPause,
  isDiscussionPaused,
  onDiscussionPause,
  onDiscussionResume,
  currentSceneIndex = 0,
  scenesCount = 1,
  whiteboardOpen = false,
  sidebarCollapsed,
  chatCollapsed,
  onToggleSidebar,
  onToggleChat,
  onPrevSlide,
  onNextSlide,
  onWhiteboardClose,
  isPresenting,
  controlsVisible,
  onTogglePresentation,
  onPresentationInteractionChange,
  fullscreenContainerRef,
}: RoundtableProps) {
  const { t } = useI18n();
  const ttsMuted = useSettingsStore((s) => s.ttsMuted);
  const setTTSMuted = useSettingsStore((s) => s.setTTSMuted);
  const ttsEnabled = useSettingsStore((state) => state.ttsEnabled);
  const asrEnabled = useSettingsStore((state) => state.asrEnabled);
  const chatAreaWidth = useSettingsStore((s) => s.chatAreaWidth);
  const ttsVolume = useSettingsStore((s) => s.ttsVolume);
  const setTTSVolume = useSettingsStore((s) => s.setTTSVolume);
  const autoPlayLecture = useSettingsStore((s) => s.autoPlayLecture);
  const setAutoPlayLecture = useSettingsStore((s) => s.setAutoPlayLecture);
  const playbackSpeed = useSettingsStore((s) => s.playbackSpeed);
  const setPlaybackSpeed = useSettingsStore((s) => s.setPlaybackSpeed);
  const [isInputOpen, setIsInputOpen] = useState(false);
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [userMessage, setUserMessage] = useState<string | null>(null);
  const userMessageClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // End flash visible state (Issue 3)
  const [endFlashVisible, setEndFlashVisible] = useState(false);

  // Send cooldown: lock input from "message sent" until "agent bubble appears"
  const [isSendCooldown, setIsSendCooldown] = useState(false);
  const isSendCooldownRef = useRef(false);

  const teacherParticipant = initialParticipants.find((p) => p.role === 'teacher');
  const studentParticipants = initialParticipants.filter(
    (p) => p.role !== 'teacher' && p.role !== 'user',
  );

  const presentationActionAnchorRef = useRef<HTMLDivElement>(null);
  const presentationAgentAvatarRef = useRef<HTMLDivElement>(null);

  // Derived state from Stage's computePlaybackView (centralised derivation)
  const isInLiveFlow =
    playbackView?.isInLiveFlow ??
    !!(speakingAgentId || thinkingState || isStreaming || sessionType);

  // Role-aware source text: userMessage overlay on top of playbackView
  const sourceText = userMessage
    ? userMessage
    : (playbackView?.sourceText ??
      (currentSpeech
        ? currentSpeech
        : isInLiveFlow
          ? ''
          : lectureSpeech || (playbackCompleted ? '' : idleText) || ''));
  const hasAgentFeedback = Boolean(playbackView?.sourceText || thinkingState);
  const prevHasAgentFeedbackRef = useRef(hasAgentFeedback);

  const clearUserMessageClearTimer = useCallback(() => {
    if (userMessageClearTimerRef.current) {
      clearTimeout(userMessageClearTimerRef.current);
      userMessageClearTimerRef.current = null;
    }
  }, []);

  const scheduleUserMessageClear = useCallback(() => {
    clearUserMessageClearTimer();
    userMessageClearTimerRef.current = setTimeout(() => {
      setUserMessage(null);
      userMessageClearTimerRef.current = null;
    }, 3000);
  }, [clearUserMessageClearTimer]);

  const showLocalUserMessage = useCallback(
    (text: string) => {
      setUserMessage(text);
      // Mark as "already seen feedback" so that the immediate thinkingState
      // transition (false→true) after user sends won't trigger the early-clear
      // effect and swallow the user bubble.
      prevHasAgentFeedbackRef.current = true;
      scheduleUserMessageClear();
    },
    [scheduleUserMessageClear],
  );

  // Clear user message early when agent starts responding
  useEffect(() => {
    const feedbackStarted = hasAgentFeedback && !prevHasAgentFeedbackRef.current;
    if (userMessage && feedbackStarted) {
      clearUserMessageClearTimer();
      setUserMessage(null);
    }
    prevHasAgentFeedbackRef.current = hasAgentFeedback;
  }, [clearUserMessageClearTimer, hasAgentFeedback, userMessage]);

  useEffect(() => () => clearUserMessageClearTimer(), [clearUserMessageClearTimer]);

  // End flash effect (Issue 3)
  useEffect(() => {
    if (showEndFlash) {
      setEndFlashVisible(true);
      const timer = setTimeout(() => setEndFlashVisible(false), 1800);
      return () => clearTimeout(timer);
    } else {
      setEndFlashVisible(false);
    }
  }, [showEndFlash]);

  // Clear send cooldown when agent bubble appears
  useEffect(() => {
    if (isSendCooldown && speakingAgentId) {
      setIsSendCooldown(false);
      isSendCooldownRef.current = false;
    }
  }, [isSendCooldown, speakingAgentId]);

  // Safety net: clear cooldown when streaming transitions from active → ended
  // (not when isStreaming was already false — that would clear cooldown immediately)
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && isSendCooldown) {
      setIsSendCooldown(false);
      isSendCooldownRef.current = false;
    }
    prevStreamingRef.current = !!isStreaming;
  }, [isStreaming, isSendCooldown]);

  // Separate participants by role (teacherParticipant & studentParticipants declared earlier for effect)
  const userParticipant = initialParticipants.find((p) => p.role === 'user');

  const teacherAvatar = teacherParticipant?.avatar || DEFAULT_TEACHER_AVATAR;
  const teacherName = teacherParticipant?.name || t('roundtable.teacher');
  const userAvatar = userParticipant?.avatar || DEFAULT_USER_AVATAR;

  // Audio recording
  const { isRecording, isProcessing, startRecording, stopRecording, cancelRecording } =
    useAudioRecorder({
      onTranscription: (text) => {
        if (!text.trim()) {
          toast.info(t('roundtable.noSpeechDetected'));
          setIsVoiceOpen(false);
          return;
        }
        // Block if in send cooldown (e.g. text was sent while voice was processing)
        if (isSendCooldownRef.current) {
          setIsVoiceOpen(false);
          return;
        }
        showLocalUserMessage(text);
        onMessageSend?.(text);
        setIsSendCooldown(true);
        isSendCooldownRef.current = true;
        setIsVoiceOpen(false);
      },
      onError: (error) => {
        toast.error(error);
        setIsVoiceOpen(false);
      },
    });

  const handleSendMessage = () => {
    if (!inputValue.trim() || isSendCooldown) return;

    showLocalUserMessage(inputValue);
    onMessageSend?.(inputValue);
    setIsSendCooldown(true);
    isSendCooldownRef.current = true;
    setInputValue('');
    setIsInputOpen(false);
  };

  const handleToggleInput = () => {
    if (isSendCooldown) return;
    if (!isInputOpen) {
      onInputActivate?.();
    }
    setIsInputOpen(!isInputOpen);
    // Cancel any in-flight ASR to prevent ghost auto-sends
    if (isVoiceOpen || isProcessing) {
      cancelRecording();
      setIsVoiceOpen(false);
    }
  };

  const handleToggleVoice = () => {
    if (isVoiceOpen) {
      if (isRecording) {
        stopRecording();
      }
      setIsVoiceOpen(false);
    } else {
      if (isSendCooldown || isProcessing) return;
      onInputActivate?.();
      setIsVoiceOpen(true);
      setIsInputOpen(false);
      startRecording();
    }
  };

  // Keyboard shortcuts for roundtable interaction (#255)
  // T = toggle text input, V = toggle voice input, Escape = dismiss panels,
  // Space = discussion pause/resume (during live flow)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape should always work, even when typing in an input
      if (e.key === 'Escape') {
        if (isInputOpen || isVoiceOpen) {
          e.preventDefault();
          e.stopPropagation(); // Prevent fullscreen exit when panels are open
          setIsInputOpen(false);
          setIsVoiceOpen(false);
          if (isRecording || isProcessing) cancelRecording();
        }
        return;
      }

      // Skip other shortcuts when user is typing in an input, textarea, or contentEditable
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) {
        return;
      }

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          // Only handle during live flow (QA/Discussion)
          if (!isInLiveFlow) return;
          e.preventDefault(); // Prevent page scroll
          if (isDiscussionPaused) {
            onDiscussionResume?.();
          } else if (!thinkingState && currentSpeech) {
            // Same guard as bubble click: don't pause during thinking or before text arrives
            onDiscussionPause?.();
          }
          break;

        case 't':
        case 'T':
          e.preventDefault();
          handleToggleInput();
          break;

        case 'v':
        case 'V':
          e.preventDefault();
          if (asrEnabled) handleToggleVoice();
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isInLiveFlow,
    isDiscussionPaused,
    thinkingState,
    currentSpeech,
    onDiscussionPause,
    onDiscussionResume,
    asrEnabled,
    isInputOpen,
    isVoiceOpen,
    isRecording,
    isProcessing,
  ]);

  const isPresentationInteractionActive = isInputOpen || isVoiceOpen || isRecording || isProcessing;

  useEffect(() => {
    onPresentationInteractionChange?.(isPresentationInteractionActive);

    return () => {
      if (isPresentationInteractionActive) {
        onPresentationInteractionChange?.(false);
      }
    };
  }, [isPresentationInteractionActive, onPresentationInteractionChange]);

  // Determine active speaking state and bubble ownership
  // Check if current speaker is a student agent (not teacher)
  const speakingStudent = speakingAgentId
    ? studentParticipants.find((s) => s.id === speakingAgentId)
    : null;

  // Bubble loading: speakingAgentId is set (agent_start fired) but text hasn't arrived yet
  const isBubbleLoading = !!(speakingAgentId && !currentSpeech && !userMessage);
  // Student agent specifically loading (for agent-style bubble)
  const isAgentLoading = !!(speakingStudent && !currentSpeech && !userMessage);

  const activeRole: 'teacher' | 'user' | 'agent' | null = userMessage
    ? 'user'
    : (playbackView?.activeRole ??
      (currentSpeech && speakingStudent
        ? 'agent'
        : currentSpeech
          ? 'teacher'
          : isAgentLoading
            ? 'agent'
            : isBubbleLoading
              ? 'teacher'
              : isCueUser
                ? null
                : lectureSpeech
                  ? 'teacher'
                  : null));

  const bubbleRole: 'teacher' | 'user' | 'agent' | null = userMessage
    ? 'user'
    : (playbackView?.bubbleRole ??
      (currentSpeech && speakingStudent
        ? 'agent'
        : currentSpeech
          ? 'teacher'
          : isAgentLoading
            ? 'agent'
            : isBubbleLoading
              ? 'teacher'
              : isInLiveFlow
                ? null
                : isCueUser
                  ? null
                  : lectureSpeech || idleText
                    ? 'teacher'
                    : null));

  const bubbleName =
    bubbleRole === 'agent'
      ? speakingStudent?.name || t('settings.agentRoles.student')
      : bubbleRole === 'teacher'
        ? teacherName
        : bubbleRole === 'user'
          ? t('roundtable.you')
          : '';

  // Stable key based on speaker identity, NOT text content (prevents re-mount flicker)
  const bubbleKey =
    bubbleRole === 'user'
      ? 'user'
      : bubbleRole === 'agent'
        ? `agent-${speakingAgentId}`
        : bubbleRole === 'teacher'
          ? 'teacher'
          : 'idle';

  // Enriched playbackView that includes userMessage overlay for bubbleRole/sourceText
  const enrichedPlaybackView: PlaybackView = playbackView
    ? { ...playbackView, bubbleRole, sourceText, activeRole: activeRole ?? playbackView.activeRole }
    : {
        phase: 'idle' as const,
        sourceText,
        bubbleRole,
        activeRole,
        buttonState: 'none' as const,
        isInLiveFlow: false,
        isTopicActive: false,
      };

  // Show stop button whenever there's an active QA/discussion session or live mode.
  // sessionType is only cleared in doSessionCleanup, so this stays stable through
  // brief loading gaps (e.g. between user message and agent SSE response).
  const showStopButton =
    engineMode === 'live' || sessionType === 'qa' || sessionType === 'discussion';

  const handleCycleSpeed = useCallback(() => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed as (typeof PLAYBACK_SPEEDS)[number]);
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
    setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
  }, [playbackSpeed, setPlaybackSpeed]);

  // Intentionally non-reactive: agent metadata is treated as immutable during a classroom session.
  const agentRegistry = useAgentRegistry.getState();
  const getAgentConfig = (id: string) => agentRegistry.getAgent(id);

  const presentationDiscussionParticipant = discussionRequest
    ? discussionRequest.agentId === teacherParticipant?.id
      ? teacherParticipant || null
      : studentParticipants.find((student) => student.id === discussionRequest.agentId) || null
    : null;
  const presentationDiscussionAgentConfig = discussionRequest
    ? getAgentConfig(discussionRequest.agentId || '')
    : null;

  const handlePresentationBubbleClick = useCallback(() => {
    if (isTopicPending) {
      onResumeTopic?.();
      return;
    }
    if (isInLiveFlow) {
      if (isDiscussionPaused) {
        onDiscussionResume?.();
      } else if (!thinkingState && currentSpeech) {
        onDiscussionPause?.();
      }
      return;
    }
    onPlayPause?.();
  }, [
    isTopicPending,
    isInLiveFlow,
    isDiscussionPaused,
    thinkingState,
    currentSpeech,
    onResumeTopic,
    onDiscussionResume,
    onDiscussionPause,
    onPlayPause,
  ]);
  const showPresentationDock =
    !isPresenting ||
    !!controlsVisible ||
    !!discussionRequest ||
    isCueUser ||
    isInputOpen ||
    isVoiceOpen ||
    isRecording ||
    isProcessing;
  const toolbar = (
    <CanvasToolbar
      className="shrink-0 min-h-[32px] py-1 w-full px-3 border-b border-gray-100/40 dark:border-gray-700/30"
      currentSceneIndex={currentSceneIndex}
      scenesCount={scenesCount}
      engineState={
        engineMode === 'playing' || engineMode === 'live'
          ? 'playing'
          : engineMode === 'paused'
            ? 'paused'
            : 'idle'
      }
      isLiveSession={isStreaming || isTopicPending || engineMode === 'live'}
      whiteboardOpen={whiteboardOpen}
      sidebarCollapsed={sidebarCollapsed}
      chatCollapsed={chatCollapsed}
      onToggleSidebar={onToggleSidebar}
      onToggleChat={onToggleChat}
      onPrevSlide={onPrevSlide ?? (() => {})}
      onNextSlide={onNextSlide ?? (() => {})}
      onPlayPause={onPlayPause ?? (() => {})}
      onWhiteboardClose={onWhiteboardClose ?? (() => {})}
      isPresenting={isPresenting}
      onTogglePresentation={onTogglePresentation}
      showStopDiscussion={showStopButton}
      onStopDiscussion={onStopDiscussion}
      ttsEnabled={ttsEnabled}
      ttsMuted={ttsMuted}
      ttsVolume={ttsVolume}
      onToggleMute={() => ttsEnabled && setTTSMuted(!ttsMuted)}
      onVolumeChange={(v) => setTTSVolume(v)}
      autoPlayLecture={autoPlayLecture}
      onToggleAutoPlay={() => setAutoPlayLecture(!autoPlayLecture)}
      playbackSpeed={playbackSpeed}
      onCycleSpeed={handleCycleSpeed}
      onRegenerateScene={onRegenerateScene}
    />
  );

  return (
    <div className="h-0 w-full relative z-10 overflow-visible">
        {/* Speech overlay — fills the full stage area via absolute positioning */}
        <PresentationSpeechOverlay
          playbackView={enrichedPlaybackView}
          participants={initialParticipants}
          speakingAgentId={speakingAgentId ?? null}
          isTopicPending={!!isTopicPending}
          side="left"
          onBubbleClick={handlePresentationBubbleClick}
          audioIndicatorState={audioIndicatorState ?? 'idle'}
          buttonState={enrichedPlaybackView?.buttonState}
          isPaused={isDiscussionPaused || engineMode === 'paused'}
        />

        {/* Click-outside backdrop to dismiss input/voice */}
        {(isInputOpen || isVoiceOpen) && (
          <div
            className="fixed top-0 left-0 right-0 bottom-14 z-[45] pointer-events-auto"
            onClick={() => {
              setIsInputOpen(false);
              setIsVoiceOpen(false);
              cancelRecording();
            }}
          />
        )}

        {/* ── Toolbar — pinned to bottom of screen ── */}
        <div
          className={cn(
            'fixed bottom-0 left-0 z-[40] pointer-events-none flex items-center justify-center transition-all duration-300',
            controlsVisible || !isPresenting
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-2',
          )}
          style={{ right: chatCollapsed === false ? (chatAreaWidth ?? 320) : 0 }}
        >
          <div className="mb-3 px-2 py-1.5 rounded-[1.5rem] bg-white/70 dark:bg-black/60 backdrop-blur-xl border border-gray-200/60 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] pointer-events-auto max-w-[calc(100vw-1rem)] lg:max-w-[calc(100%-2rem)]">
            {toolbar}
          </div>
        </div>

        {/* ── End flash notification ── */}
        <AnimatePresence>
          {endFlashVisible && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{
                opacity: [0, 1, 1, 0],
                y: [10, 0, 0, 6],
                scale: [0.9, 1, 1, 0.95],
              }}
              transition={{
                duration: 1.8,
                times: [0, 0.15, 0.7, 1],
                ease: 'easeOut',
              }}
              className="fixed bottom-20 -translate-x-1/2 z-[50] bg-gray-100/80 dark:bg-gray-800/80 backdrop-blur-md text-gray-700 dark:text-white px-3.5 py-1.5 rounded-full text-xs font-medium pointer-events-none"
              style={{
                left: `calc((100vw - ${chatCollapsed === false ? (chatAreaWidth ?? 320) : 0}px) / 2)`,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block mr-1.5" />
              {endFlashSessionType === 'discussion'
                ? t('roundtable.discussionEnded')
                : t('roundtable.qaEnded')}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Center stack: input / voice / thinking — anchored above toolbar ── */}
        <div
          className="fixed bottom-14 left-0 z-[50] flex flex-col items-center justify-center gap-3 pointer-events-none transition-[right] duration-300"
          style={{ right: chatCollapsed === false ? (chatAreaWidth ?? 320) : 0 }}
        >
          {/* Input panel */}
          <AnimatePresence>
            {isInputOpen && (
              <motion.div
                key="presentation-input-stage"
                initial={{ opacity: 0, scale: 0.95, y: 15, filter: 'blur(4px)' }}
                animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.95, y: 15, filter: 'blur(4px)' }}
                className="w-[min(480px,calc(100vw-3rem))] pointer-events-auto"
              >
                <div className="flex items-center gap-3 bg-white/70 dark:bg-black/60 backdrop-blur-xl rounded-full px-4 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] border border-gray-200/60 dark:border-white/10">
                  <div className="flex-1 min-w-0 flex items-center">
                    <textarea
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder={t('roundtable.inputPlaceholder')}
                      autoFocus
                      rows={1}
                      className="w-full resize-none bg-transparent border-none focus:ring-0 focus:outline-none outline-none shadow-none ring-0 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 dark:placeholder:text-gray-400 py-0 leading-[40px] max-h-[80px]"
                      style={{ fieldSizing: 'content' } as Record<string, string>}
                    />
                  </div>
                  <button
                    onClick={handleSendMessage}
                    disabled={isSendCooldown}
                    className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0',
                      isSendCooldown
                        ? 'bg-gray-500/50 cursor-not-allowed'
                        : 'bg-purple-600 hover:bg-purple-700 shadow-[0_4px_16px_rgba(147,51,234,0.3)]',
                    )}
                  >
                    {isSendCooldown ? (
                      <Loader2 className="w-4 h-4 text-white animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 text-white" />
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Voice panel */}
          <AnimatePresence>
            {isVoiceOpen && (
              <motion.div
                key="presentation-voice-stage"
                initial={{ opacity: 0, scale: 0.9, y: 20, filter: 'blur(4px)' }}
                animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.9, y: 20, filter: 'blur(4px)' }}
                className="pointer-events-auto"
              >
                <div className="flex items-center gap-4 bg-white/70 dark:bg-black/60 backdrop-blur-xl rounded-full px-5 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] border border-gray-200/60 dark:border-white/10">
                  {/* Waveform bars */}
                  <div className="flex items-center gap-0.5 h-8">
                    <VoiceWaveformBars barClassName="bg-gradient-to-t from-purple-400 to-indigo-400" />
                  </div>
                  <span className="text-[11px] font-semibold tracking-wider text-purple-600 dark:text-purple-300 uppercase">
                    {isProcessing ? t('roundtable.processing') : t('roundtable.listening')}
                  </span>
                  {/* Mic button */}
                  <button
                    type="button"
                    aria-label={
                      isRecording ? t('roundtable.stopRecording') : t('roundtable.startRecording')
                    }
                    className="relative group cursor-pointer bg-transparent border-none p-0"
                    onClick={handleToggleVoice}
                  >
                    <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-purple-600 to-indigo-700 shadow-[0_4px_20px_rgba(147,51,234,0.3)] flex items-center justify-center group-hover:scale-105 transition-transform duration-300 border border-white/20">
                      <Mic className="w-5 h-5 text-white" />
                    </div>
                    <div className="absolute inset-0 rounded-full border-2 border-purple-500 opacity-40 animate-[ping_2s_ease-in-out_infinite]" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* "Your turn" cue prompt — clickable, opens input panel */}
          <AnimatePresence>
            {isCueUser && !bubbleRole && !thinkingState && !isInputOpen && !isVoiceOpen && (
              <motion.div
                key="presentation-cue-user"
                initial={{ opacity: 0, scale: 0.92, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 8 }}
                transition={{ duration: 0.22, ease: [0.21, 1, 0.36, 1] }}
                className="pointer-events-auto"
              >
                <button
                  onClick={() => (asrEnabled ? handleToggleVoice() : handleToggleInput())}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/70 dark:bg-black/50 backdrop-blur-xl border border-amber-400/50 dark:border-amber-500/50 shadow-[0_0_16px_rgba(245,158,11,0.2),0_8px_32px_rgba(0,0,0,0.06)] dark:shadow-[0_0_16px_rgba(245,158,11,0.25),0_8px_32px_rgba(0,0,0,0.4)] text-amber-600 dark:text-amber-400 text-sm font-semibold tracking-wide hover:bg-gray-100/80 dark:hover:bg-black/60 hover:border-amber-500/70 dark:hover:border-amber-400/70 hover:shadow-[0_0_24px_rgba(245,158,11,0.25)] dark:hover:shadow-[0_0_24px_rgba(245,158,11,0.35)] transition-all active:scale-95 animate-pulse"
                >
                  {asrEnabled ? <Mic className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                  {t('roundtable.yourTurn')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Director thinking indicator */}
          <AnimatePresence>
            {thinkingState?.stage === 'director' && !currentSpeech && !userMessage && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex items-center gap-2 px-4 py-2 bg-white/70 dark:bg-black/50 backdrop-blur-xl rounded-full border border-gray-200/60 dark:border-white/10"
              >
                <div className="flex gap-1">
                  {[0, 0.2, 0.4].map((delay) => (
                    <motion.div
                      key={delay}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ repeat: Infinity, duration: 1.2, delay }}
                      className="w-1.5 h-1.5 rounded-full bg-purple-400"
                    />
                  ))}
                </div>
                <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                  {t('roundtable.thinking')}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Right-side stack: bubble + dock — flex column, no hardcoded px ── */}
        <div
          className="fixed bottom-20 z-[48] flex flex-col items-end gap-3 pointer-events-none transition-[right] duration-300"
          style={{ right: chatCollapsed ? 20 : 20 + (chatAreaWidth ?? 320) }}
        >
          {/* Right-side speech bubble (flows above dock via flex) */}
          <PresentationSpeechOverlay
            playbackView={enrichedPlaybackView}
            participants={initialParticipants}
            speakingAgentId={speakingAgentId ?? null}
            isTopicPending={!!isTopicPending}
            userAvatar={userAvatar}
            side="right"
            onBubbleClick={handlePresentationBubbleClick}
            audioIndicatorState={audioIndicatorState ?? 'idle'}
            buttonState={enrichedPlaybackView?.buttonState}
            isPaused={isDiscussionPaused || engineMode === 'paused'}
          />

          {/* Dock */}
          <AnimatePresence>
            {showPresentationDock && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="pointer-events-auto"
              >
                <div
                  ref={presentationActionAnchorRef}
                  className="flex items-center gap-2.5 rounded-full bg-white/70 dark:bg-black/60 backdrop-blur-xl border border-gray-200/60 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] px-2.5 py-2"
                >
                  {/* Speaking / discussion-requesting agent avatar — shows when
                      a student agent is actively speaking OR a discussion request
                      is pending (so the user can see who's asking before joining) */}
                  <AnimatePresence>
                    {((activeRole === 'agent' && speakingStudent) ||
                      presentationDiscussionParticipant) && (
                      <motion.div
                        ref={presentationAgentAvatarRef}
                        key={`dock-agent-${(speakingStudent || presentationDiscussionParticipant)?.id}`}
                        initial={{ opacity: 0, scale: 0.8, width: 0 }}
                        animate={{ opacity: 1, scale: 1, width: 'auto' }}
                        exit={{ opacity: 0, scale: 0.8, width: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="shrink-0 overflow-hidden"
                      >
                        <div className="relative w-10 h-10 rounded-full flex items-center justify-center">
                          <div className="absolute inset-0 rounded-full border-2 border-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.3)] transition-all duration-300" />
                          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden relative z-10 text-lg">
                            <AvatarDisplay
                              src={
                                (speakingStudent || presentationDiscussionParticipant)?.avatar ||
                                '/avatars/user.png'
                              }
                              alt={
                                (speakingStudent || presentationDiscussionParticipant)?.name || ''
                              }
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {isSendCooldown ? (
                    <div className="flex items-center justify-center w-8 h-8">
                      <div className="flex items-center gap-[3px]">
                        {[0, 1, 2].map((i) => (
                          <motion.div
                            key={i}
                            animate={{ y: [0, -3, 0], opacity: [0.35, 0.9, 0.35] }}
                            transition={{
                              repeat: Infinity,
                              duration: 0.9,
                              delay: i * 0.12,
                              ease: 'easeInOut',
                            }}
                            className="w-[3px] h-[3px] rounded-full bg-purple-400"
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        aria-label={
                          asrEnabled
                            ? t('roundtable.voiceInput')
                            : t('roundtable.voiceInputDisabled')
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (asrEnabled) handleToggleVoice();
                        }}
                        disabled={!asrEnabled}
                        className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-95',
                          !asrEnabled
                            ? 'text-gray-500 cursor-not-allowed'
                            : isVoiceOpen
                              ? 'bg-purple-600 text-white'
                              : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-white hover:bg-gray-200/50 dark:hover:bg-white/10',
                        )}
                      >
                        {asrEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                      </button>
                      <button
                        aria-label={t('roundtable.textInput')}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleInput();
                        }}
                        className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-95',
                          isInputOpen
                            ? 'bg-purple-600 text-white'
                            : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-white hover:bg-gray-200/50 dark:hover:bg-white/10',
                        )}
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    aria-label={t('roundtable.you')}
                    className="relative group cursor-pointer shrink-0 bg-transparent border-none p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleInput();
                    }}
                  >
                    <div
                      className={cn(
                        'relative w-10 h-10 rounded-full transition-all duration-300 flex items-center justify-center',
                        activeRole === 'user' || isInputOpen || isCueUser
                          ? 'scale-105'
                          : 'opacity-70 group-hover:opacity-100 group-hover:scale-100',
                      )}
                    >
                      <div
                        className={cn(
                          'absolute inset-0 rounded-full border-2 transition-all duration-300',
                          isCueUser
                            ? 'border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.4)] animate-pulse'
                            : activeRole === 'user' || isInputOpen
                              ? 'border-purple-500 shadow-[0_0_6px_rgba(168,85,247,0.3)]'
                              : 'border-gray-300/40 dark:border-white/20 group-hover:border-purple-400/50',
                        )}
                      />
                      <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden relative z-10 text-lg">
                        <AvatarDisplay src={userAvatar} alt={t('roundtable.you')} />
                      </div>
                    </div>
                  </button>
                </div>

                <AnimatePresence>
                  {discussionRequest && (
                    <ProactiveCard
                      action={discussionRequest}
                      mode={engineMode === 'paused' ? 'paused' : 'playback'}
                      anchorRef={presentationAgentAvatarRef}
                      portalContainer={fullscreenContainerRef?.current}
                      align="left"
                      agentName={
                        presentationDiscussionParticipant?.name ||
                        presentationDiscussionAgentConfig?.name
                      }
                      agentAvatar={
                        presentationDiscussionParticipant?.avatar ||
                        presentationDiscussionAgentConfig?.avatar
                      }
                      agentColor={presentationDiscussionAgentConfig?.color}
                      onSkip={() => onDiscussionSkip?.()}
                      onListen={() => onDiscussionStart?.(discussionRequest)}
                      onTogglePause={() => onPlayPause?.()}
                    />
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
}
