/**
 * Single Scene Outline Regeneration API (non-streaming)
 *
 * Regenerates ONE scene outline based on:
 *   - The original course requirements + reference materials
 *   - The previous draft (`allOutlines`) so the model has full context
 *   - The target outline (`targetOutline`) the user wants revised
 *   - Optional `userFeedback` from the editor
 *
 * Returns: { success: true, outline: SceneOutline }
 *
 * Used by the outline editor on the generation-preview page when the user
 * clicks "regenerate" on a single card.
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { buildPrompt, PROMPT_IDS } from '@/lib/generation/prompts';
import {
  formatImageDescription,
  formatImagePlaceholder,
  buildVisionUserContent,
  uniquifyMediaElementIds,
  formatTeacherPersonaForPrompt,
} from '@/lib/generation/generation-pipeline';
import type { AgentInfo } from '@/lib/generation/generation-pipeline';
import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from '@/lib/constants/generation';
import { withAuthAndCredits } from '@/lib/server/api-auth-credits';
import type {
  UserRequirements,
  PdfImage,
  SceneOutline,
  ImageMapping,
} from '@/lib/types/generation';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

const log = createLogger('Outline Single');

export const maxDuration = 120;

/**
 * Pull the first valid JSON object out of a possibly-fenced LLM response.
 */
