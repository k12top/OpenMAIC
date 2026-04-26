/**
 * PDF Parsing Provider Implementation
 *
 * Factory pattern for routing PDF parsing requests to appropriate provider implementations.
 * Follows the same architecture as lib/ai/providers.ts for consistency.
 *
 * Currently Supported Providers:
 * - unpdf: Built-in Node.js PDF parser with text and image extraction
 * - MinerU: Advanced commercial service with OCR, formula, and table extraction
 *   (https://mineru.ai or self-hosted)
 *
 * HOW TO ADD A NEW PROVIDER:
 *
 * 1. Add provider ID to PDFProviderId in lib/pdf/types.ts
 *    Example: | 'tesseract-ocr'
 *
 * 2. Add provider configuration to lib/pdf/constants.ts
 *    Example:
 *    'tesseract-ocr': {
 *      id: 'tesseract-ocr',
 *      name: 'Tesseract OCR',
 *      requiresApiKey: false,
 *      icon: '/tesseract.svg',
 *      features: ['text', 'images', 'ocr']
 *    }
 *
 * 3. Implement provider function in this file
 *    Pattern: async function parseWithXxx(config, pdfBuffer): Promise<ParsedPdfContent>
 *    - Accept PDF as Buffer
 *    - Extract text, images, tables, formulas as needed
 *    - Return unified format:
 *      {
 *        text: string,               // Markdown or plain text
 *        images: string[],           // Base64 data URLs
 *        metadata: {
 *          pageCount: number,
 *          parser: string,
 *          ...                       // Provider-specific metadata
 *        }
 *      }
 *
 *    Example:
 *    async function parseWithTesseractOCR(
 *      config: PDFParserConfig,
 *      pdfBuffer: Buffer
 *    ): Promise<ParsedPdfContent> {
 *      const { createWorker } = await import('tesseract.js');
 *
 *      // Convert PDF pages to images
 *      const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
 *      const numPages = pdf.numPages;
 *
 *      const texts: string[] = [];
 *      const images: string[] = [];
 *
 *      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
 *        // Render page to canvas/image
 *        const page = await pdf.getPage(pageNum);
 *        const viewport = page.getViewport({ scale: 2.0 });
 *        const canvas = createCanvas(viewport.width, viewport.height);
 *        const context = canvas.getContext('2d');
 *        await page.render({ canvasContext: context, viewport }).promise;
 *
 *        // OCR the image
 *        const worker = await createWorker('eng+chi_sim');
 *        const { data: { text } } = await worker.recognize(canvas.toBuffer());
 *        texts.push(text);
 *        await worker.terminate();
 *
 *        // Save image
 *        images.push(canvas.toDataURL());
 *      }
 *
 *      return {
 *        text: texts.join('\n\n'),
 *        images,
 *        metadata: {
 *          pageCount: numPages,
 *          parser: 'tesseract-ocr',
 *        },
 *      };
 *    }
 *
 * 4. Add case to parsePDF() switch statement
 *    case 'tesseract-ocr':
 *      result = await parseWithTesseractOCR(config, pdfBuffer);
 *      break;
 *
 * 5. Add i18n translations in lib/i18n.ts
 *    providerTesseractOCR: { zh: 'Tesseract OCR', en: 'Tesseract OCR' }
 *
 * 6. Update features in constants.ts to reflect parser capabilities
 *    features: ['text', 'images', 'ocr'] // OCR-capable
 *
 * Provider Implementation Patterns:
 *
 * Pattern 1: Local Node.js Parser (like unpdf)
 * - Import parsing library
 * - Process Buffer directly
 * - Extract text and images synchronously or asynchronously
 * - Convert images to base64 data URLs
 * - Return immediately
 *
 * Pattern 2: Remote API (like MinerU)
 * - Upload PDF or provide URL
 * - Create task and get task ID
 * - Poll for completion (with timeout)
 * - Download results (text, images, metadata)
 * - Parse and convert to unified format
 *
 * Pattern 3: OCR-based Parser (Tesseract, Google Vision)
 * - Render PDF pages to images
 * - Send images to OCR service
 * - Collect text from all pages
 * - Combine with layout analysis if available
 * - Return combined text and original images
 *
 * Image Extraction Best Practices:
 * - Always convert to base64 data URLs (data:image/png;base64,...)
 * - Use PNG for lossless quality
 * - Use sharp for efficient image processing
 * - Handle errors per image (don't fail entire parsing)
 * - Log extraction failures but continue processing
 *
 * Metadata Recommendations:
 * - pageCount: Number of pages in PDF
 * - parser: Provider ID for debugging
 * - processingTime: Time taken (auto-added)
 * - taskId/jobId: For async providers (useful for troubleshooting)
 * - Custom fields: imageMapping, pdfImages, tables, formulas, etc.
 *
 * Error Handling:
 * - Validate API key if requiresApiKey is true
 * - Throw descriptive errors for missing configuration
 * - For async providers, handle timeout and polling errors
 * - Log warnings for non-critical failures (e.g., single page errors)
 * - Always include provider name in error messages
 */

