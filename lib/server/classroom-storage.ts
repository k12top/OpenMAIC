import { promises as fs } from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { Scene, Stage } from '@/lib/types/stage';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq, desc, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClassroomStorage');

export const CLASSROOMS_DIR = path.join(process.cwd(), 'data', 'classrooms');
export const CLASSROOM_JOBS_DIR = path.join(process.cwd(), 'data', 'classroom-jobs');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureClassroomsDir() {
  await ensureDir(CLASSROOMS_DIR);
}

export async function ensureClassroomJobsDir() {
  await ensureDir(CLASSROOM_JOBS_DIR);
}

export async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tempFilePath, content, 'utf-8');
  await fs.rename(tempFilePath, filePath);
}

export function buildRequestOrigin(req: NextRequest): string {
  return req.headers.get('x-forwarded-host')
    ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('x-forwarded-host')}`
    : req.nextUrl.origin;
}

export interface PersistedClassroomData {
  id: string;
  stage: Stage;
  scenes: Scene[];
  createdAt: string;
  userId?: string;
}

export function isValidClassroomId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export async function readClassroom(id: string): Promise<PersistedClassroomData | null> {
  // Try PostgreSQL first
  if (isDbConfigured()) {
    try {
      const db = getDb();
      const row = await db.query.classrooms.findFirst({
        where: eq(schema.classrooms.id, id),
      });
      if (row) {
        return {
          id: row.id,
          stage: row.stageJson as Stage,
          scenes: row.scenesJson as Scene[],
          createdAt: row.createdAt.toISOString(),
          userId: row.userId,
        };
      }
    } catch (err) {
      log.error('Failed to read classroom from DB, falling back to file:', err);
    }
  }

  // Fallback to file system
  const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as PersistedClassroomData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function persistClassroom(
  data: {
    id: string;
    stage: Stage;
    scenes: Scene[];
    userId?: string;
  },
  baseUrl: string,
): Promise<PersistedClassroomData & { url: string }> {
  const classroomData: PersistedClassroomData = {
    id: data.id,
    stage: data.stage,
    scenes: data.scenes,
    createdAt: new Date().toISOString(),
    userId: data.userId,
  };

  // Write to PostgreSQL if configured
  if (isDbConfigured() && data.userId) {
    try {
      const db = getDb();
      const existing = await db.query.classrooms.findFirst({
        where: eq(schema.classrooms.id, data.id),
      });

      if (existing) {
        await db
          .update(schema.classrooms)
          .set({
            stageJson: data.stage,
            scenesJson: data.scenes,
            title: data.stage.name || '',
            language: data.stage.language ?? 'en-US',
            status: 'completed',
            updatedAt: new Date(),
          })
          .where(eq(schema.classrooms.id, data.id));
      } else {
        await db.insert(schema.classrooms).values({
          id: data.id,
          userId: data.userId,
          title: data.stage.name || '',
          language: data.stage.language ?? 'en-US',
          stageJson: data.stage,
          scenesJson: data.scenes,
          status: 'completed',
        });
      }
    } catch (err) {
      log.error('Failed to persist classroom to DB:', err);
    }
  }

  // Always write to file system as fallback
  await ensureClassroomsDir();
  const filePath = path.join(CLASSROOMS_DIR, `${data.id}.json`);
  await writeJsonFileAtomic(filePath, classroomData);

  return {
    ...classroomData,
    url: `${baseUrl}/classroom/${data.id}`,
  };
}

/**
 * List classrooms for a specific user from PostgreSQL.
 *
 * Includes `sceneCount` derived from `jsonb_array_length(scenes_json)` so
 * the home page card can render "{n} slides" without us having to ship
 * the full `scenesJson` over the wire (a single classroom's scenes can
 * easily be several MB once images / canvas data are baked in).
 */
export async function listUserClassrooms(userId: string) {
  if (!isDbConfigured()) return [];

  const db = getDb();
  return db
    .select({
      id: schema.classrooms.id,
      title: schema.classrooms.title,
      language: schema.classrooms.language,
      status: schema.classrooms.status,
      createdAt: schema.classrooms.createdAt,
      updatedAt: schema.classrooms.updatedAt,
      sceneCount: sql<number>`COALESCE(CASE WHEN jsonb_typeof(${schema.classrooms.scenesJson}) = 'array' THEN jsonb_array_length(${schema.classrooms.scenesJson}) END, 0)`,
    })
    .from(schema.classrooms)
    .where(eq(schema.classrooms.userId, userId))
    .orderBy(desc(schema.classrooms.updatedAt));
}
