'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X, Pencil, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useMenuPerm } from '@/components/auth/menu-gate';
import { toast } from 'sonner';

interface AgentRevealModalProps {
  agents: Array<{
    id: string;
    name: string;
    role: string;
    persona: string;
    avatar: string;
    color: string;
  }>;
  open: boolean;
  onClose: () => void;
  /** Called once after all cards are revealed — signals generation can continue */
  onAllRevealed?: () => void;
  /**
   * Called when the user renames an agent in-place. Receives the agent
   * id and the new (trimmed, non-empty) display name. Parent should
   * persist the change (registry + IndexedDB + stage.generatedAgentConfigs)
   * so the new name reaches subsequent generation prompts.
   */
  onAgentRename?: (agentId: string, newName: string) => void;
}

function isUrl(str: string): boolean {
  return str.startsWith('http') || str.startsWith('/') || str.startsWith('data:');
}

/** Lighten a hex color by mixing with white */
function lighten(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `rgb(${lr},${lg},${lb})`;
}

const ROLE_ICONS: Record<string, string> = {
  teacher: '👨‍🏫',
  assistant: '🤝',
  student: '🎓',
};

export function AgentRevealModal({
  agents,
  open,
  onClose,
  onAllRevealed,
  onAgentRename,
}: AgentRevealModalProps) {
  const { t } = useI18n();
  const [revealedCount, setRevealedCount] = useState(0);
  const [flipsComplete, setFlipsComplete] = useState(false);
  const allRevealedFiredRef = useRef(false);
  const onAllRevealedRef = useRef(onAllRevealed);
  onAllRevealedRef.current = onAllRevealed;

  // Inline rename state — only one card can be edited at a time
  const canRenameAgents = useMenuPerm('settings.agents', 'operable');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Reset edit state whenever the modal closes so reopens start fresh
  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setDraftName('');
    }
  }, [open]);

  const allRevealed = revealedCount >= agents.length && agents.length > 0;

  const startEdit = (agentId: string, currentName: string) => {
    setDraftName(currentName);
    setEditingId(agentId);
  };

  const commitEdit = (agentId: string) => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      toast.error(t('agent.nameRequired'));
      return;
    }
    onAgentRename?.(agentId, trimmed);
    setEditingId(null);
  };

  useEffect(() => {
    if (!open) {
      setRevealedCount(0);
      setFlipsComplete(false);
      allRevealedFiredRef.current = false;
      return;
    }

    let i = 0;
    const startTimeout = setTimeout(() => {
      i = 1;
      setRevealedCount(1);

      if (agents.length <= 1) {
        setTimeout(() => {
          if (!allRevealedFiredRef.current) {
            allRevealedFiredRef.current = true;
            onAllRevealedRef.current?.();
          }
        }, 600);
        return;
      }

      const interval = setInterval(() => {
        i++;
        setRevealedCount(i);
        if (i >= agents.length) {
          clearInterval(interval);
          setTimeout(() => {
            if (!allRevealedFiredRef.current) {
              allRevealedFiredRef.current = true;
              onAllRevealedRef.current?.();
            }
          }, 600);
        }
      }, 500);

      return () => clearInterval(interval);
    }, 400);

    return () => clearTimeout(startTimeout);
  }, [open, agents.length]);

  // Switch from preserve-3d to flat after all flip animations complete to enable scrolling
  useEffect(() => {
    if (!allRevealed) return;
    const timer = setTimeout(() => setFlipsComplete(true), 800);
    return () => clearTimeout(timer);
  }, [allRevealed]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-zinc-100/90 backdrop-blur-sm dark:bg-black/70 dark:backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Close button */}
          {allRevealed && (
            <motion.button
              className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-black/5 text-zinc-500 backdrop-blur-sm transition-colors hover:bg-black/10 hover:text-zinc-700 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20 dark:hover:text-white"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.2 }}
              onClick={onClose}
            >
              <X className="size-5" />
            </motion.button>
          )}

          {/* Title */}
          <motion.h2
            className="mb-8 text-2xl font-bold text-zinc-800 drop-shadow-sm dark:text-white dark:drop-shadow-lg md:text-3xl"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.4 }}
          >
            <Sparkles className="mr-2 inline-block size-6 text-amber-500 dark:text-yellow-400" />
            {t('generation.agentRevealTitle')}
          </motion.h2>

          {/* Cards */}
          <div className="flex flex-wrap items-stretch justify-center gap-4 px-4 md:gap-5">
            {agents.map((agent, index) => {
              const isRevealed = index < revealedCount;
              const roleIcon = ROLE_ICONS[agent.role] ?? '🎓';

              return (
                <motion.div
                  key={agent.id}
                  className="group relative"
                  style={{ width: 196, height: 290, perspective: 900 }}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.08, duration: 0.3 }}
                >
                  <motion.div
                    className="relative size-full"
                    style={{
                      transformStyle: flipsComplete ? 'flat' : 'preserve-3d',
                    }}
                    animate={{ rotateY: isRevealed ? 0 : 180 }}
                    transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
                  >
                    {/* ====== FRONT FACE ====== */}
                    <div
                      className="absolute inset-0 overflow-clip rounded-2xl"
                      style={{ backfaceVisibility: 'hidden' }}
                    >
                      {/* Outer colored border */}
                      <div
                        className="absolute inset-0 rounded-2xl p-[2px]"
                        style={{
                          background: `linear-gradient(160deg, ${agent.color}, ${lighten(agent.color, 0.35)}, ${agent.color})`,
                        }}
                      >
                        {/* Inner card body */}
                        <div className="relative flex size-full flex-col overflow-clip rounded-[14px] bg-white dark:bg-zinc-900">
                          {/* Top gradient band with texture */}
                          <div className="relative shrink-0 overflow-hidden" style={{ height: 56 }}>
                            {/* Color gradient fill */}
                            <div
                              className="absolute inset-0"
                              style={{
                                background: `linear-gradient(135deg, ${agent.color}30 0%, ${agent.color}10 100%)`,
                              }}
                            />
                            {/* Subtle noise texture */}
                            <div
                              className="absolute inset-0 opacity-[0.04]"
                              style={{
                                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
                              }}
                            />
                            {/* Decorative corner accent lines */}
                            <svg
                              className="absolute right-0 top-0 size-16 text-white/[0.06]"
                              viewBox="0 0 64 64"
                            >
                              <line
                                x1="64"
                                y1="0"
                                x2="0"
                                y2="64"
                                stroke="currentColor"
                                strokeWidth="1"
                              />
                              <line
                                x1="64"
                                y1="16"
                                x2="16"
                                y2="64"
                                stroke="currentColor"
                                strokeWidth="1"
                              />
                              <line
                                x1="64"
                                y1="32"
                                x2="32"
                                y2="64"
                                stroke="currentColor"
                                strokeWidth="1"
                              />
                            </svg>
                          </div>

                          {/* Avatar — overlapping the band */}
                          <div className="relative z-10 -mt-7 flex justify-center">
                            <div
                              className="flex size-[50px] items-center justify-center rounded-full border-[2.5px] shadow-lg shadow-black/40"
                              style={{
                                borderColor: agent.color,
                                backgroundColor: '#f8f8fc',
                              }}
                            >
                              {isUrl(agent.avatar) ? (
                                <img
                                  src={agent.avatar}
                                  alt={agent.name}
                                  className="size-full rounded-full object-cover"
                                />
                              ) : (
                                <span className="text-2xl">
                                  {agent.avatar || agent.name.charAt(0)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Name + role row */}
                          <div className="mt-1.5 flex flex-col items-center gap-0.5 px-3">
                            {editingId === agent.id ? (
                              <div className="flex items-center gap-1 w-full max-w-[160px]">
                                <input
                                  ref={editInputRef}
                                  type="text"
                                  value={draftName}
                                  onChange={(e) => setDraftName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      commitEdit(agent.id);
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault();
                                      setEditingId(null);
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="min-w-0 flex-1 h-6 text-[13px] font-bold text-center bg-transparent border rounded px-1 outline-none focus:ring-1 focus:ring-current"
                                  style={{
                                    color: agent.color,
                                    borderColor: `${agent.color}55`,
                                  }}
                                  placeholder={t('agent.namePlaceholder')}
                                />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    commitEdit(agent.id);
                                  }}
                                  className="size-5 flex items-center justify-center rounded-full shrink-0"
                                  style={{ color: agent.color }}
                                  aria-label={t('agent.saveName')}
                                  title={t('agent.saveName')}
                                >
                                  <Check className="size-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="group flex items-center gap-1 max-w-full">
                                <h3
                                  className="max-w-full truncate text-center text-[13px] font-bold tracking-wide"
                                  style={{ color: agent.color }}
                                >
                                  {agent.name}
                                </h3>
                                {onAgentRename && allRevealed && canRenameAgents && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startEdit(agent.id, agent.name);
                                    }}
                                    className="size-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity shrink-0"
                                    style={{ color: agent.color }}
                                    aria-label={t('agent.editName')}
                                    title={t('agent.editName')}
                                  >
                                    <Pencil className="size-3" />
                                  </button>
                                )}
                              </div>
                            )}
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-px text-[10px] font-medium"
                              style={{
                                color: agent.color,
                                backgroundColor: `${agent.color}12`,
                              }}
                            >
                              <span className="text-[9px]">{roleIcon}</span>
                              {t(`settings.agentRoles.${agent.role}`)}
                            </span>
                          </div>

                          {/* Thin ornamental divider */}
                          <div className="mx-5 mt-2 flex items-center gap-2">
                            <div
                              className="h-px flex-1"
                              style={{
                                background: `linear-gradient(to right, transparent, ${agent.color}40, transparent)`,
                              }}
                            />
                            <div
                              className="size-1 rounded-full"
                              style={{ backgroundColor: `${agent.color}60` }}
                            />
                            <div
                              className="h-px flex-1"
                              style={{
                                background: `linear-gradient(to right, transparent, ${agent.color}40, transparent)`,
                              }}
                            />
                          </div>

                          {/* Persona text — fills remaining space */}
                          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 pt-1.5 pb-3">
                            <p className="text-left text-[10.5px] leading-[1.65] text-zinc-600 dark:text-zinc-400">
                              {agent.persona}
                            </p>
                          </div>

                          {/* Bottom edge glow */}
                          <div
                            className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
                            style={{
                              background: `linear-gradient(to top, ${agent.color}08, transparent)`,
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* ====== BACK FACE ====== */}
                    <div
                      className="absolute inset-0 overflow-hidden rounded-2xl"
                      style={{
                        backfaceVisibility: 'hidden',
                        transform: 'rotateY(180deg)',
                      }}
                    >
                      {/* Gradient border matching front style */}
                      <div
                        className="absolute inset-0 rounded-2xl p-[2px]"
                        style={{
                          background: 'linear-gradient(160deg, #6366f1, #a855f7, #6366f1)',
                        }}
                      >
                        <div
                          className="relative flex size-full flex-col items-center justify-center rounded-[14px]"
                          style={{
                            background:
                              'linear-gradient(145deg, #1e1b4b 0%, #312e81 40%, #1e1b4b 100%)',
                          }}
                        >
                          {/* Decorative inner border */}
                          <div className="absolute inset-3 rounded-xl border border-white/[0.08]" />
                          {/* Diamond pattern corners */}
                          <svg
                            className="absolute left-3 top-3 size-5 text-white/[0.07]"
                            viewBox="0 0 20 20"
                          >
                            <path d="M10 0 L20 10 L10 20 L0 10 Z" fill="currentColor" />
                          </svg>
                          <svg
                            className="absolute right-3 top-3 size-5 text-white/[0.07]"
                            viewBox="0 0 20 20"
                          >
                            <path d="M10 0 L20 10 L10 20 L0 10 Z" fill="currentColor" />
                          </svg>
                          <svg
                            className="absolute bottom-3 left-3 size-5 text-white/[0.07]"
                            viewBox="0 0 20 20"
                          >
                            <path d="M10 0 L20 10 L10 20 L0 10 Z" fill="currentColor" />
                          </svg>
                          <svg
                            className="absolute bottom-3 right-3 size-5 text-white/[0.07]"
                            viewBox="0 0 20 20"
                          >
                            <path d="M10 0 L20 10 L10 20 L0 10 Z" fill="currentColor" />
                          </svg>
                          {/* Center icon */}
                          <Sparkles className="size-9 text-purple-300/70" />
                          <span className="mt-1.5 text-xl font-bold text-purple-200/60">?</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              );
            })}
          </div>

          {/* Progress dots + continue */}
          <motion.div
            className="mt-6 flex flex-col items-center gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <div className="flex gap-1.5">
              {agents.map((_, index) => (
                <div
                  key={index}
                  className={cn(
                    'size-2 rounded-full transition-colors duration-300',
                    index < revealedCount
                      ? 'bg-zinc-700 dark:bg-white'
                      : 'bg-zinc-300 dark:bg-white/30',
                  )}
                />
              ))}
            </div>

            {allRevealed && (
              <motion.button
                className="rounded-full bg-zinc-800 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white/15 dark:hover:bg-white/25"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.3 }}
                onClick={onClose}
              >
                {t('generation.continue')}
              </motion.button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