import crypto from 'crypto';
import { extractText, getDocumentProxy, extractImages } from 'unpdf';
import sharp from 'sharp';
import { Client as MinioClient } from 'minio';
import JSZip from 'jszip';
import type { PDFParserConfig } from './types';
import type { ParsedPdfContent } from '@/lib/types/pdf';
import { PDF_PROVIDERS } from './constants';
import { createLogger } from '@/lib/logger';

const log = createLogger('PDFProviders');

/**
 * Parse PDF using specified provider
 */
export async function parsePDF(
  config: PDFParserConfig,
  pdfBuffer: Buffer,
): Promise<ParsedPdfContent> {
  const provider = PDF_PROVIDERS[config.providerId];
  if (!provider) {
    throw new Error(`Unknown PDF provider: ${config.providerId}`);
  }

  // Validate API key if required
  if (provider.requiresApiKey && !config.apiKey) {
    throw new Error(`API key required for PDF provider: ${config.providerId}`);
  }

  const startTime = Date.now();

  let result: ParsedPdfContent;

  switch (config.providerId) {
    case 'unpdf':
      result = await parseWithUnpdf(pdfBuffer);
      break;

    case 'mineru':
      result = await parseWithMinerU(config, pdfBuffer);
      break;

    default:
      throw new Error(`Unsupported PDF provider: ${config.providerId}`);
  }

  // Add processing time to metadata
  if (result.metadata) {
    result.metadata.processingTime = Date.now() - startTime;
  }

  return result;
}

/**
 * Parse PDF using unpdf (existing implementation)
 */
async function parseWithUnpdf(pdfBuffer: Buffer): Promise<ParsedPdfContent> {
  const uint8Array = new Uint8Array(pdfBuffer);
  const pdf = await getDocumentProxy(uint8Array);
  const numPages = pdf.numPages;

  // Extract text using the document proxy
  const { text: pdfText } = await extractText(pdf, {
    mergePages: true,
  });

  // Extract images using the same document proxy
  const images: string[] = [];
  const pdfImagesMeta: Array<{
    id: string;
    src: string;
    pageNumber: number;
    width: number;
    height: number;
  }> = [];
  let imageCounter = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const pageImages = await extractImages(pdf, pageNum);
      for (let i = 0; i < pageImages.length; i++) {
        const imgData = pageImages[i];
        try {
          // Use sharp to convert raw image data to PNG base64
          const pngBuffer = await sharp(Buffer.from(imgData.data), {
            raw: {
              width: imgData.width,
              height: imgData.height,
              channels: imgData.channels,
            },
          })
            .png()
            .toBuffer();

          // Convert to base64
          const base64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
          imageCounter++;
          const imgId = `img_${imageCounter}`;
          images.push(base64);
          pdfImagesMeta.push({
            id: imgId,
            src: base64,
            pageNumber: pageNum,
            width: imgData.width,
            height: imgData.height,
          });
        } catch (sharpError) {
          log.error(`Failed to convert image ${i + 1} from page ${pageNum}:`, sharpError);
        }
      }
    } catch (pageError) {
      log.error(`Failed to extract images from page ${pageNum}:`, pageError);
    }
  }

  return {
    text: pdfText,
    images,
    metadata: {
      pageCount: numPages,
      parser: 'unpdf',
      imageMapping: Object.fromEntries(pdfImagesMeta.map((m) => [m.id, m.src])),
      pdfImages: pdfImagesMeta,
    },
  };
}

// ---------------------------------------------------------------------------
// MinerU cloud API helpers
// ---------------------------------------------------------------------------

