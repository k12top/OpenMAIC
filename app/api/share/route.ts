import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { readClassroom } from '@/lib/server/classroom-storage';
import type { Stage } from '@/lib/types/stage';

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    if (!isDbConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const body = await req.json();
    const { classroomId, mode = 'public' } = body as {
      classroomId: string;
      mode?: 'public' | 'readonly' | 'editable' | 'sso';
    };

    if (!classroomId) {
      return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
    }

    const allowedModes = ['public', 'readonly', 'editable', 'sso'] as const;
    if (!allowedModes.includes(mode as (typeof allowedModes)[number])) {
      return NextResponse.json({ error: 'Invalid share mode' }, { status: 400 });
    }

    const db = getDb();

    let classroom = await db.query.classrooms.findFirst({
      where: eq(schema.classrooms.id, classroomId),
    });

    if (!classroom) {
      const fsData = await readClassroom(classroomId);
      if (fsData) {
        const stageObj = fsData.stage as Stage & Record<string, unknown>;
        await db.insert(schema.classrooms).values({
          id: fsData.id,
          userId: user.id,
          title: stageObj.name || '',
          language: (stageObj.language as string) || 'en-US',
          stageJson: fsData.stage,
          scenesJson: fsData.scenes,
          status: 'completed',
        });
        classroom = await db.query.classrooms.findFirst({
          where: eq(schema.classrooms.id, classroomId),
        });
      }
    }

    if (!classroom) {
      console.error(`[ShareAPI] Classroom ${classroomId} not found in DB or filesystem`);
      return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
    }

    // Auto-claim orphaned classrooms: if the record has no userId (pre-auth
    // sync) or the userId doesn't match, check whether anyone else owns it.
    // If the classroom is truly unowned, assign it to the current user.
    if (classroom.userId !== user.id) {
      console.warn(
        `[ShareAPI] userId mismatch for classroom ${classroomId}: ` +
        `DB has "${classroom.userId}", current user is "${user.id}"`
      );
      // If the stored userId is empty or the owner user doesn't exist in the
      // users table, treat it as orphaned and claim it for the current user.
      let ownerExists = false;
      if (classroom.userId) {
        const ownerRow = await db.query.users.findFirst({
          where: eq(schema.users.id, classroom.userId),
        });
        ownerExists = !!ownerRow;
      }
      if (!ownerExists) {
        console.info(`[ShareAPI] Auto-claiming orphaned classroom ${classroomId} for user ${user.id}`);
        await db
          .update(schema.classrooms)
          .set({ userId: user.id, updatedAt: new Date() })
          .where(eq(schema.classrooms.id, classroomId));
        // Re-read so the downstream code has the updated row
        classroom = await db.query.classrooms.findFirst({
          where: eq(schema.classrooms.id, classroomId),
        });
      } else {
        return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
      }
    }

    if (!classroom) {
      return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
    }

    const shareToken = nanoid(16);
    await db.insert(schema.shares).values({
      classroomId,
      userId: user.id,
      shareToken,
      mode: mode as 'public' | 'readonly' | 'editable' | 'sso',
    });

    return NextResponse.json({
      shareToken,
      mode,
      url: `/share/${shareToken}`,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    if (!isDbConfigured()) {
      return NextResponse.json({ shares: [] });
    }

    const url = new URL(req.url);
    const classroomId = url.searchParams.get('classroomId');

    if (!classroomId) {
      return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
    }

    const db = getDb();
    const shareList = await db.query.shares.findMany({
      where: and(
        eq(schema.shares.classroomId, classroomId),
        eq(schema.shares.userId, user.id),
      ),
    });

    return NextResponse.json({
      shares: shareList.map((s) => ({
        id: s.id,
        shareToken: s.shareToken,
        mode: s.mode,
        url: `/share/${s.shareToken}`,
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth();
    if (!isDbConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const body = await req.json();
    const { shareId } = body as { shareId: string };

    if (!shareId) {
      return NextResponse.json({ error: 'shareId is required' }, { status: 400 });
    }

    const db = getDb();
    const share = await db.query.shares.findFirst({
      where: eq(schema.shares.id, shareId),
    });

    if (!share || share.userId !== user.id) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }

    await db.delete(schema.shares).where(eq(schema.shares.id, shareId));

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
