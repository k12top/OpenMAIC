import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, UnauthenticatedError } from '@/lib/server/auth-guard';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getStorageProvider } from '@/lib/storage';
import { createLogger } from '@/lib/logger';
import crypto from 'crypto';

const log = createLogger('ClassroomMediaAPI');

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    const formData = await req.formData();
    const classroomId = formData.get('classroomId') as string;
    const mediaType = formData.get('mediaType') as string;
    const file = formData.get('file') as File | null;
    const elementIdRaw = formData.get('elementId');
    const elementId = typeof elementIdRaw === 'string' && elementIdRaw.length > 0 ? elementIdRaw : null;

    if (!classroomId || !mediaType || !file) {
      return NextResponse.json(
        { error: 'classroomId, mediaType, and file are required' },
        { status: 400 },
      );
    }

    const validTypes = ['image', 'video', 'audio', 'tts'];
    if (!validTypes.includes(mediaType)) {
      return NextResponse.json({ error: `Invalid mediaType: ${mediaType}` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const storageType = mediaType === 'tts' || mediaType === 'audio' ? 'audio' : 'media';
    const mimeType = file.type || 'application/octet-stream';

    const storage = getStorageProvider();
    const key = `${classroomId}/${mediaType}/${hash}`;
    const url = await storage.upload(key, buffer, storageType, mimeType);

    if (isDbConfigured()) {
      try {
        const db = getDb();
        await db.insert(schema.classroomMedia).values({
          classroomId,
          mediaType: mediaType as 'image' | 'video' | 'audio' | 'tts',
          elementId,
          minioKey: key,
          mimeType,
          sizeBytes: buffer.length,
        });
      } catch (dbErr) {
        // Storage upload already succeeded — we never fail the request on a DB
        // hiccup, but we DO need to surface the error: a silent catch here used
        // to hide missing-column errors (e.g. `element_id`) and break share
        // backfill. Log loudly so schema drift is obvious in dev logs.
        log.error(
          `classroom_media insert failed (classroomId=${classroomId}, elementId=${elementId ?? 'null'}, key=${key}):`,
          dbErr,
        );
      }
    }

    return NextResponse.json({ url, key, hash });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    console.error('Media upload failed:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
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
      return NextResponse.json({ media: [] });
    }

    const db = getDb();
    const rows = await db.query.classroomMedia.findMany({
      where: eq(schema.classroomMedia.classroomId, classroomId),
    });

    const storage = getStorageProvider();
    const media = rows.map((r) => ({
      id: r.id,
      mediaType: r.mediaType,
      elementId: r.elementId,
      minioKey: r.minioKey,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      url: storage.getUrl(r.minioKey, r.mediaType === 'tts' || r.mediaType === 'audio' ? 'audio' : 'media'),
      createdAt: r.createdAt,
    }));

    return NextResponse.json({ media });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
