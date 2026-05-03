import { type NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { optionalAuth } from '@/lib/server/auth-guard';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { isValidClassroomId } from '@/lib/server/classroom-storage';
import type { Scene, SlideContent } from '@/lib/types/stage';
import type { Slide } from '@/lib/types/slides';
import { createLogger } from '@/lib/logger';

const log = createLogger('classrooms-thumbnails');

const MAX_IDS = 100;

/**
 * GET /api/classrooms/thumbnails?ids=a,b,c
 *
 * Returns the first slide canvas for each classroom in the comma-separated
 * `ids` list, scoped to the current user (defense against IDOR even though
 * the IDs are normally unguessable). Mirrors the local
 * `getFirstSlideByStages` shape (`Record<id, Slide | null>`) so the home
 * page can drop the result straight into its existing `thumbnails` map.
 *
 * Anonymous visitors and DB-disabled deploys get an empty `items` map so
 * the home page degrades silently to local-only thumbnails.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await optionalAuth();
    if (!user) return NextResponse.json({ items: {} });
    if (!isDbConfigured()) return NextResponse.json({ items: {} });

    const idsParam = req.nextUrl.searchParams.get('ids');
    if (!idsParam) return NextResponse.json({ items: {} });

    const ids = Array.from(
      new Set(
        idsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((id) => isValidClassroomId(id)),
      ),
    ).slice(0, MAX_IDS);

    if (ids.length === 0) return NextResponse.json({ items: {} });

    const db = getDb();
    const rows = await db.query.classrooms.findMany({
      where: and(
        inArray(schema.classrooms.id, ids),
        eq(schema.classrooms.userId, user.id),
      ),
      columns: { id: true, scenesJson: true },
    });

    const items: Record<string, Slide | null> = {};
    for (const r of rows) {
      const scenes = (r.scenesJson as Scene[] | null) ?? [];
      const firstSlide = scenes.find(
        (s): s is Scene & { content: SlideContent } => s?.content?.type === 'slide',
      );
      items[r.id] = firstSlide?.content?.canvas ?? null;
    }

    return NextResponse.json({ items });
  } catch (err) {
    log.warn('Failed to load classroom thumbnails:', err);
    return NextResponse.json({ items: {} });
  }
}
