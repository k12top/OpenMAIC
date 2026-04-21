import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { Stage, Scene } from '@/lib/types/stage';
import { backfillScenesWithMedia } from '@/lib/server/media-backfill';

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    if (!isDbConfigured()) {
      return NextResponse.json({ synced: false, reason: 'db_not_configured' });
    }

    const body = await req.json();
    const { classroomId, stage, scenes, currentSceneId } = body as {
      classroomId: string;
      stage: Stage;
      scenes: Scene[];
      currentSceneId?: string;
    };

    if (!classroomId || !stage) {
      return NextResponse.json({ error: 'classroomId and stage are required' }, { status: 400 });
    }

    const db = getDb();
    const stageObj = stage as Stage & Record<string, unknown>;
    const title = stageObj.name || '';
    const language = (stageObj.language as string) || 'en-US';

    // Repair placeholder media references (gen_img_xxx / empty audioUrl) using
    // the classroom_media table BEFORE persisting. This is the write-time
    // counterpart of the read-time backfill in share/classroom GET handlers —
    // ensures we never leave placeholders in `scenesJson` even if the client
    // debounce hadn't flushed yet.
    const repairedScenes = await backfillScenesWithMedia(classroomId, scenes || []);

    const existing = await db.query.classrooms.findFirst({
      where: eq(schema.classrooms.id, classroomId),
    });

    if (existing) {
      await db
        .update(schema.classrooms)
        .set({
          stageJson: { ...stage, currentSceneId },
          scenesJson: repairedScenes,
          title,
          language,
          status: 'completed',
          updatedAt: new Date(),
        })
        .where(eq(schema.classrooms.id, classroomId));
    } else {
      await db.insert(schema.classrooms).values({
        id: classroomId,
        userId: user.id,
        title,
        language,
        stageJson: { ...stage, currentSceneId },
        scenesJson: repairedScenes,
        status: 'completed',
      });
    }

    return NextResponse.json({ synced: true });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('Classroom sync failed:', err);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
