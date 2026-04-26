import { NextRequest } from 'next/server';
import { submitPDFParse } from '@/lib/pdf/pdf-providers';
import { resolvePDFApiKey, resolvePDFBaseUrl } from '@/lib/server/provider-config';
import type { PDFProviderId } from '@/lib/pdf/types';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

const log = createLogger('Parse PDF Submit');

/**
 * POST /api/parse-pdf/submit
 *
 * Accepts a PDF file via multipart/form-data and submits it for parsing.
 *
 * For synchronous providers (unpdf, MinerU self-hosted):
 *   Returns `{ async: false, data: ParsedPdfContent }` immediately.
 *
 * For MinerU cloud:
 *   Uploads to MinIO + submits to MinerU API, returns within ~1-2 s:
 *   `{ async: true, taskId, provider, apiBase }`
 *   The frontend then polls `/api/parse-pdf/poll` with these values.
 */
export async function POST(req: NextRequest) {
  let pdfFileName: string | undefined;
  let resolvedProviderId: string | undefined;
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      log.error('Invalid Content-Type for PDF upload:', contentType);
      return apiError(
        'INVALID_REQUEST',
        400,
        `Invalid Content-Type: expected multipart/form-data, got "${contentType}"`,
      );
    }

    const formData = await req.formData();
    const pdfFile = formData.get('pdf') as File | null;
    const providerId = formData.get('providerId') as PDFProviderId | null;
    const apiKey = formData.get('apiKey') as string | null;
    const baseUrl = formData.get('baseUrl') as string | null;

    if (!pdfFile) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'No PDF file provided');
    }

    const effectiveProviderId = providerId || ('unpdf' as PDFProviderId);
    pdfFileName = pdfFile?.name;
    resolvedProviderId = effectiveProviderId;

    const clientBaseUrl = baseUrl || undefined;
    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiError('INVALID_URL', 403, ssrfError);
      }
    }

    const config = {
      providerId: effectiveProviderId,
      apiKey: clientBaseUrl
        ? apiKey || ''
        : resolvePDFApiKey(effectiveProviderId, apiKey || undefined),
      baseUrl: clientBaseUrl
        ? clientBaseUrl
        : resolvePDFBaseUrl(effectiveProviderId, baseUrl || undefined),
    };

    // Extract file extension
    const extensionMatch = pdfFile.name.match(/(\.[a-zA-Z0-9]+)$/);
    const fileExtension = extensionMatch ? extensionMatch[1].toLowerCase() : '.pdf';

    // Convert PDF to buffer
    const arrayBuffer = await pdfFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Submit for parsing
    const submitResult = await submitPDFParse(config, buffer, fileExtension);

    if (!submitResult.async) {
      // Synchronous provider — return full result (same shape as old /api/parse-pdf)
      const resultWithMetadata = {
        ...submitResult.data,
        metadata: {
          ...submitResult.data.metadata,
          pageCount: submitResult.data.metadata?.pageCount ?? 0,
          fileName: pdfFile.name,
          fileSize: pdfFile.size,
        },
      };
      return apiSuccess({ async: false, data: resultWithMetadata });
    }

    // Async provider (MinerU cloud) — return task handle
    return apiSuccess({
      async: true,
      taskId: submitResult.taskId,
      provider: submitResult.provider,
      apiBase: submitResult.apiBase,
    });
  } catch (error) {
    log.error(
      `PDF submit failed [provider=${resolvedProviderId ?? 'unknown'}, file="${pdfFileName ?? 'unknown'}"]:`,
      error,
    );
    return apiError('PARSE_FAILED', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}
