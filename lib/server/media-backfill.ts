/**
 * Server-side backfill of MinIO-uploaded media into scene content.
 *
 * Background: the client uploads generated images / audio to MinIO asynchronously.
 * If the user closes the tab (or shares the classroom) before the sync debounce
 * flushes, `scenesJson` in the DB can still contain placeholder `gen_img_xxx`,
 * `gen_vid_xxx` srcs or empty `audioUrl` on speech actions, even though the
 * upload succeeded and a row exists in `classroom_media` with `element_id`.
 *
 * This module reads every media row for a classroom, builds an
 * `elementId -> url` map, and patches scene canvases + speech actions in place
 * before the API returns them. It never writes back to the DB — this is a
 * read-time repair layer.
 */

import { getDb, isDbConfigured, schema } from '@/lib/db';
import { desc, eq } from 'drizzle-orm';
import { getStorageProvider } from '@/lib/storage';
import { createLogger } from '@/lib/logger';
import type { Scene } from '@/lib/types/stage';
import type { Action, SpeechAction } from '@/lib/types/action';

const log = createLogger('MediaBackfill');

type MediaKind = 'image' | 'video' | 'audio' | 'tts';

type CanvasElement = {
  id?: string;
  type?: string;
  src?: string;
};

// Once we've seen a schema-drift error (missing `element_id` column) we skip
// the DB read path entirely to avoid spamming the logs with the same stack on
// every request. A `make db-push` clears the drift; restart the server to
// re-enable backfill after applying the migration.
let _columnMissing = false;

/**
 * Walk scenes and replace placeholder `src` / missing `audioUrl` with real
 * MinIO URLs using the `classroom_media.element_id` index. Returns new scene
 * objects only if at least one element was patched; otherwise returns the
 * original array (same identity) to avoid needless copies.
 */
export async function backfillScenesWithMedia(
  classroomId: string,
  scenes: Scene[] | null | undefined,
): Promise<Scene[]> {
  if (!scenes || scenes.length === 0) return scenes ?? [];
  if (!isDbConfigured()) return scenes;
  if (_columnMissing) return scenes;

  // Select only always-present columns first, then try to add `element_id` in
  // a second pass. That way if the column is missing we still get rows keyed
  // by minioKey for a best-effort repair.
  let rows: Array<{ elementId: string | null; minioKey: string; mediaType: MediaKind }> = [];
  try {
    const db = getDb();
    rows = await db
      .select({
        elementId: schema.classroomMedia.elementId,
        minioKey: schema.classroomMedia.minioKey,
        mediaType: schema.classroomMedia.mediaType,
      })
      .from(schema.classroomMedia)
      .where(eq(schema.classroomMedia.classroomId, classroomId))
      .orderBy(desc(schema.classroomMedia.createdAt));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/element_id|column .* does not exist/i.test(msg)) {
      _columnMissing = true;
      log.error(
        'classroom_media.element_id column missing — run `make db-push` (or apply drizzle/0003_add_media_element_id.sql) and restart the server. Backfill is now disabled for this process.',
      );
    } else {
      log.warn('Failed to read classroom_media for backfill:', err);
    }
    return scenes;
  }

  if (rows.length === 0) return scenes;

  const storage = getStorageProvider();
  // createdAt DESC ensures the newest upload for a given elementId wins.
  const urlByElement = new Map<string, { url: string; mediaType: MediaKind }>();
  for (const row of rows) {
    if (!row.elementId) continue;
    if (urlByElement.has(row.elementId)) continue;
    const kind = row.mediaType;
    const storageType = kind === 'tts' || kind === 'audio' ? 'audio' : 'media';
    urlByElement.set(row.elementId, {
      url: storage.getUrl(row.minioKey, storageType),
      mediaType: kind,
    });
  }

  let patched = 0;
  const next: Scene[] = scenes.map((scene) => {
    let sceneChanged = false;
    let nextContent = scene.content;
    let nextActions = scene.actions;

    // 1) Patch slide canvas image/video placeholders by element id.
    if (scene.type === 'slide') {
      const canvas = (scene.content as { canvas?: { elements?: CanvasElement[] } })?.canvas;
      const elements = canvas?.elements;
      if (elements && elements.length > 0) {
        let elementsChanged = false;
        const nextElements = elements.map((el) => {
          if (!el || typeof el !== 'object') return el;
          const isMedia = el.type === 'image' || el.type === 'video';
          if (!isMedia || !el.id) return el;
          const hit = urlByElement.get(el.id);
          if (!hit) return el;
          // Only overwrite placeholder or empty srcs so we never clobber a
          // src the user may have manually pointed elsewhere.
          if (el.src && !isPlaceholderSrc(el.src)) return el;
          elementsChanged = true;
          patched += 1;
          return { ...el, src: hit.url };
        });
        if (elementsChanged) {
          sceneChanged = true;
          nextContent = {
            ...(scene.content as object),
            canvas: { ...canvas, elements: nextElements },
          } as Scene['content'];
        }
      }
    }

    // 2) Patch speech action audioUrl from TTS rows keyed by audioId.
    if (Array.isArray(scene.actions) && scene.actions.length > 0) {
      let actionsChanged = false;
      const nextActionsArr = scene.actions.map((action): Action => {
        if (action.type !== 'speech') return action;
        const speech = action as SpeechAction;
        if (speech.audioUrl && speech.audioUrl.length > 0) return speech;
        if (!speech.audioId) return speech;
        const hit = urlByElement.get(speech.audioId);
        if (!hit) return speech;
        actionsChanged = true;
        patched += 1;
        return { ...speech, audioUrl: hit.url } satisfies SpeechAction;
      });
      if (actionsChanged) {
        sceneChanged = true;
        nextActions = nextActionsArr;
      }
    }

    return sceneChanged ? { ...scene, content: nextContent, actions: nextActions } : scene;
  });

  if (patched === 0) return scenes;
  log.info(`Backfilled ${patched} media references for classroom ${classroomId}`);
  return next;
}

/** src is a generation placeholder id or empty → safe to overwrite. */
function isPlaceholderSrc(src: string): boolean {
  if (!src) return true;
  return /^(gen_(img|vid)|tts)_[\w-]+$/i.test(src);
}