function extractFirstObject(text: string): SceneOutline | null {
  const stripped = text.replace(/^[\s\S]*?(?=\{)/, '');
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          return JSON.parse(stripped.substring(start, i + 1)) as SceneOutline;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const auth = await withAuthAndCredits();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();

    const { model: languageModel, modelInfo, modelString } = resolveModelFromHeaders(req);

    if (!body.requirements || !body.targetOutline) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'requirements and targetOutline are required',
      );
    }

    const {
      requirements,
      pdfText,
      pdfImages,
      imageMapping,
      researchContext,
      agents,
      targetOutline,
      allOutlines,
      userFeedback,
    } = body as {
      requirements: UserRequirements;
      pdfText?: string;
      pdfImages?: PdfImage[];
      imageMapping?: ImageMapping;
      researchContext?: string;
      agents?: AgentInfo[];
      targetOutline: SceneOutline;
      allOutlines?: SceneOutline[];
      userFeedback?: string;
    };

    const isChinese = requirements.language?.startsWith('zh');
    const hasVision = !!modelInfo?.capabilities?.vision;

    // Build available-images section (mirrors scene-outlines-stream)
    let availableImagesText = isChinese ? '无可用图片' : 'No images available';
    let visionImages: Array<{ id: string; src: string; width?: number; height?: number }> | undefined;

    if (pdfImages && pdfImages.length > 0) {
      if (hasVision && imageMapping) {
        const allWithSrc = pdfImages.filter((img) => imageMapping[img.id]);
        const visionSlice = allWithSrc.slice(0, MAX_VISION_IMAGES);
        const textOnlySlice = allWithSrc.slice(MAX_VISION_IMAGES);
        const noSrcImages = pdfImages.filter((img) => !imageMapping[img.id]);

        const visionDescriptions = visionSlice.map((img) =>
          formatImagePlaceholder(img, requirements.language),
        );
        const textDescriptions = [...textOnlySlice, ...noSrcImages].map((img) =>
          formatImageDescription(img, requirements.language),
        );
        availableImagesText = [...visionDescriptions, ...textDescriptions].join('\n');

        visionImages = visionSlice.map((img) => ({
          id: img.id,
          src: imageMapping[img.id],
          width: img.width,
          height: img.height,
        }));
      } else {
        availableImagesText = pdfImages
          .map((img) => formatImageDescription(img, requirements.language))
          .join('\n');
      }
    }

    // Same media-generation policy plumbing as the streaming endpoint
    const imageGenerationEnabled = req.headers.get('x-image-generation-enabled') === 'true';
    const videoGenerationEnabled = req.headers.get('x-video-generation-enabled') === 'true';
    let mediaGenerationPolicy = '';
    if (!imageGenerationEnabled && !videoGenerationEnabled) {
      mediaGenerationPolicy =
        '**IMPORTANT: Do NOT include any mediaGenerations in the outline.**';
    } else if (!imageGenerationEnabled) {
      mediaGenerationPolicy =
        '**IMPORTANT: Do NOT include any image mediaGenerations.**';
    } else if (!videoGenerationEnabled) {
      mediaGenerationPolicy =
        '**IMPORTANT: Do NOT include any video mediaGenerations.**';
    }

    const teacherContext = formatTeacherPersonaForPrompt(agents);

    const targetJson = JSON.stringify(targetOutline, null, 2);
    const fullDraftJson = allOutlines ? JSON.stringify(allOutlines, null, 2) : '[]';
    const trimmedFeedback = userFeedback?.trim() || '';

    const revisionInstructions = isChinese
      ? `\n## 单场景修订任务\n\n用户希望仅重新生成下面这一个场景节点（保持其它场景不变）。请只输出修订后的**单个 JSON 对象**，不要包裹在数组里、不要附加额外说明。\n\n### 当前场景（待修订）\n\n\`\`\`json\n${targetJson}\n\`\`\`\n\n### 完整大纲上下文（仅供参考，请保持顺序号 order=${targetOutline.order}）\n\n\`\`\`json\n${fullDraftJson}\n\`\`\`\n\n### 用户反馈\n\n${trimmedFeedback || '（用户未填写具体反馈，请基于上下文做整体优化）'}\n\n请保留 \`id\` 与 \`order\` 字段不变，重写其余字段使其符合反馈意图。\n`
      : `\n## Single Scene Revision Task\n\nThe user wants to regenerate only ONE scene below (other scenes stay untouched). Output a SINGLE revised JSON object — do NOT wrap it in an array and do NOT add commentary.\n\n### Target Scene (to revise)\n\n\`\`\`json\n${targetJson}\n\`\`\`\n\n### Full Outline Context (for reference; keep order=${targetOutline.order})\n\n\`\`\`json\n${fullDraftJson}\n\`\`\`\n\n### User Feedback\n\n${trimmedFeedback || '(No specific feedback — improve overall quality.)'}\n\nKeep the original \`id\` and \`order\`. Rewrite other fields per the feedback.\n`;

    const prompts = buildPrompt(PROMPT_IDS.REQUIREMENTS_TO_OUTLINES, {
      requirement: requirements.requirement,
      language: requirements.language,
      pdfContent: pdfText
        ? pdfText.substring(0, MAX_PDF_CONTENT_CHARS)
        : isChinese
          ? '无'
          : 'None',
      availableImages: availableImagesText,
      researchContext: researchContext || (isChinese ? '无' : 'None'),
      mediaGenerationPolicy,
      teacherContext,
      revisionInstructions,
    });

    if (!prompts) {
      return apiError('INTERNAL_ERROR', 500, 'Prompt template not found');
    }

    log.info(
      `Regenerating single outline: id=${targetOutline.id} order=${targetOutline.order} [model=${modelString}]`,
    );

    const callParams = visionImages?.length
      ? {
          model: languageModel,
          system: prompts.system,
          messages: [
            {
              role: 'user' as const,
              content: buildVisionUserContent(prompts.user, visionImages),
            },
          ],
          maxOutputTokens: modelInfo?.outputWindow,
        }
      : {
          model: languageModel,
          system: prompts.system,
          prompt: prompts.user,
          maxOutputTokens: modelInfo?.outputWindow,
        };

    const result = await callLLM(callParams, 'scene-outline-single', {
      retries: 1,
      validate: (text) => extractFirstObject(text) != null,
    });

    const parsed = extractFirstObject(result.text);
    if (!parsed) {
      return apiError('INTERNAL_ERROR', 502, 'Model did not return a valid outline object');
    }

    // Preserve identity & order so the editor can drop-in replace
    parsed.id = targetOutline.id;
    parsed.order = targetOutline.order;
    if (!parsed.language && requirements.language) {
      parsed.language = requirements.language;
    }

    // Re-uniquify any mediaGenerations so they don't collide with sibling scenes
    if (allOutlines && allOutlines.length > 0) {
      const replaced = allOutlines.map((o) => (o.id === targetOutline.id ? parsed : o));
      uniquifyMediaElementIds(replaced);
    }

    return apiSuccess({ outline: parsed });
  } catch (err) {
    log.error('scene-outline-single failed:', err);
    return apiError('INTERNAL_ERROR', 500, err instanceof Error ? err.message : 'Unknown error');
  }
}
