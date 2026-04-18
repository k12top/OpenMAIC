import { eq, desc } from 'drizzle-orm';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('Credits');

// ─── Conversion rates (configurable via env) ─────────────────────────────────

export const CREDIT_RATES = {
  llmPer1kTokens: parseFloat(process.env.CREDIT_RATE_LLM || '1'),
  ttsPer1kChars: parseFloat(process.env.CREDIT_RATE_TTS || '2'),
  imagePerUnit: parseFloat(process.env.CREDIT_RATE_IMAGE || '5'),
  videoPerUnit: parseFloat(process.env.CREDIT_RATE_VIDEO || '20'),
  asrPerMinute: parseFloat(process.env.CREDIT_RATE_ASR || '3'),
};

export class InsufficientCreditsError extends Error {
  balance: number;
  constructor(balance: number) {
    super(`Insufficient credits: balance=${balance}`);
    this.name = 'InsufficientCreditsError';
    this.balance = balance;
  }
}

/** Sentinel value indicating credits are unlimited (DB not configured). */
export const UNLIMITED_CREDITS = -1;

/**
 * Get the current credit balance for a user.
 * Returns UNLIMITED_CREDITS (-1) when the DB is not configured or tables are missing.
 */
export async function getBalance(userId: string): Promise<number> {
  if (!isDbConfigured()) return UNLIMITED_CREDITS;

  try {
    const db = getDb();
    const row = await db.query.credits.findFirst({
      where: eq(schema.credits.userId, userId),
    });
    return row?.balance ?? 0;
  } catch (err) {
    if (isTableMissingError(err)) {
      log.warn('Credits table does not exist yet — run migrations. Treating as unlimited.');
      return UNLIMITED_CREDITS;
    }
    throw err;
  }
}

/**
 * Check if the user has enough credits. Throws InsufficientCreditsError if not.
 * When DB is not configured, credits are unlimited (always passes).
 */
export async function checkCredits(userId: string): Promise<number> {
  const balance = await getBalance(userId);
  if (balance === UNLIMITED_CREDITS) return balance;
  if (balance <= 0) {
    throw new InsufficientCreditsError(balance);
  }
  return balance;
}

/** Detect PostgreSQL "relation does not exist" errors (code 42P01). */
function isTableMissingError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'cause' in err) {
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code === '42P01') return true;
  }
  if (err && typeof err === 'object' && 'code' in err) {
    if ((err as { code?: string }).code === '42P01') return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('does not exist') && msg.includes('relation');
}

/**
 * Consume credits after an AI operation completes.
 */
export async function consumeCredits(
  userId: string,
  opts: {
    tokenCount?: number;
    type: 'llm' | 'tts' | 'image' | 'video' | 'asr';
    unitCount?: number;
    apiRoute?: string;
    description?: string;
  },
): Promise<void> {
  if (!isDbConfigured()) return;

  const cost = calculateCost(opts);
  if (cost <= 0) return;

  try {
    const db = getDb();

    const current = await db.query.credits.findFirst({
      where: eq(schema.credits.userId, userId),
    });

    if (!current) {
      log.warn(`No credit record for user ${userId}, skipping deduction`);
      return;
    }

    await db
      .update(schema.credits)
      .set({
        balance: current.balance - cost,
        totalConsumed: current.totalConsumed + cost,
        updatedAt: new Date(),
      })
      .where(eq(schema.credits.userId, userId));

    await db.insert(schema.creditTransactions).values({
      userId,
      amount: -cost,
      type: 'consume',
      description: opts.description || `${opts.type} consumption`,
      relatedApi: opts.apiRoute || '',
      tokenCount: opts.tokenCount || 0,
    });

    log.info(`Consumed ${cost} credits from user ${userId} (${opts.type})`);
  } catch (err) {
    if (isTableMissingError(err)) {
      log.warn('Credits tables do not exist yet — run migrations. Skipping deduction.');
      return;
    }
    log.error(`Failed to consume credits for user ${userId}:`, err);
  }
}

function calculateCost(opts: {
  tokenCount?: number;
  type: 'llm' | 'tts' | 'image' | 'video' | 'asr';
  unitCount?: number;
}): number {
  switch (opts.type) {
    case 'llm':
      return Math.ceil(((opts.tokenCount || 0) / 1000) * CREDIT_RATES.llmPer1kTokens);
    case 'tts':
      return Math.ceil(((opts.unitCount || 0) / 1000) * CREDIT_RATES.ttsPer1kChars);
    case 'image':
      return Math.ceil((opts.unitCount || 1) * CREDIT_RATES.imagePerUnit);
    case 'video':
      return Math.ceil((opts.unitCount || 1) * CREDIT_RATES.videoPerUnit);
    case 'asr':
      return Math.ceil((opts.unitCount || 1) * CREDIT_RATES.asrPerMinute);
    default:
      return 0;
  }
}

/**
 * Save a checkpoint when credits are insufficient mid-generation.
 */
export async function saveCheckpoint(
  userId: string,
  classroomId: string,
  step: string,
  stateJson: unknown,
): Promise<string | null> {
  if (!isDbConfigured()) return null;

  try {
    const db = getDb();
    const [row] = await db
      .insert(schema.checkpoints)
      .values({
        userId,
        classroomId,
        step,
        stateJson,
      })
      .returning({ id: schema.checkpoints.id });
    return row?.id || null;
  } catch (err) {
    if (isTableMissingError(err)) {
      log.warn('Checkpoints table does not exist yet — run migrations.');
      return null;
    }
    throw err;
  }
}

/**
 * Get recent transactions for a user.
 */
export async function getTransactions(
  userId: string,
  limit = 50,
  offset = 0,
) {
  if (!isDbConfigured()) return [];

  try {
    const db = getDb();
    return await db.query.creditTransactions.findMany({
      where: eq(schema.creditTransactions.userId, userId),
      orderBy: desc(schema.creditTransactions.createdAt),
      limit,
      offset,
    });
  } catch (err) {
    if (isTableMissingError(err)) {
      log.warn('Credit transactions table does not exist yet — run migrations.');
      return [];
    }
    throw err;
  }
}
