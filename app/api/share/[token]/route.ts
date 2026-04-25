import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { readClassroom } from '@/lib/server/classroom-storage';
import { backfillScenesWithMedia } from '@/lib/server/media-backfill';
import { optionalAuth } from '@/lib/server/auth-guard';
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

  // All share modes (public / readonly / editable) are viewable without authentication.
  // SSO shares require a valid session; unauthenticated requests get a 401
  // with `requiresAuth: true` so the client can redirect to Casdoor login.
  // Mode affects only the client-side UI (banner + CTA). The /copy endpoint
  // still requires auth for `editable` shares.

  // Detect if the current viewer is the author of the source classroom. The
  // client uses this to re-enable owner-only UI (e.g. regenerate-scene) when
  // the author is viewing their own share link.
  const authedUser = await optionalAuth();

  if (share.mode === 'sso' && !authedUser) {
    return NextResponse.json(
      {
        error: 'Authentication required',
        code: 'REQUIRES_SSO',
        requiresAuth: true,
      },
      { status: 401 },
    );
  }

  const dbRow = await db.query.classrooms.findFirst({
    where: eq(schema.classrooms.id, share.classroomId),
  });

  if (dbRow) {
    const scenes = await backfillScenesWithMedia(
      dbRow.id,
      dbRow.scenesJson as Scene[],
    );
    const isOwnerOfSource = !!authedUser && authedUser.id === dbRow.userId;
    return NextResponse.json({
      mode: share.mode,
      isOwnerOfSource,
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
  // File-backed classrooms have no user binding — cannot be "owned" by anyone.
  return NextResponse.json({
    mode: share.mode,
    isOwnerOfSource: false,
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
