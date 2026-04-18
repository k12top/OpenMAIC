import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { Stage, Scene } from '@/lib/types/stage';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const user = await requireAuth();
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

    if (share.mode !== 'editable') {
      return NextResponse.json(
        { error: 'This share is read-only and cannot be copied' },
        { status: 403 },
      );
    }

    // Get the original classroom
    const original = await db.query.classrooms.findFirst({
      where: eq(schema.classrooms.id, share.classroomId),
    });

    if (!original) {
      return NextResponse.json({ error: 'Original classroom not found' }, { status: 404 });
    }

    // Create a copy under the current user
    const newId = nanoid();
    const stage = original.stageJson as Stage;
    const copiedStage = { ...stage, id: newId, name: `${original.title} (copy)` };

    await db.insert(schema.classrooms).values({
      id: newId,
      userId: user.id,
      title: `${original.title} (copy)`,
      language: original.language,
      stageJson: copiedStage,
      scenesJson: original.scenesJson as Scene[],
      status: 'completed',
    });

    return NextResponse.json({
      id: newId,
      url: `/classroom/${newId}`,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
