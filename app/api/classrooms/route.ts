import { NextResponse } from 'next/server';
import { optionalAuth } from '@/lib/server/auth-guard';
import { listUserClassrooms } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('classrooms-list');

/**
 * GET /api/classrooms
 *
 * Returns the metadata-only list of classrooms owned by the current user.
 * Uses `optionalAuth` so anonymous visitors get an empty list rather than a
 * 401 (the home page degrades gracefully and falls back to local-only mode).
 *
 * Intentionally excludes `scenesJson` / `stageJson` to keep payloads small —
 * the home page only needs cards, and thumbnails go through the dedicated
 * `/api/classrooms/thumbnails` endpoint.
 */
export async function GET() {
  try {
    const user = await optionalAuth();
    if (!user) return NextResponse.json({ items: [] });

    const rows = await listUserClassrooms(user.id);
    const items = rows.map((r) => ({
      id: r.id,
      title: r.title,
      language: r.language,
      status: r.status,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
    }));
    return NextResponse.json({ items });
  } catch (err) {
    log.warn('Failed to list classrooms:', err);
    return NextResponse.json({ items: [] });
  }
}
