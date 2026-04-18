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

/**
 * Get the current credit balance for a user.
 * Returns the balance or 0 if credits are not configured / user not found.
 */
export async function getBalance(userId: string): Promise<number> {
  if (!isDbConfigured()) return Infinity;

  const db = getDb();
  const row = await db.query.credits.findFirst({
    where: eq(schema.credits.userId, userId),
  });

  return row?.balance ?? 0;
}

/**
 * Check if the user has enough credits. Throws InsufficientCreditsError if not.
 */
export async function checkCredits(userId: string): Promise<number> {
  const balance = await getBalance(userId);
  if (balance !== Infinity && balance <= 0) {
    throw new InsufficientCreditsError(balance);
  }
  return balance;
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

  const db = getDb();

  try {
    // Deduct from balance
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

    // Record transaction
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

  const db = getDb();
  return db.query.creditTransactions.findMany({
    where: eq(schema.creditTransactions.userId, userId),
    orderBy: desc(schema.creditTransactions.createdAt),
    limit,
    offset,
  });
}
