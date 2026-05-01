import { create } from 'zustand';
import type { Stage, Scene, StageMode, SlideContent } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import type { PPTImageElement, PPTVideoElement } from '@/lib/types/slides';
import { createSelectors } from '@/lib/utils/create-selectors';
import type { ChatSession } from '@/lib/types/chat';
import type { SceneOutline } from '@/lib/types/generation';
import { createLogger } from '@/lib/logger';

const log = createLogger('StageStore');

/** Virtual scene ID used when the user navigates to a page still being generated */
export const PENDING_SCENE_ID = '__pending__';

// ==================== Debounce Helper ====================

/**
 * Debounce function to limit how often a function is called
 * @param func Function to debounce
 * @param delay Delay in milliseconds
 */
function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delay);
  };
}

type ToolbarState = 'design' | 'ai';

interface StageState {
  // Stage info
  stage: Stage | null;

  // Scenes
  scenes: Scene[];
  currentSceneId: string | null;

  // Chats
  chats: ChatSession[];

  // Mode
  mode: StageMode;

  // UI state
  toolbarState: ToolbarState;

  // Transient generation state (not persisted)
  generatingOutlines: SceneOutline[];

  // Persisted outlines for resume-on-refresh
  outlines: SceneOutline[];

  // Transient generation tracking (not persisted)
  generationEpoch: number;
  generationStatus: 'idle' | 'generating' | 'paused' | 'completed' | 'error';
  currentGeneratingOrder: number;
  failedOutlines: SceneOutline[];
  creditsInsufficient: boolean;

  /**
   * Buffer for media element src updates that arrived before the scene was added.
   * Maps elementId → final URL. Applied automatically when addScene is called.
   * Not persisted.
   */
  pendingMediaUrls: Record<string, string>;

  /**
   * Whether the current viewer owns the loaded classroom. Gates owner-only
   * UI (e.g. regenerate-scene button in the sidebar). Not persisted; set from
   * the server `/api/classroom` response, forced to `false` on share pages.
   */
  isOwner: boolean;

  /**
   * Whether the Stage is being rendered inside a public /share/[token] page
   * (any mode: public / readonly / editable). Used to hide navigation UI
   * (back-to-home button, credits badge, etc.) that only makes sense for the
   * owner on their own classroom page. Not persisted.
   */
  isSharedView: boolean;

  /**
   * IDs of scenes currently being regenerated in place. The old scene stays
   * in the list (and remains the current page) while a new one is produced
   * in the background; on success we swap in-place via `replaceScene`, on
   * failure we simply clear the flag and the original content is untouched.
   * Not persisted.
   */
  regeneratingSceneIds: string[];

  // Actions
  setStage: (stage: Stage) => void;
  setScenes: (scenes: Scene[]) => void;
  addScene: (scene: Scene) => void;
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  deleteScene: (sceneId: string) => void;
  /**
   * Reorder scenes according to the given list of scene ids. Scenes not
   * present in the list are appended in their existing order. Rewrites
   * each scene's `order` field to 1..N so future mutations respect the
   * new sequence. Triggers `debouncedSave` to persist.
   */
  reorderScenes: (orderedIds: string[]) => void;
  setCurrentSceneId: (sceneId: string | null) => void;
  setChats: (chats: ChatSession[]) => void;
  setMode: (mode: StageMode) => void;
  setToolbarState: (state: ToolbarState) => void;
  setGeneratingOutlines: (outlines: SceneOutline[]) => void;
  setOutlines: (outlines: SceneOutline[]) => void;
  setGenerationStatus: (status: 'idle' | 'generating' | 'paused' | 'completed' | 'error') => void;
  setCurrentGeneratingOrder: (order: number) => void;
  bumpGenerationEpoch: () => void;
  addFailedOutline: (outline: SceneOutline) => void;
  clearFailedOutlines: () => void;
  retryFailedOutline: (outlineId: string) => void;
  setCreditsInsufficient: (value: boolean) => void;
  updateSpeechActionAudioUrl: (audioId: string, url: string) => void;
  /**
   * Patch a speech action's fields (audioId-keyed). Use to update
   * `audioTextHash`, clear `audioUrl`, etc. without disturbing siblings.
   */
  updateSpeechAction: (audioId: string, partial: Partial<SpeechAction>) => void;
  /**
   * Update a speech action's text by audioId. Does not clear the cached
   * audioTextHash — staleness is computed by comparing the hash to the
   * current text on the read side (see `isSpeechAudioStale`).
   */
  updateSpeechActionText: (audioId: string, text: string) => void;
  /** Replace a placeholder media elementId with its persisted cloud URL across all scenes */
  updateMediaElementSrc: (elementId: string, url: string) => void;