const MINERU_CLOUD_HOST = 'https://mineru.net';
const MINERU_CLOUD_POLL_INIT_MS = 3000;
const MINERU_CLOUD_POLL_MAX_MS = 30000;
/** Default 15 min — large PDFs + VLM can exceed 5 min. Override with PDF_MINERU_CLOUD_TIMEOUT_MS (seconds). */
function getMinerUCloudPollTimeoutMs(): number {
  const raw = process.env.PDF_MINERU_CLOUD_TIMEOUT_MS?.trim();
  if (raw) {
    const sec = Number.parseInt(raw, 10);
    if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  }
  return 15 * 60 * 1000;
}

/** Official API returns `full_zip_url` when state=done (not `zip_url`). */
function extractMinerUResultZipUrl(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  const full = data.full_zip_url;
  const legacy = data.zip_url;
  if (typeof full === 'string' && full.length > 0) return full;
  if (typeof legacy === 'string' && legacy.length > 0) return legacy;
  return undefined;
}

/** Long presigned URLs clutter logs — keep origin + path + truncated tail. */
function truncateForLog(value: string, maxLen = 200): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}…(len=${value.length})`;
}

/**
 * Effective MinerU cloud API origin for REST calls.
 * Prefer `PDF_MINERU_BASE_URL` origin when set (e.g. https://mineru.net),
 * else `PDF_MINERU_CLOUD_API_BASE`, else https://mineru.net
 */
function resolveMinerUCloudApiBase(configBaseUrl?: string): string {
  const fromEnv = process.env.PDF_MINERU_CLOUD_API_BASE?.trim();
  if (fromEnv) {
    try {
      return new URL(fromEnv.startsWith('http') ? fromEnv : `https://${fromEnv}`).origin;
    } catch {
      log.warn(`[MinerU Cloud] Invalid PDF_MINERU_CLOUD_API_BASE, ignoring: ${fromEnv}`);
    }
  }
  if (configBaseUrl?.startsWith('http')) {
    try {
      return new URL(configBaseUrl).origin;
    } catch {
      /* fall through */
    }
  }
  return MINERU_CLOUD_HOST;
}

/** Returns true when the base URL points to the official MinerU cloud service. */
function isMinerUCloudMode(baseUrl: string): boolean {
  return baseUrl.includes('mineru.net');
}

/**
 * Ensure the PDF exists in MinIO and return a publicly accessible URL.
 *
 * Uses the SHA-256 hash of the file content as the object key so that
 * identical files are stored only once and reused across requests.
 * The object is never deleted — it serves as a permanent cache.
 */
async function ensurePdfInMinio(pdfBuffer: Buffer): Promise<string> {
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY || '';
  const bucket = process.env.MINIO_BUCKET || 'openmaic';

  if (!endpoint || !accessKey) {
    throw new Error(
      'MinIO is required for MinerU cloud mode. ' +
        'Please configure MINIO_ENDPOINT, MINIO_ACCESS_KEY, and MINIO_SECRET_KEY.',
    );
  }

  const client = new MinioClient({
    endPoint: endpoint,
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey,
    secretKey,
  });

  const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
  const key = `pdf/${hash}.pdf`;

  let alreadyExists = false;
  try {
    await client.statObject(bucket, key);
    alreadyExists = true;
  } catch {
    alreadyExists = false;
  }

  if (alreadyExists) {
    log.info(`[MinerU Cloud] Reusing cached PDF in MinIO: ${key}`);
  } else {
    await client.putObject(bucket, key, pdfBuffer, pdfBuffer.length, {
      'Content-Type': 'application/pdf',
    });
    log.info(`[MinerU Cloud] Uploaded PDF to MinIO: ${key} (${pdfBuffer.length} bytes)`);
  }

  const publicBaseUrl = process.env.MINIO_PUBLIC_URL?.replace(/\/$/, '');
  if (publicBaseUrl) {
    return `${publicBaseUrl}/${bucket}/${key}`;
  }
  // Presigned URL valid for 2 hours — enough for MinerU cloud to fetch the file.
  return client.presignedGetObject(bucket, key, 2 * 60 * 60);
}

/**
 * Parse PDF using the official MinerU cloud API (mineru.net).
 *
 * Flow:
 *   1. Upload PDF to MinIO (SHA-256 hash deduplication, permanent cache)
 *   2. POST /api/v4/extract/task — submit parse task
 *   3. GET  /api/v4/extract/task/{id} — poll with exponential back-off
 *   4. Download result zip in memory
 *   5. Extract markdown + images with JSZip (no disk I/O)
 *
 * @see https://mineru.net/doc/docs/
 */
