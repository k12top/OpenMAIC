import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq, and } from 'drizzle-orm';

interface ChatSessionPayload {
  id: string;
  sceneId?: string;
  type: string;
  title?: string;
  status: string;
  messages: unknown[];
  config?: unknown;
  createdAt?: number;
  updatedAt?: number;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    if (!isDbConfigured()) {
      return NextResponse.json({ synced: false, reason: 'db_not_configured' });
    }

    const body = await req.json();
    const { classroomId, sessions } = body as {
      classroomId: string;
      sessions: ChatSessionPayload[];
    };

    if (!classroomId || !sessions) {
      return NextResponse.json(
        { error: 'classroomId and sessions are required' },
        { status: 400 },
      );
    }

    const db = getDb();

    for (const session of sessions) {
      const existing = await db.query.chatSessions.findFirst({
        where: and(
          eq(schema.chatSessions.id, session.id),
          eq(schema.chatSessions.classroomId, classroomId),
        ),
      });

      const statusValue = (['active', 'completed', 'interrupted'].includes(session.status)
        ? session.status
        : 'active') as 'active' | 'completed' | 'interrupted';

      if (existing) {
        await db
          .update(schema.chatSessions)
          .set({
            sceneId: session.sceneId || '',
            type: session.type,
            title: session.title || '',
            status: statusValue,
            messagesJson: session.messages,
            config: session.config,
            updatedAt: new Date(),
          })
          .where(eq(schema.chatSessions.id, session.id));
      } else {
        await db.insert(schema.chatSessions).values({
          id: session.id,
          classroomId,
          userId: user.id,
          sceneId: session.sceneId || '',
          type: session.type,
          title: session.title || '',
          status: statusValue,
          messagesJson: session.messages,
          config: session.config,
        });
      }
    }

    return NextResponse.json({ synced: true, count: sessions.length });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('Chat history sync failed:', err);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth();

    const classroomId = req.nextUrl.searchParams.get('classroomId');
    if (!classroomId) {
      return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
    }

    if (!isDbConfigured()) {
      return NextResponse.json({ sessions: [] });
    }

    const db = getDb();
    const rows = await db.query.chatSessions.findMany({
      where: eq(schema.chatSessions.classroomId, classroomId),
    });

    const sessions = rows.map((r) => ({
      id: r.id,
      sceneId: r.sceneId,
      type: r.type,
      title: r.title,
      status: r.status,
      messages: r.messagesJson,
      config: r.config,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return NextResponse.json({ sessions });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
