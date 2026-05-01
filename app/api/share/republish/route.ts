import { NextRequest, NextResponse } from 'next/server';
import { eq, and, inArray } from 'drizzle-orm';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { readClassroom } from '@/lib/server/classroom-storage';
import type { Scene } from '@/lib/types/stage';
import type { Action, SpeechAction } from '@/lib/types/action';

/**
 * Republish a share: reconcile the persisted classroom against the
 * `classroom_media` table and report which speech/action audio IDs are
 * missing on the server. The client then re-uploads the missing blobs from
 * IndexedDB so that share viewers see the latest TTS audio after the owner
 * regenerates speech locally.
 *
 * Returns:
 *   { missingAudioIds: string[], totalAudioIds: number }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    if (!isDbConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const { classroomId } = body as { classroomId?: string };
    if (!classroomId) {
      return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
    }

    const db = getDb();
    const classroom = await db.query.classrooms.findFirst({
      where: eq(schema.classrooms.id, classroomId),
    });

    if (!classroom) {
      return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
    }
    if (classroom.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Re-read after potential filesystem fallback to make sure we have the
    // freshest stage/scene snapshot the server knows about.
    const persisted = await readClassroom(classroomId);
    const scenes: Scene[] = (persisted?.scenes as Scene[] | undefined) ?? [];

    const audioIds = new Set<string>();
    for (const scene of scenes) {
      const actions = (scene.actions || []) as Action[];
      for (const action of actions) {
        if (action.type === 'speech') {
          const speech = action as SpeechAction;
          if (speech.audioId) audioIds.add(speech.audioId);
        }
      }
    }

    const allIds = Array.from(audioIds);

    if (allIds.length === 0) {
      return NextResponse.json({ missingAudioIds: [], totalAudioIds: 0 });
    }

    const existingRows = await db.query.classroomMedia.findMany({
      where: and(
        eq(schema.classroomMedia.classroomId, classroomId),
        inArray(schema.classroomMedia.elementId, allIds),
      ),
      columns: { elementId: true },
    });

    const present = new Set(existingRows.map((r) => r.elementId).filter((x): x is string => !!x));
    const missing = allIds.filter((id) => !present.has(id));

    return NextResponse.json({
      missingAudioIds: missing,
      totalAudioIds: allIds.length,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('[Share/Republish] error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Internal error', detail: message }, { status: 500 });
  }
}