async function parseWithMinerUCloud(
  config: PDFParserConfig,
  pdfBuffer: Buffer,
): Promise<ParsedPdfContent> {
  if (!config.apiKey) {
    throw new Error(
      'MinerU cloud API requires an API key (Token). ' +
        'Please set PDF_MINERU_API_KEY. ' +
        'See: https://mineru.net/apiManage',
    );
  }

  const apiBase = resolveMinerUCloudApiBase(config.baseUrl);
  const submitUrl = `${apiBase}/api/v4/extract/task`;
  const authHeaders = { Authorization: `Bearer ${config.apiKey}` };

  log.info(
    `[MinerU Cloud] Config: apiBase=${apiBase} ` +
      `(PDF_MINERU_BASE_URL / PDF_MINERU_CLOUD_API_BASE), submitUrl=${submitUrl}`,
  );

  // 1. Ensure PDF is in MinIO and get a public / presigned URL
  log.info('[MinerU Cloud] Ensuring PDF is available in MinIO...');
  const pdfUrl = await ensurePdfInMinio(pdfBuffer);
  log.info(`[MinerU Cloud] PDF URL for MinerU (truncated): ${truncateForLog(pdfUrl)}`);

  const submitBody = {
    url: pdfUrl,
    model_version: 'vlm' as const,
    enable_formula: true,
    enable_table: true,
  };
  log.info(
    `[MinerU Cloud] POST submit: url=${submitUrl} body=${JSON.stringify({
      ...submitBody,
      url: truncateForLog(pdfUrl),
    })}`,
  );

  // 2. Submit parse task
  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(submitBody),
  });

  const submitText = await submitRes.text();
  if (!submitRes.ok) {
    log.error(
      `[MinerU Cloud] Submit failed status=${submitRes.status} response=${truncateForLog(submitText, 800)}`,
    );
    throw new Error(`MinerU Cloud submit failed (${submitRes.status}): ${submitText}`);
  }

  let submitJson: Record<string, unknown>;
  try {
    submitJson = JSON.parse(submitText) as Record<string, unknown>;
  } catch {
    throw new Error(`MinerU Cloud: submit response is not JSON: ${truncateForLog(submitText, 500)}`);
  }

  const taskId: string = (submitJson?.data as { task_id?: string } | undefined)?.task_id ?? '';
  log.info(
    `[MinerU Cloud] Submit OK: task_id=${taskId || '(missing)'} raw=${truncateForLog(JSON.stringify(submitJson), 400)}`,
  );
  if (!taskId) {
    throw new Error(
      `MinerU Cloud: no task_id in response: ${JSON.stringify(submitJson)}`,
    );
  }

  // 3. Poll until done (exponential back-off: 3 s → 30 s; default timeout 15 min)
  const pollTimeoutMs = getMinerUCloudPollTimeoutMs();
  const deadline = Date.now() + pollTimeoutMs;
  let waitMs = MINERU_CLOUD_POLL_INIT_MS;
  let zipUrl: string | undefined;
  let pollRound = 0;
  let lastState = '';

  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, waitMs));
    waitMs = Math.min(Math.round(waitMs * 1.5), MINERU_CLOUD_POLL_MAX_MS);
    pollRound += 1;

    const pollUrl = `${apiBase}/api/v4/extract/task/${taskId}`;
    if (pollRound === 1) {
      log.info(`[MinerU Cloud] Polling: GET ${pollUrl}`);
    }

    const pollRes = await fetch(pollUrl, {
      headers: authHeaders,
    });

    if (!pollRes.ok) {
      const pollErrText = await pollRes.text().catch(() => pollRes.statusText);
      log.warn(
        `[MinerU Cloud] Poll HTTP ${pollRes.status} round=${pollRound} body=${truncateForLog(pollErrText, 400)}`,
      );
      continue;
    }

    const pollJson = (await pollRes.json()) as Record<string, unknown>;
    const apiCode = pollJson.code;
    if (typeof apiCode === 'number' && apiCode !== 0) {
      log.warn(
        `[MinerU Cloud] Poll round=${pollRound} non-zero code=${apiCode} msg=${String(pollJson.msg ?? '')}`,
      );
    }

    const data = pollJson?.data as Record<string, unknown> | undefined;
    const state: string = (data?.state as string) ?? 'unknown';
    lastState = state;
    log.info(
      `[MinerU Cloud] Poll round=${pollRound} state=${state} detail=${truncateForLog(JSON.stringify(pollJson), 500)}`,
    );

    if (state === 'done') {
      // Official docs: `full_zip_url` (legacy alias: zip_url)
      zipUrl = extractMinerUResultZipUrl(data);
      if (!zipUrl) {
        log.error(
          `[MinerU Cloud] state=done but missing full_zip_url: ${truncateForLog(JSON.stringify(pollJson), 1000)}`,
        );
        throw new Error(
          'MinerU Cloud: task finished (state=done) but full_zip_url was not returned. ' +
            'Check API version / response shape.',
        );
      }
      break;
    }
    if (state === 'failed') {
      const errMsg = (data?.err_msg as string) ?? 'unknown error';
      log.error(
        `[MinerU Cloud] Task failed: err_msg=${errMsg} full=${truncateForLog(JSON.stringify(pollJson), 1500)}`,
      );
      throw new Error(
        `MinerU Cloud task failed: ${errMsg} (apiBase=${apiBase}, pdfUrl=${truncateForLog(pdfUrl)}, task_id=${taskId})`,
      );
    }
  }

  if (!zipUrl) {
    throw new Error(
      `MinerU Cloud task timed out after ${pollTimeoutMs / 1000}s ` +
        `(task_id=${taskId}, apiBase=${apiBase}, lastState=${lastState || 'n/a'})`,
    );
  }

  // 4. Download result zip entirely in memory — no disk I/O, no cleanup needed
  log.info(`[MinerU Cloud] Downloading result zip: ${truncateForLog(zipUrl)}`);
  const zipArrayBuffer = await fetch(zipUrl).then((r) => r.arrayBuffer());
  const zipBuf = Buffer.from(new Uint8Array(zipArrayBuffer));

  // 5. Extract with JSZip in memory
  const zip = await JSZip.loadAsync(zipBuf);

  const mdFile = Object.values(zip.files).find((f) => !f.dir && f.name.endsWith('.md'));
  if (!mdFile) {
    throw new Error('MinerU Cloud: no markdown file found in result zip');
  }
  const markdown = await mdFile.async('string');

  const imageData: Record<string, string> = {};
  await Promise.all(
    Object.values(zip.files)
      .filter((f) => !f.dir && /^images\//i.test(f.name))
      .map(async (f) => {
        const b64 = await f.async('base64');
        const ext = f.name.split('.').pop()?.toLowerCase() ?? 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        const filename = f.name.split('/').pop()!;
        imageData[filename] = `data:${mime};base64,${b64}`;
      }),
  );

  // Reuse the existing result extractor for consistent output format
  return extractMinerUResult({ md_content: markdown, images: imageData });
}

