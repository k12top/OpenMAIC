/**
 * Client-side sync service for persisting classroom data to the server.
 *
 * Provides debounced sync for stage/scene data, media uploads, and chat history.
 * All operations are best-effort and fail silently to avoid blocking the UI.
 */

import type { Stage, Scene } from '@/lib/types/stage';
import type { ChatSession } from '@/lib/types/chat';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClassroomSync');

const SYNC_DEBOUNCE_MS = 1500;
const CHAT_SYNC_DEBOUNCE_MS = 5000;

let _stageSyncTimer: ReturnType<typeof setTimeout> | null = null;
let _chatSyncTimer: ReturnType<typeof setTimeout> | null = null;
let _syncEnabled = true;

export function disableSync() {
  _syncEnabled = false;
}

export function enableSync() {
  _syncEnabled = true;
}

// ─── Stage + Scene sync ──────────────────────────────────────────────────────

export function syncClassroomToServer(
  classroomId: string,
  stage: Stage,
  scenes: Scene[],
  currentSceneId: string | null,
) {
  if (!_syncEnabled) return;
  if (_stageSyncTimer) clearTimeout(_stageSyncTimer);

  _stageSyncTimer = setTimeout(async () => {
    try {
      const body = JSON.stringify({
        classroomId,
        stage,
        scenes,
        currentSceneId,
      });
      const res = await fetch('/api/classroom/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // keepalive ensures the request completes even if the user navigates away
        // before the debounce timer fires (e.g. tab close right after image upload).
        keepalive: true,
        body,
      });

      if (res.ok) {
        log.info(`Synced classroom ${classroomId} to server`);
      } else {
        const data = await res.json().catch(() => ({}));
        log.warn(`Classroom sync returned ${res.status}:`, data);
      }
    } catch (err) {
      log.warn('Classroom sync failed (network):', err);
    }
  }, SYNC_DEBOUNCE_MS);
}

export function flushClassroomSync() {
  if (_stageSyncTimer) {
    clearTimeout(_stageSyncTimer);
    _stageSyncTimer = null;
  }
}

// ─── Chat session sync ──────────────────────────────────────────────────────

export function syncChatSessionsToServer(classroomId: string, sessions: ChatSession[]) {
  if (!_syncEnabled) return;
  if (_chatSyncTimer) clearTimeout(_chatSyncTimer);

  _chatSyncTimer = setTimeout(async () => {
    try {
      const payload = sessions.map((s) => ({
        id: s.id,
        sceneId: s.sceneId,
        type: s.type,
        title: s.title,
        status: s.status === 'active' ? 'interrupted' : s.status,
        messages: s.messages.slice(-200),
        config: s.config,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));

      const res = await fetch('/api/classroom/chat-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomId, sessions: payload }),
      });

      if (res.ok) {
        log.info(`Synced ${sessions.length} chat sessions for ${classroomId}`);
      } else {
        log.warn(`Chat sync returned ${res.status}`);
      }
    } catch (err) {
      log.warn('Chat sync failed (network):', err);
    }
  }, CHAT_SYNC_DEBOUNCE_MS);
}

// ─── Media upload ────────────────────────────────────────────────────────────

export async function uploadMediaToServer(
  classroomId: string,
  mediaType: 'image' | 'video' | 'audio' | 'tts',
  blob: Blob,
  filename?: string,
): Promise<{ url: string; key: string } | null> {
  if (!_syncEnabled) return null;

  try {
    const formData = new FormData();
    formData.append('classroomId', classroomId);
    formData.append('mediaType', mediaType);
    formData.append('file', blob, filename || `${mediaType}.bin`);

    const res = await fetch('/api/classroom/media', {
      method: 'POST',
      body: formData,
    });

    if (res.ok) {
      const data = await res.json();
      log.info(`Uploaded ${mediaType} for ${classroomId}: ${data.key}`);
      return { url: data.url, key: data.key };
    }

    log.warn(`Media upload returned ${res.status}`);
    return null;
  } catch (err) {
    log.warn('Media upload failed (network):', err);
    return null;
  }
}

// ─── Load from server (fallback when IndexedDB is empty) ────────────────────

export async function loadClassroomFromServer(classroomId: string): Promise<{
  stage: Stage;
  scenes: Scene[];
  currentSceneId?: string;
} | null> {
  try {
    const res = await fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`);
    if (!res.ok) return null;

    const json = await res.json();
    if (json.success && json.classroom) {
      return {
        stage: json.classroom.stage,
        scenes: json.classroom.scenes,
        currentSceneId: json.classroom.stage?.currentSceneId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function loadChatSessionsFromServer(
  classroomId: string,
): Promise<ChatSession[] | null> {
  try {
    const res = await fetch(
      `/api/classroom/chat-history?classroomId=${encodeURIComponent(classroomId)}`,
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (data.sessions?.length) {
      return data.sessions.map((s: Record<string, unknown>) => ({
        id: s.id as string,
        type: (s.type as string) || 'chat',
        title: (s.title as string) || '',
        status: (s.status as string) || 'completed',
        messages: (s.messages as unknown[]) || [],
        config: s.config || {},
        toolCalls: [],
        pendingToolCalls: [],
        createdAt: s.createdAt ? new Date(s.createdAt as string).getTime() : Date.now(),
        updatedAt: s.updatedAt ? new Date(s.updatedAt as string).getTime() : Date.now(),
        sceneId: s.sceneId as string | undefined,
      }));
    }
    return null;
  } catch {
    return null;
  }
}
