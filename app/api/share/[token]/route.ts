import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
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

  // Check expiration
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return NextResponse.json({ error: 'Share link has expired' }, { status: 410 });
  }

  // Get the classroom data
  const classroom = await db.query.classrooms.findFirst({
    where: eq(schema.classrooms.id, share.classroomId),
  });

  if (!classroom) {
    return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
  }

  return NextResponse.json({
    mode: share.mode,
    classroom: {
      id: classroom.id,
      title: classroom.title,
      language: classroom.language,
      stage: classroom.stageJson as Stage,
      scenes: classroom.scenesJson as Scene[],
      createdAt: classroom.createdAt,
    },
  });
}