// ---------------------------------------------------------------------------
// MinerU self-hosted implementation
// ---------------------------------------------------------------------------

/**
 * Parse PDF using self-hosted MinerU service (mineru-api)
 *
 * Official MinerU API endpoint:
 * POST /file_parse  (multipart/form-data)
 *
 * Response format:
 * { results: { "document.pdf": { md_content, images, content_list, ... } } }
 *
 * @see https://github.com/opendatalab/MinerU
 */
async function parseWithMinerU(
  config: PDFParserConfig,
  pdfBuffer: Buffer,
): Promise<ParsedPdfContent> {
  if (!config.baseUrl) {
    throw new Error(
      'MinerU base URL is required. ' +
        'Please deploy MinerU locally or specify the server URL. ' +
        'See: https://github.com/opendatalab/MinerU',
    );
  }

  // Auto-detect cloud vs self-hosted based on the base URL
  if (isMinerUCloudMode(config.baseUrl)) {
    return parseWithMinerUCloud(config, pdfBuffer);
  }

  log.info('[MinerU] Parsing PDF with MinerU server:', config.baseUrl);

  const fileName = 'document.pdf';

  // Create FormData for file upload
  const formData = new FormData();

  // Convert Buffer to Blob
  const arrayBuffer = pdfBuffer.buffer.slice(
    pdfBuffer.byteOffset,
    pdfBuffer.byteOffset + pdfBuffer.byteLength,
  );
  const blob = new Blob([arrayBuffer as ArrayBuffer], {
    type: 'application/pdf',
  });
  formData.append('files', blob, fileName);

  // MinerU API form fields
  // Defaults already: return_md=true, formula_enable=true, table_enable=true
  formData.append('parse_method', 'auto');
  // hybrid-auto-engine: best accuracy, uses VLM for layout understanding (requires GPU)
  // pipeline: basic mode, no VLM, faster but lower quality image extraction
  formData.append('backend', 'hybrid-auto-engine');
  formData.append('return_content_list', 'true');
  formData.append('return_images', 'true');

  // API key (if required by deployment)
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // POST /file_parse
  const response = await fetch(`${config.baseUrl}/file_parse`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`MinerU API error (${response.status}): ${errorText}`);
  }

  const json = await response.json();

  // Response: { results: { "<fileName>": { md_content, images, content_list, ... } } }
  const fileResult = json.results?.[fileName];
  if (!fileResult) {
    const keys = json.results ? Object.keys(json.results) : [];
    // Try first available key in case filename doesn't match exactly
    const fallback = keys.length > 0 ? json.results[keys[0]] : null;
    if (!fallback) {
      throw new Error(`MinerU returned no results. Response keys: ${JSON.stringify(keys)}`);
    }
    log.warn(`[MinerU] Filename mismatch, using key "${keys[0]}" instead of "${fileName}"`);
    return extractMinerUResult(fallback);
  }

  return extractMinerUResult(fileResult);
}