  /**
   * Atomically replace a scene by id with a new one, preserving array index
   * (so sidebar order doesn't drift). If the old scene was current, the new
   * scene becomes current. Used by the regenerate-scene flow.
   */
  replaceScene: (oldSceneId: string, newScene: Scene) => void;
  setSceneRegenerating: (sceneId: string, regenerating: boolean) => void;

  // Getters
  getCurrentScene: () => Scene | null;
  getSceneById: (sceneId: string) => Scene | null;
  getSceneIndex: (sceneId: string) => number;

  // Storage
  saveToStorage: () => Promise<void>;
  loadFromStorage: (stageId: string) => Promise<void>;
  clearStore: () => void;

  // Ownership
  setIsOwner: (isOwner: boolean) => void;
  setIsSharedView: (isSharedView: boolean) => void;

  /**
   * Toggle lecture-mode on the current stage. Persists via debouncedSave so
   * the setting survives refresh and syncs to the cloud for share viewers.
   * No-op when no stage is loaded.
   */
  setLectureMode: (value: boolean) => void;
}

const useStageStoreBase = create<StageState>()((set, get) => ({
  // Initial state
  stage: null,
  scenes: [],
  currentSceneId: null,
  chats: [],
  mode: 'playback',
  toolbarState: 'ai',
  generatingOutlines: [],
  outlines: [],
  generationEpoch: 0,
  generationStatus: 'idle' as const,
  currentGeneratingOrder: -1,
  failedOutlines: [],
  creditsInsufficient: false,
  pendingMediaUrls: {},
  isOwner: false,
  isSharedView: false,
  regeneratingSceneIds: [],

  // Actions
  setStage: (stage) => {
    set((s) => ({
      stage,
      scenes: [],
      currentSceneId: null,
      chats: [],
      generationEpoch: s.generationEpoch + 1,
    }));
    debouncedSave();
  },

  setScenes: (scenes) => {
    set({ scenes });
    // Auto-select first scene if no current scene
    if (!get().currentSceneId && scenes.length > 0) {
      set({ currentSceneId: scenes[0].id });
    }
    debouncedSave();
  },

  addScene: (scene) => {
    const currentStage = get().stage;
    // Ignore scenes from different stages (prevents race condition during generation)
    if (!currentStage || scene.stageId !== currentStage.id) {
      log.warn(
        `Ignoring scene "${scene.title}" - stageId mismatch (scene: ${scene.stageId}, current: ${currentStage?.id})`,
      );
      return;
    }

    // Apply any media URLs that arrived before this scene was in the store
    const { pendingMediaUrls } = get();
    let patchedScene = scene;
    if (
      Object.keys(pendingMediaUrls).length > 0 &&
      scene.content?.type === 'slide'
    ) {
      const slideContent = scene.content as SlideContent;
      const canvas = slideContent.canvas;
      if (canvas?.elements) {
        let anyPatched = false;
        const elements = canvas.elements.map((el) => {
          if (
            (el.type === 'image' || el.type === 'video') &&
            typeof (el as PPTImageElement | PPTVideoElement).src === 'string' &&
            pendingMediaUrls[(el as PPTImageElement | PPTVideoElement).src]
          ) {
            anyPatched = true;
            return {
              ...el,
              src: pendingMediaUrls[(el as PPTImageElement | PPTVideoElement).src],
            };
          }
          return el;
        });
        if (anyPatched) {
          patchedScene = {
            ...scene,
            content: {
              ...slideContent,
              canvas: { ...canvas, elements },
            } as SlideContent,
          };
          log.info(`Applied ${Object.keys(pendingMediaUrls).length} pending media URL(s) to scene "${scene.title}"`);
        }
      }
    }

    // Insert by `order` so regenerated scenes land back in their original slot
    // (regenerate = deleteScene + addScene; without this, the new scene would
    // be pushed to the end and the sidebar / nav indices would drift). Normal
    // sequential generation still behaves as append because the new scene's
    // order is always strictly greater than any existing scene's order.
    const existing = get().scenes;
    const insertIdx = existing.findIndex((s) => s.order > patchedScene.order);
    const scenes =
      insertIdx === -1
        ? [...existing, patchedScene]
        : [...existing.slice(0, insertIdx), patchedScene, ...existing.slice(insertIdx)];
    // Remove the matching outline from generatingOutlines (match by order)
    const generatingOutlines = get().generatingOutlines.filter((o) => o.order !== scene.order);
    // Auto-switch from pending page to the newly generated scene
    const shouldSwitch = get().currentSceneId === PENDING_SCENE_ID;
    set({
      scenes,
      generatingOutlines,
      ...(shouldSwitch ? { currentSceneId: patchedScene.id } : {}),
    });
    debouncedSave();
  },

  updateScene: (sceneId, updates) => {
    const scenes = get().scenes.map((scene) =>
      scene.id === sceneId ? { ...scene, ...updates } : scene,
    );
    set({ scenes });
    debouncedSave();
  },

  deleteScene: (sceneId) => {
    const scenes = get().scenes.filter((scene) => scene.id !== sceneId);
    const currentSceneId = get().currentSceneId;

    // If deleted scene was current, select next or previous
    if (currentSceneId === sceneId) {
      const index = get().getSceneIndex(sceneId);
      const newIndex = index < scenes.length ? index : scenes.length - 1;
      set({
        scenes,
        currentSceneId: scenes[newIndex]?.id || null,
      });
    } else {
      set({ scenes });
    }
    debouncedSave();
  },

  reorderScenes: (orderedIds) => {
    const current = get().scenes;
    if (current.length === 0) return;

    const byId = new Map(current.map((s) => [s.id, s]));
    const reordered: Scene[] = [];
    for (const id of orderedIds) {
      const s = byId.get(id);
      if (s) {
        reordered.push(s);
        byId.delete(id);
      }
    }
    // Append any scenes that weren't in the provided list (defensive)
    for (const remaining of byId.values()) {
      reordered.push(remaining);
    }

    // Rewrite order fields to 1..N
    const withOrder = reordered.map((s, i) => ({ ...s, order: i + 1 }));
    set({ scenes: withOrder });
    debouncedSave();
  },

  setCurrentSceneId: (sceneId) => {
    set({ currentSceneId: sceneId });
    debouncedSave();
  },

  setChats: (chats) => {
    set({ chats });
    debouncedSave();
  },

  setMode: (mode) => set({ mode }),

  setToolbarState: (toolbarState) => set({ toolbarState }),

  setGeneratingOutlines: (generatingOutlines) => set({ generatingOutlines }),

  setOutlines: (outlines) => {
    set({ outlines });
    // Persist outlines to IndexedDB
    const stageId = get().stage?.id;
    if (stageId) {
      import('@/lib/utils/database').then(({ db }) => {
        db.stageOutlines.put({
          stageId,
          outlines,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });
    }
  },

  setGenerationStatus: (generationStatus) => set({ generationStatus }),

  setCurrentGeneratingOrder: (currentGeneratingOrder) => set({ currentGeneratingOrder }),

  bumpGenerationEpoch: () => set((s) => ({ generationEpoch: s.generationEpoch + 1 })),

  addFailedOutline: (outline) => {
    const existed = get().failedOutlines.some((o) => o.id === outline.id);
    if (existed) return;
    set({ failedOutlines: [...get().failedOutlines, outline] });
  },

  clearFailedOutlines: () => set({ failedOutlines: [] }),

  retryFailedOutline: (outlineId) => {
    set({
      failedOutlines: get().failedOutlines.filter((o) => o.id !== outlineId),
    });
  },

  setCreditsInsufficient: (value) => set({ creditsInsufficient: value }),

  updateSpeechActionAudioUrl: (audioId, url) => {
    get().updateSpeechAction(audioId, { audioUrl: url });
  },

  updateSpeechAction: (audioId, partial) => {
    const { scenes } = get();
    for (const scene of scenes) {
      const actions = scene.actions || [];
      if (
        actions.some(
          (a) => a.type === 'speech' && (a as SpeechAction).audioId === audioId,
        )
      ) {
        const updated = actions.map((a) => {
          if (a.type === 'speech' && (a as SpeechAction).audioId === audioId) {
            return { ...(a as SpeechAction), ...partial } as SpeechAction;
          }
          return a;
        });
        get().updateScene(scene.id, { actions: updated });
        break;
      }
    }
  },

  updateSpeechActionText: (audioId, text) => {
    get().updateSpeechAction(audioId, { text });
  },

  updateMediaElementSrc: (elementId, url) => {
    const { scenes } = get();
    let changed = false;
    const updated = scenes.map((scene) => {
      if (scene.content?.type !== 'slide') return scene;
      const slideContent = scene.content as SlideContent;
      const canvas = slideContent.canvas;
      if (!canvas?.elements) return scene;

      let slideChanged = false;
      const elements = canvas.elements.map((el) => {
        if (
          (el.type === 'image' || el.type === 'video') &&
          (el as PPTImageElement | PPTVideoElement).src === elementId
        ) {
          slideChanged = true;
          return { ...el, src: url };
        }
        return el;
      });

      if (slideChanged) {
        changed = true;
        return {
          ...scene,
          content: {
            ...slideContent,
            canvas: { ...canvas, elements },
          } as SlideContent,
        };
      }
      return scene;
    });
    if (changed) {
      set({ scenes: updated });
      // Use immediate save (not debounced) so the URL reaches IndexedDB/server promptly
      useStageStoreBase.getState().saveToStorage();
    } else {
      // Scene not yet in store (media and scene generation run in parallel).
      // Buffer the URL so addScene can patch it in when the scene arrives.
      log.info(`Scene for element "${elementId}" not yet loaded — buffering URL for later patching`);
      set((s) => ({ pendingMediaUrls: { ...s.pendingMediaUrls, [elementId]: url } }));
    }
  },

  // Getters
  getCurrentScene: () => {
    const { scenes, currentSceneId } = get();
    if (!currentSceneId) return null;
    return scenes.find((s) => s.id === currentSceneId) || null;
  },

  getSceneById: (sceneId) => {
    return get().scenes.find((s) => s.id === sceneId) || null;
  },

  getSceneIndex: (sceneId) => {
    return get().scenes.findIndex((s) => s.id === sceneId);
  },

  // Storage methods
  saveToStorage: async () => {
    const { stage, scenes, currentSceneId, chats } = get();
    if (!stage?.id) {
      log.warn('Cannot save: stage.id is required');
      return;
    }

    try {
      const { saveStageData } = await import('@/lib/utils/stage-storage');
      await saveStageData(stage.id, {
        stage,
        scenes,
        currentSceneId,
        chats,
      });

      // Best-effort cloud sync (fire-and-forget)
      try {
        const { syncClassroomToServer, syncChatSessionsToServer } = await import(
          '@/lib/sync/classroom-sync'
        );
        syncClassroomToServer(stage.id, stage, scenes, currentSceneId);
        if (chats.length > 0) {
          syncChatSessionsToServer(stage.id, chats);
        }
      } catch {
        // Sync failure should never block local save
      }
    } catch (error) {
      log.error('Failed to save to storage:', error);
    }
  },

  loadFromStorage: async (stageId: string) => {
    try {
      // Skip IndexedDB load if the store already has this stage with scenes
      // (e.g. navigated from generation-preview with fresh in-memory data)
      const currentState = get();
      if (currentState.stage?.id === stageId && currentState.scenes.length > 0) {
        log.info('Stage already loaded in memory, skipping IndexedDB load:', stageId);
        return;
      }

      const { loadStageData } = await import('@/lib/utils/stage-storage');
      const data = await loadStageData(stageId);

      // Load outlines for resume-on-refresh
      const { db } = await import('@/lib/utils/database');
      const outlinesRecord = await db.stageOutlines.get(stageId);
      const outlines = outlinesRecord?.outlines || [];

      if (data) {
        set({
          stage: data.stage,
          scenes: data.scenes,
          currentSceneId: data.currentSceneId,
          chats: data.chats,
          outlines,
          // Compute generatingOutlines from persisted outlines minus completed scenes
          generatingOutlines: outlines.filter((o) => !data.scenes.some((s) => s.order === o.order)),
        });
        log.info('Loaded from storage:', stageId);
      } else {
        log.warn('No data found for stage:', stageId);
      }
    } catch (error) {
      log.error('Failed to load from storage:', error);
      throw error;
    }
  },

  clearStore: () => {
    set((s) => ({
      stage: null,
      scenes: [],
      currentSceneId: null,
      chats: [],
      outlines: [],
      generationEpoch: s.generationEpoch + 1,
      generationStatus: 'idle' as const,
      currentGeneratingOrder: -1,
      failedOutlines: [],
      generatingOutlines: [],
      creditsInsufficient: false,
      pendingMediaUrls: {},
      isOwner: false,
      isSharedView: false,
      regeneratingSceneIds: [],
    }));
    log.info('Store cleared');
  },

  setIsOwner: (isOwner) => set({ isOwner }),
  setIsSharedView: (isSharedView) => set({ isSharedView }),

  setLectureMode: (value) => {
    const { stage } = get();
    if (!stage) return;
    set({ stage: { ...stage, lectureMode: value } });
    debouncedSave();
  },

  /**
   * Swap a scene with a new one atomically at the same array position.
   * This is the *only* correct way to update a scene after regeneration —
   * callers that delete-then-add would otherwise push the new scene to the
   * end (losing page order) and briefly drop the current page entirely.
   */
  replaceScene: (oldSceneId, newScene) => {
    const { scenes, currentSceneId, regeneratingSceneIds } = get();
    const idx = scenes.findIndex((s) => s.id === oldSceneId);
    if (idx === -1) {
      log.warn(`replaceScene: scene ${oldSceneId} not found, appending instead`);
      set({ scenes: [...scenes, newScene] });
      debouncedSave();
      return;
    }
    const nextScenes = [
      ...scenes.slice(0, idx),
      newScene,
      ...scenes.slice(idx + 1),
    ];
    set({
      scenes: nextScenes,
      // If the replaced scene was the active one, move selection to the new scene
      ...(currentSceneId === oldSceneId ? { currentSceneId: newScene.id } : {}),
      // Clear the regenerating flag for both the old and new ids (new id is
      // different because generation assigns a fresh uuid).
      regeneratingSceneIds: regeneratingSceneIds.filter(
        (id) => id !== oldSceneId && id !== newScene.id,
      ),
    });
    debouncedSave();
  },

  setSceneRegenerating: (sceneId, regenerating) => {
    const { regeneratingSceneIds } = get();
    const has = regeneratingSceneIds.includes(sceneId);
    if (regenerating && !has) {
      set({ regeneratingSceneIds: [...regeneratingSceneIds, sceneId] });
    } else if (!regenerating && has) {
      set({ regeneratingSceneIds: regeneratingSceneIds.filter((id) => id !== sceneId) });
    }
  },
}));

export const useStageStore = createSelectors(useStageStoreBase);

// ==================== Debounced Save ====================

/**
 * Debounced version of saveToStorage to prevent excessive writes
 * Waits 500ms after the last change before saving
 */
const debouncedSave = debounce(() => {
  useStageStore.getState().saveToStorage();
}, 500);
