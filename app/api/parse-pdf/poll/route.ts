import { NextRequest } from 'next/server';
import { pollMinerUCloudTask } from '@/lib/pdf/pdf-providers';
import { resolvePDFApiKey } from '@/lib/server/provider-config';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';

const log = createLogger('Parse PDF Poll');

/**
 * POST /api/parse-pdf/poll
 *
 * Polls an async PDF parsing task. Each call does a single status check
 * against the upstream provider and returns within ~200 ms.
 *
 * Request body (JSON):
 *   { taskId: string, provider: 'mineru-cloud', apiBase: string }
 *
 * Response:
 *   { status: 'processing' }
 *   { status: 'done', data: ParsedPdfContent }
 *   { status: 'failed', error: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { taskId, provider, apiBase } = body as {
      taskId?: string;
      provider?: string;
      apiBase?: string;
    };

    if (!taskId || !provider || !apiBase) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'Missing required fields: taskId, provider, apiBase',
      );
    }

    if (provider !== 'mineru-cloud') {
      return apiError('INVALID_REQUEST', 400, `Unsupported async provider: ${provider}`);
    }

    // Resolve the API key from server env (client never sends it for poll)
    const apiKey = resolvePDFApiKey('mineru');
    if (!apiKey) {
      return apiError(
        'MISSING_API_KEY',
        500,
        'MinerU API key not configured on server. Set PDF_MINERU_API_KEY.',
      );
    }

    const result = await pollMinerUCloudTask(taskId, apiKey, apiBase);

    if (result.status === 'done' && result.data) {
      return apiSuccess({
        status: 'done' as const,
        data: result.data,
      });
    }

    if (result.status === 'failed') {
      return apiSuccess({
        status: 'failed' as const,
        error: result.error ?? 'Unknown error',
      });
    }

    return apiSuccess({ status: 'processing' as const });
  } catch (error) {
    log.error('PDF poll failed:', error);
    return apiError('PARSE_FAILED', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}