/** Extract ParsedPdfContent from a single MinerU file result */
function extractMinerUResult(fileResult: Record<string, unknown>): ParsedPdfContent {
  const markdown: string = (fileResult.md_content as string) || '';
  const imageData: Record<string, string> = {};
  let pageCount = 0;

  // Extract images from the images object (key → base64 string)
  if (fileResult.images && typeof fileResult.images === 'object') {
    Object.entries(fileResult.images as Record<string, string>).forEach(([key, value]) => {
      imageData[key] = value.startsWith('data:') ? value : `data:image/png;base64,${value}`;
    });
  }

  // Parse content_list to build image metadata lookup (img_path → metadata)
  const imageMetaLookup = new Map<string, { pageIdx: number; bbox: number[]; caption?: string }>();
  const contentList =
    typeof fileResult.content_list === 'string'
      ? JSON.parse(fileResult.content_list as string)
      : fileResult.content_list;
  if (Array.isArray(contentList)) {
    const pages = new Set(
      contentList
        .map((item: Record<string, unknown>) => item.page_idx)
        .filter((v: unknown) => v != null),
    );
    pageCount = pages.size;

    for (const item of contentList) {
      if (item.type === 'image' && item.img_path) {
        const metaEntry = {
          pageIdx: item.page_idx ?? 0,
          bbox: item.bbox || [0, 0, 1000, 1000],
          caption: Array.isArray(item.image_caption) ? item.image_caption[0] : undefined,
        };
        // Store under both the full path and basename so lookup works
        // regardless of whether images dict uses "abc.jpg" or "images/abc.jpg"
        imageMetaLookup.set(item.img_path, metaEntry);
        const basename = item.img_path.split('/').pop();
        if (basename && basename !== item.img_path) {
          imageMetaLookup.set(basename, metaEntry);
        }
      }
    }
  }

  // Build image mapping and pdfImages array
  const imageMapping: Record<string, string> = {};
  const pdfImages: Array<{
    id: string;
    src: string;
    pageNumber: number;
    description?: string;
    width?: number;
    height?: number;
  }> = [];

  Object.entries(imageData).forEach(([key, base64Url], index) => {
    const imageId = key.startsWith('img_') ? key : `img_${index + 1}`;
    imageMapping[imageId] = base64Url;
    // Try exact key first, then with 'images/' prefix (MinerU content_list uses prefixed paths)
    const meta = imageMetaLookup.get(key) || imageMetaLookup.get(`images/${key}`);
    pdfImages.push({
      id: imageId,
      src: base64Url,
      pageNumber: meta ? meta.pageIdx + 1 : 0,
      description: meta?.caption,
      width: meta ? meta.bbox[2] - meta.bbox[0] : undefined,
      height: meta ? meta.bbox[3] - meta.bbox[1] : undefined,
    });
  });

  const images = Object.values(imageMapping);

  log.info(
    `[MinerU] Parsed successfully: ${images.length} images, ` +
      `${markdown.length} chars of markdown`,
  );

  return {
    text: markdown,
    images,
    metadata: {
      pageCount,
      parser: 'mineru',
      imageMapping,
      pdfImages,
    },
  };
}

// ---------------------------------------------------------------------------
// Async submit / poll / process — serverless-friendly API
// ---------------------------------------------------------------------------

/** Result of submitPDFParse when the provider is synchronous (e.g. unpdf). */
export interface PDFSubmitSyncResult {
  async: false;
  data: ParsedPdfContent;
}

/** Result of submitPDFParse when the provider is asynchronous (MinerU cloud). */
export interface PDFSubmitAsyncResult {
  async: true;
  taskId: string;
  provider: 'mineru-cloud';
  /** Resolved MinerU API base URL — needed for subsequent poll calls. */
  apiBase: string;
}

