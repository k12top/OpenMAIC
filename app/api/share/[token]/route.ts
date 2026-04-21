import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { readClassroom } from '@/lib/server/classroom-storage';
import { optionalAuth } from '@/lib/server/auth-guard';
import { backfillScenesWithMedia } from '@/lib/server/media-backfill';
import type { Scene, Stage } from '@/lib/types/stage';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!isDbConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const db = getDb();
  const share = await db.query.shares.findFirst({
    where: eq(schema.shares.shareToken, token),
  });

  if (!share) {
    return NextResponse.json({ error: 'Share not found' }, { status: 404 });
  }

  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return NextResponse.json({ error: 'Share link has expired' }, { status: 410 });
  }

  // Non-public shares require the viewer to be authenticated
  if (share.mode !== 'public') {
    const user = await optionalAuth();
    if (!user) {
      return NextResponse.json(
        { error: 'Login required to view this shared classroom', requiresAuth: true },
        { status: 401 },
      );
    }
  }

  const dbRow = await db.query.classrooms.findFirst({
    where: eq(schema.classrooms.id, share.classroomId),
  });

  if (dbRow) {
    const scenes = await backfillScenesWithMedia(
      dbRow.id,
      dbRow.scenesJson as Scene[],
    );
    return NextResponse.json({
      mode: share.mode,
      classroom: {
        id: dbRow.id,
        title: dbRow.title,
        language: dbRow.language,
        stage: dbRow.stageJson as Stage,
        scenes,
        createdAt: dbRow.createdAt,
      },
    });
  }

  const fsData = await readClassroom(share.classroomId);
  if (!fsData) {
    return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
  }

  const stageObj = fsData.stage as Stage;
  const fsScenes = await backfillScenesWithMedia(fsData.id, fsData.scenes as Scene[]);
  return NextResponse.json({
    mode: share.mode,
    classroom: {
      id: fsData.id,
      title: stageObj.name || '',
      language: (stageObj as unknown as Record<string, string>).language || 'en-US',
      stage: fsData.stage,
      scenes: fsScenes,
      createdAt: fsData.createdAt,
    },
  });
}
