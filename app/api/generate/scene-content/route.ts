/**
 * Scene Content Generation API
 *
 * Generates scene content (slides/quiz/interactive/pbl) from an outline.
 * This is the first half of the two-step scene generation pipeline.
 * Does NOT generate actions — use /api/generate/scene-actions for that.
 */

import { NextRequest, NextResponse } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import {
  applyOutlineFallbacks,
  generateSceneContent,
  buildVisionUserContent,
} from '@/lib/generation/generation-pipeline';
import type { AgentInfo } from '@/lib/generation/generation-pipeline';
import type { SceneOutline, PdfImage, ImageMapping } from '@/lib/types/generation';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { withAuthAndCredits, recordUsage } from '@/lib/server/api-auth-credits';
import { assertMenuPerm, ForbiddenError } from '@/lib/server/menu-guard';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

const log = createLogger('Scene Content API');

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await withAuthAndCredits();
  if (!auth.ok) return auth.response;

  let outlineTitle: string | undefined;
  let resolvedModelString: string | undefined;
  try {
    const body = await req.json();
    const {
      outline: rawOutline,
      allOutlines,
      pdfImages,
      imageMapping,
      stageInfo,
      stageId,
      agents,
    } = body as {
      outline: SceneOutline;
      allOutlines: SceneOutline[];
      pdfImages?: PdfImage[];
      imageMapping?: ImageMapping;
      stageInfo: {
        name: string;
        description?: string;
        language?: string;
        style?: string;
      };
      stageId: string;
      agents?: AgentInfo[];
    };

    // Validate required fields
    if (!rawOutline) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'outline is required');
    }
    if (!allOutlines || allOutlines.length === 0) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'allOutlines is required and must not be empty',
      );
    }
    if (!stageId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'stageId is required');
    }

    // RBAC: if the stageId points to an existing classroom in the DB,
    // the caller is in the "add scene to existing classroom" flow. Gate
    // on three layers:
    //   (1) `sidebar.addScene`              — parent: any add-scene
    //   (2) `sidebar.addScene.{type}`       — per-type: slide/quiz/interactive
    //   (3) `sidebar.addScene.{position}`   — per-position: append vs insert
    // Initial classroom-creation flows (no DB row yet) bypass this check
    // entirely so the original generation pipeline keeps working unchanged.
    // `pbl` outlines also bypass per-type since they're never produced
    // through the AddSceneDialog UI.
    if (isDbConfigured()) {
      try {
        const db = getDb();
        const classroom = await db.query.classrooms.findFirst({
          where: eq(schema.classrooms.id, stageId),
          columns: { id: true, userId: true, scenesJson: true },
        });
        if (classroom) {
          const isResourceOwner = classroom.userId === auth.user.id;
          const guardCtx = { isResourceOwner, resourceId: stageId };

          await assertMenuPerm(auth.user, 'sidebar.addScene', 'operable', guardCtx);

          // Per-type gate. Only enforce when the type is one of the
          // dialog-creatable kinds; `pbl` and unknown types fall through
          // to the parent gate alone.
          const outlineType = rawOutline?.type;
          if (
            outlineType === 'slide' ||
            outlineType === 'quiz' ||
            outlineType === 'interactive'
          ) {
            await assertMenuPerm(
              auth.user,
              `sidebar.addScene.${outlineType}`,
              'operable',
              guardCtx,
            );
          }

          // Per-position gate. Scenes are stored as a JSONB array on
          // the classroom row, so derive max order in JS rather than via
          // a separate scenes table query. Requested order > max → append.
          const persistedScenes = Array.isArray(classroom.scenesJson)
            ? (classroom.scenesJson as Array<{ order?: number }>)
            : [];
          const maxOrder = persistedScenes.reduce(
            (acc, s) => (typeof s.order === 'number' && s.order > acc ? s.order : acc),
            0,
          );
          const requestedOrder = rawOutline?.order ?? maxOrder + 1;
          const isAppend = requestedOrder > maxOrder;
          await assertMenuPerm(
            auth.user,
            isAppend ? 'sidebar.addScene.append' : 'sidebar.addScene.insert',
            'operable',
            guardCtx,
          );
        }
      } catch (err) {
        if (err instanceof ForbiddenError) {
          return NextResponse.json(
            { error: 'Forbidden', detail: err.message },
            { status: 403 },
          );
        }
        throw err;
      }
    }

    // Ensure outline has language from stageInfo (fallback for older outlines)
    const outline: SceneOutline = {
      ...rawOutline,
      language: rawOutline.language || stageInfo?.language || 'en-US',
    };

    // ── Model resolution from request headers ──
    const { model: languageModel, modelInfo, modelString } = resolveModelFromHeaders(req);
    outlineTitle = rawOutline?.title;
    resolvedModelString = modelString;

    // Detect vision capability
    const hasVision = !!modelInfo?.capabilities?.vision;

    // Vision-aware AI call function
    const aiCall = async (
      systemPrompt: string,
      userPrompt: string,
      images?: Array<{ id: string; src: string }>,
    ): Promise<string> => {
      if (images?.length && hasVision) {
        const result = await callLLM(
          {
            model: languageModel,
            system: systemPrompt,
            messages: [
              {
                role: 'user' as const,
                content: buildVisionUserContent(userPrompt, images),
              },
            ],
            maxOutputTokens: modelInfo?.outputWindow,
          },
          'scene-content',
        );
        return result.text;
      }
      const result = await callLLM(
        {
          model: languageModel,
          system: systemPrompt,
          prompt: userPrompt,
          maxOutputTokens: modelInfo?.outputWindow,
        },
        'scene-content',
      );
      return result.text;
    };

    // ── Apply fallbacks ──
    const effectiveOutline = applyOutlineFallbacks(outline, !!languageModel);

    // ── Filter images assigned to this outline ──
    let assignedImages: PdfImage[] | undefined;
    if (
      pdfImages &&
      pdfImages.length > 0 &&
      effectiveOutline.suggestedImageIds &&
      effectiveOutline.suggestedImageIds.length > 0
    ) {
      const suggestedIds = new Set(effectiveOutline.suggestedImageIds);
      assignedImages = pdfImages.filter((img) => suggestedIds.has(img.id));
    }

    // ── Media generation is handled client-side in parallel (media-orchestrator.ts) ──
    // The content generator receives placeholder IDs (gen_img_1, gen_vid_1) as-is.
    // resolveImageIds() in generation-pipeline.ts will keep these placeholders in elements.
    const generatedMediaMapping: ImageMapping = {};

    // ── Generate content ──
    log.info(
      `Generating content: "${effectiveOutline.title}" (${effectiveOutline.type}) [model=${modelString}]`,
    );

    const content = await generateSceneContent(
      effectiveOutline,
      aiCall,
      assignedImages,
      imageMapping,
      effectiveOutline.type === 'pbl' ? languageModel : undefined,
      hasVision,
      generatedMediaMapping,
      agents,
    );

    if (!content) {
      log.error(`Failed to generate content for: "${effectiveOutline.title}"`);

      return apiError(
        'GENERATION_FAILED',
        500,
        `Failed to generate content: ${effectiveOutline.title}`,
      );
    }

    log.info(`Content generated successfully: "${effectiveOutline.title}"`);

    recordUsage(auth.user.id, {
      type: 'llm',
      tokenCount: 2000,
      apiRoute: '/api/generate/scene-content',
      description: `Scene content: ${effectiveOutline.title}`,
    }).catch(() => {});

    return apiSuccess({ content, effectiveOutline });
  } catch (error) {
    log.error(
      `Scene content generation failed [scene="${outlineTitle ?? 'unknown'}", model=${resolvedModelString ?? 'unknown'}]:`,
      error,
    );
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