export type PDFSubmitResult = PDFSubmitSyncResult | PDFSubmitAsyncResult;

/** Result of a single poll call. */
export interface PDFPollResult {
  /** 'processing' | 'done' | 'failed' */
  status: 'processing' | 'done' | 'failed';
  /** Present when status === 'done'. */
  data?: ParsedPdfContent;
  /** Present when status === 'failed'. */
  error?: string;
}

/**
 * Submit a PDF for parsing. For synchronous providers (unpdf, MinerU self-hosted)
 * this returns the full result immediately. For MinerU cloud it uploads the PDF
 * to MinIO, submits the task, and returns a taskId — completing in ~1-2 s, well
 * within serverless timeout limits.
 */
export async function submitPDFParse(
  config: PDFParserConfig,
  pdfBuffer: Buffer,
): Promise<PDFSubmitResult> {
  const provider = PDF_PROVIDERS[config.providerId];
  if (!provider) {
    throw new Error(`Unknown PDF provider: ${config.providerId}`);
  }
  if (provider.requiresApiKey && !config.apiKey) {
    throw new Error(`API key required for PDF provider: ${config.providerId}`);
  }

  // For MinerU cloud mode, use the async path
  if (config.providerId === 'mineru' && config.baseUrl && isMinerUCloudMode(config.baseUrl)) {
    return submitMinerUCloudTask(config, pdfBuffer);
  }

  // All other providers (unpdf, MinerU self-hosted) run synchronously
  const startTime = Date.now();
  let result: ParsedPdfContent;

  switch (config.providerId) {
    case 'unpdf':
      result = await parseWithUnpdf(pdfBuffer);
      break;
    case 'mineru':
      result = await parseWithMinerU(config, pdfBuffer);
      break;
    default:
      throw new Error(`Unsupported PDF provider: ${config.providerId}`);
  }

  if (result.metadata) {
    result.metadata.processingTime = Date.now() - startTime;
  }
  return { async: false, data: result };
}

/**
 * Submit a MinerU Cloud task: upload to MinIO + POST /extract/task.
 * Returns within ~1-2 seconds.
 */
async function submitMinerUCloudTask(
  config: PDFParserConfig,
  pdfBuffer: Buffer,
): Promise<PDFSubmitAsyncResult> {
  if (!config.apiKey) {
    throw new Error(
      'MinerU cloud API requires an API key (Token). ' +
        'Please set PDF_MINERU_API_KEY. ' +
        'See: https://mineru.net/apiManage',
    );
  }

  const apiBase = resolveMinerUCloudApiBase(config.baseUrl);
  const submitUrl = `${apiBase}/api/v4/extract/task`;
  const authHeaders = { Authorization: `Bearer ${config.apiKey}` };

  log.info(
    `[MinerU Cloud] Async submit: apiBase=${apiBase}, submitUrl=${submitUrl}`,
  );

  // 1. Ensure PDF is in MinIO and get a public / presigned URL
  log.info('[MinerU Cloud] Ensuring PDF is available in MinIO...');
  const pdfUrl = await ensurePdfInMinio(pdfBuffer);
  log.info(`[MinerU Cloud] PDF URL (truncated): ${truncateForLog(pdfUrl)}`);

  const submitBody = {
    url: pdfUrl,
    model_version: 'vlm' as const,
    enable_formula: true,
    enable_table: true,
  };

  // 2. Submit parse task
  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(submitBody),
  });

  const submitText = await submitRes.text();
  if (!submitRes.ok) {
    log.error(
      `[MinerU Cloud] Submit failed status=${submitRes.status} response=${truncateForLog(submitText, 800)}`,
    );
    throw new Error(`MinerU Cloud submit failed (${submitRes.status}): ${submitText}`);
  }

  let submitJson: Record<string, unknown>;
  try {
    submitJson = JSON.parse(submitText) as Record<string, unknown>;
  } catch {
    throw new Error(`MinerU Cloud: submit response is not JSON: ${truncateForLog(submitText, 500)}`);
  }

  const taskId: string = (submitJson?.data as { task_id?: string } | undefined)?.task_id ?? '';
  log.info(
    `[MinerU Cloud] Submit OK: task_id=${taskId || '(missing)'} raw=${truncateForLog(JSON.stringify(submitJson), 400)}`,
  );
  if (!taskId) {
    throw new Error(
      `MinerU Cloud: no task_id in response: ${JSON.stringify(submitJson)}`,
    );
  }

  return { async: true, taskId, provider: 'mineru-cloud', apiBase };
}

