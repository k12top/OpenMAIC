import { type NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { assertMenuPerm, ForbiddenError } from '@/lib/server/menu-guard';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { isValidClassroomId } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('classroom-mutate');

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/classroom/[id]
 *
 * Owner-only deletion of a classroom row. Schema cascades to
 * `classroomMedia`, `shares`, `chatSessions`, `classroomInteractions` so
 * one DELETE removes everything related. RBAC reuses the existing
 * `home.deleteClassroom` permission (which has `ownerBypass: false` —
 * even owners need an explicit grant, matching the home-page UI).
 */
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  let resolvedId: string | undefined;
  try {
    const { id } = await ctx.params;
    resolvedId = id;

    if (!id || !isValidClassroomId(id)) {
      return NextResponse.json({ error: 'Invalid classroom id' }, { status: 400 });
    }

    const user = await requireAuth();
    if (!isDbConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const db = getDb();
    const row = await db.query.classrooms.findFirst({
      where: eq(schema.classrooms.id, id),
      columns: { id: true, userId: true },
    });

    if (!row) {
      return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
    }

    if (row.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await assertMenuPerm(user, 'home.deleteClassroom', 'operable', {
      isResourceOwner: true,
      resourceId: id,
    });

    await db.delete(schema.classrooms).where(eq(schema.classrooms.id, id));
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden', detail: err.message }, { status: 403 });
    }
    log.error(`Classroom delete failed [id=${resolvedId ?? 'unknown'}]:`, err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * PATCH /api/classroom/[id]
 *
 * Currently only supports renaming (`{ title }`). Updates both the top-level
 * `title` column and `stageJson.name` so reads from either column stay
 * consistent. Owner-only; RBAC reuses `home.renameClassroom` operable.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  let resolvedId: string | undefined;
  try {
    const { id } = await ctx.params;
    resolvedId = id;

    if (!id || !isValidClassroomId(id)) {
      return NextResponse.json({ error: 'Invalid classroom id' }, { status: 400 });
    }

    const user = await requireAuth();
    if (!isDbConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const body = (await req.json().catch(() => ({}))) as { title?: unknown };
    const titleRaw = typeof body.title === 'string' ? body.title.trim() : '';
    if (!titleRaw) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    // Match the local IndexedDB rename input cap so server / client agree.
    const title = titleRaw.slice(0, 200);

    const db = getDb();
    const row = await db.query.classrooms.findFirst({
      where: eq(schema.classrooms.id, id),
    });

    if (!row) {
      return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
    }

    if (row.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await assertMenuPerm(user, 'home.renameClassroom', 'operable', {
      isResourceOwner: true,
      resourceId: id,
    });

    const stage = (row.stageJson ?? {}) as Record<string, unknown>;
    const nextStage = { ...stage, name: title };

    await db
      .update(schema.classrooms)
      .set({
        title,
        stageJson: nextStage,
        updatedAt: new Date(),
      })
      .where(eq(schema.classrooms.id, id));

    return NextResponse.json({ success: true, title });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden', detail: err.message }, { status: 403 });
    }
    log.error(`Classroom patch failed [id=${resolvedId ?? 'unknown'}]:`, err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
