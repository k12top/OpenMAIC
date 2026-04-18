import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq, and } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    if (!isDbConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const body = await req.json();
    const { classroomId, mode = 'readonly' } = body as {
      classroomId: string;
      mode?: 'readonly' | 'editable';
    };

    if (!classroomId) {
      return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
    }

    const db = getDb();

    // Verify the user owns the classroom
    const classroom = await db.query.classrooms.findFirst({
      where: eq(schema.classrooms.id, classroomId),
    });

    if (!classroom || classroom.userId !== user.id) {
      return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
    }

    const shareToken = nanoid(16);
    await db.insert(schema.shares).values({
      classroomId,
      userId: user.id,
      shareToken,
      mode: mode as 'readonly' | 'editable',
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