/**
 * Poll a MinerU Cloud task **once**. Returns within ~200 ms.
 *
 * Call this from the `/api/parse-pdf/poll` route. The frontend drives the
 * polling loop via `setInterval`, so each individual poll request stays well
 * under any serverless timeout.
 */
export async function pollMinerUCloudTask(
  taskId: string,
  apiKey: string,
  apiBase: string,
): Promise<PDFPollResult> {
  const authHeaders = { Authorization: `Bearer ${apiKey}` };
  const pollUrl = `${apiBase}/api/v4/extract/task/${taskId}`;

  log.info(`[MinerU Cloud] Poll: GET ${pollUrl}`);

  const pollRes = await fetch(pollUrl, { headers: authHeaders });

  if (!pollRes.ok) {
    const pollErrText = await pollRes.text().catch(() => pollRes.statusText);
    log.warn(
      `[MinerU Cloud] Poll HTTP ${pollRes.status} body=${truncateForLog(pollErrText, 400)}`,
    );
    // Non-fatal HTTP errors (e.g. 502 gateway) → treat as still processing
    return { status: 'processing' };
  }

  const pollJson = (await pollRes.json()) as Record<string, unknown>;
  const data = pollJson?.data as Record<string, unknown> | undefined;
  const state: string = (data?.state as string) ?? 'unknown';

  log.info(
    `[MinerU Cloud] Poll state=${state} detail=${truncateForLog(JSON.stringify(pollJson), 500)}`,
  );

  if (state === 'done') {
    const zipUrl = extractMinerUResultZipUrl(data);
    if (!zipUrl) {
      return {
        status: 'failed',
        error:
          'MinerU Cloud: task finished (state=done) but full_zip_url was not returned.',
      };
    }

    // Download and extract the result within this same request
    const result = await processMinerUCloudZip(zipUrl);
    return { status: 'done', data: result };
  }

  if (state === 'failed') {
    const errMsg = (data?.err_msg as string) ?? 'unknown error';
    return { status: 'failed', error: `MinerU Cloud task failed: ${errMsg}` };
  }

  // Any other state (pending, running, etc.)
  return { status: 'processing' };
}

/**
 * Download and extract a MinerU Cloud result ZIP. Runs in-memory with JSZip.
 */
async function processMinerUCloudZip(zipUrl: string): Promise<ParsedPdfContent> {
  log.info(`[MinerU Cloud] Downloading result zip: ${truncateForLog(zipUrl)}`);
  const zipArrayBuffer = await fetch(zipUrl).then((r) => r.arrayBuffer());
  const zipBuf = Buffer.from(new Uint8Array(zipArrayBuffer));

  const zip = await JSZip.loadAsync(zipBuf);

  const mdFile = Object.values(zip.files).find((f) => !f.dir && f.name.endsWith('.md'));
  if (!mdFile) {
    throw new Error('MinerU Cloud: no markdown file found in result zip');
  }
  const markdown = await mdFile.async('string');

  const imageData: Record<string, string> = {};
  await Promise.all(
    Object.values(zip.files)
      .filter((f) => !f.dir && /^images\//i.test(f.name))
      .map(async (f) => {
        const b64 = await f.async('base64');
        const ext = f.name.split('.').pop()?.toLowerCase() ?? 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        const filename = f.name.split('/').pop()!;
        imageData[filename] = `data:${mime};base64,${b64}`;
      }),
  );

  return extractMinerUResult({ md_content: markdown, images: imageData });
}

/**
 * Get current PDF parser configuration from settings store
 * Note: This function should only be called in browser context
 */
export async function getCurrentPDFConfig(): Promise<PDFParserConfig> {
  if (typeof window === 'undefined') {
    throw new Error('getCurrentPDFConfig() can only be called in browser context');
  }

  // Dynamic import to avoid circular dependency
  const { useSettingsStore } = await import('@/lib/store/settings');
  const { pdfProviderId, pdfProvidersConfig } = useSettingsStore.getState();

  const providerConfig = pdfProvidersConfig?.[pdfProviderId];

  return {
    providerId: pdfProviderId,
    apiKey: providerConfig?.apiKey,
    baseUrl: providerConfig?.baseUrl,
  };
}

// Re-export from constants for convenience
export { getAllPDFProviders, getPDFProvider } from './constants';
