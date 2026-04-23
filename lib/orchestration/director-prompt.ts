/**
 * Director Prompt Builder
 *
 * Constructs the system prompt for the director agent that decides
 * which agent should respond next in a multi-agent conversation.
 */

import type { AgentConfig } from '@/lib/orchestration/registry/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('DirectorPrompt');

/**
 * A single whiteboard action performed by an agent, recorded in the ledger.
 */
export interface WhiteboardActionRecord {
  actionName:
    | 'wb_draw_text'
    | 'wb_draw_shape'
    | 'wb_draw_chart'
    | 'wb_draw_latex'
    | 'wb_draw_table'
    | 'wb_draw_line'
    | 'wb_clear'
    | 'wb_delete'
    | 'wb_open'
    | 'wb_close';
  agentId: string;
  agentName: string;
  params: Record<string, unknown>;
}

/**
 * Summary of an agent's turn in the current round
 */
export interface AgentTurnSummary {
  agentId: string;
  agentName: string;
  contentPreview: string;
  actionCount: number;
  whiteboardActions: WhiteboardActionRecord[];
}

/**
 * Build the system prompt for the director agent
 *
 * @param agents - Available agent configurations
 * @param conversationSummary - Condensed summary of recent conversation
 * @param agentResponses - Agents that have already responded this round
 * @param turnCount - Current turn number in this round
 */
export function buildDirectorPrompt(
  agents: AgentConfig[],
  conversationSummary: string,
  agentResponses: AgentTurnSummary[],
  turnCount: number,
  discussionContext?: { topic: string; prompt?: string } | null,
  triggerAgentId?: string | null,
  whiteboardLedger?: WhiteboardActionRecord[],
  userProfile?: { nickname?: string; bio?: string },
  whiteboardOpen?: boolean,
): string {
  const agentList = agents
    .map((a) => `- id: "${a.id}", name: "${a.name}", role: ${a.role}, priority: ${a.priority}`)
    .join('\n');

  const respondedList =
    agentResponses.length > 0
      ? agentResponses
          .map((r) => {
            const wbSummary = summarizeAgentWhiteboardActions(r.whiteboardActions);
            const wbPart = wbSummary ? ` | Whiteboard: ${wbSummary}` : '';
            return `- ${r.agentName} (${r.agentId}): "${r.contentPreview}" [${r.actionCount} actions${wbPart}]`;
          })
          .join('\n')
      : 'None yet.';

  const isDiscussion = !!discussionContext;

  const discussionSection = isDiscussion
    ? `\n# Discussion Mode
Topic: "${discussionContext!.topic}"${discussionContext!.prompt ? `\nPrompt: "${discussionContext!.prompt}"` : ''}${triggerAgentId ? `\nInitiator: "${triggerAgentId}"` : ''}
This is a student-initiated discussion, not a Q&A session.\n`
    : '';

  const rule1 = isDiscussion
    ? `1. The discussion initiator${triggerAgentId ? ` ("${triggerAgentId}")` : ''} should speak first to kick off the topic. Then the teacher responds to guide the discussion. After that, other students may add their perspectives.`
    : "1. The teacher (role: teacher, highest priority) should usually speak first to address the user's question or topic.";

  // Build whiteboard state section for director awareness
  const whiteboardSection = buildWhiteboardStateForDirector(whiteboardLedger);

  // Build student profile section for director awareness
  const studentProfileSection =
    userProfile?.nickname || userProfile?.bio
      ? `
# Student Profile
Student name: ${userProfile.nickname || 'Unknown'}
${userProfile.bio ? `Background: ${userProfile.bio}` : ''}
`
      : '';

  return `You are the Director of a multi-agent classroom. Your job is to decide which agent should speak next based on the conversation context.

# Available Agents
${agentList}

# Agents Who Already Spoke This Round
${respondedList}

# Conversation Context
${conversationSummary}
${discussionSection}${whiteboardSection}${studentProfileSection}
# Rules
${rule1}
2. After the teacher, consider whether a student agent would add value (ask a follow-up question, crack a joke, take notes, offer a different perspective).
3. Do NOT repeat an agent who already spoke this round unless absolutely necessary.
4. If the conversation seems complete (question answered, topic covered), output END.
5. Current turn: ${turnCount + 1}. Consider conversation length — don't let discussions drag on unnecessarily.
6. Prefer brevity — 1-2 agents responding is usually enough. Don't force every agent to speak.
7. You can output {"next_agent":"USER"} to cue the user to speak. Use this when a student asks the user a direct question or when the topic naturally calls for user input.
8. Consider whiteboard state when routing: if the whiteboard is already crowded, avoid dispatching agents that are likely to add more whiteboard content unless they would clear or organize it.
9. Whiteboard is currently ${whiteboardOpen ? 'OPEN (slide canvas is hidden — spotlight/laser will not work)' : 'CLOSED (slide canvas is visible)'}. When the whiteboard is open, do not expect spotlight or laser actions to have visible effect.

# Routing Quality (CRITICAL)
- ROLE DIVERSITY: Do NOT dispatch two agents of the same role consecutively. After a teacher speaks, the next should be a student or assistant — not another teacher-like response. After an assistant rephrases, dispatch a student who asks a question, not another assistant who also rephrases.
- CONTENT DEDUP: Read the "Agents Who Already Spoke" previews carefully. If an agent already explained a concept thoroughly, do NOT dispatch another agent to explain the same concept. Instead, dispatch an agent who will ASK a question, CHALLENGE an assumption, CONNECT to another topic, or TAKE NOTES.
- DISCUSSION PROGRESSION: Each new agent should advance the conversation. Good progression: explain → question → deeper explanation → different perspective → summary. Bad progression: explain → re-explain → rephrase → paraphrase.
- GREETING RULE: If any agent has already greeted the students, no subsequent agent should greet again. Check the previews for greetings.

# Output Format
You MUST output ONLY a JSON object, nothing else:
{"next_agent":"<agent_id>"}
or
{"next_agent":"USER"}
or
{"next_agent":"END"}`;
}

/**
 * Summarize a single agent's whiteboard actions into a compact description.
 */
function summarizeAgentWhiteboardActions(actions: WhiteboardActionRecord[]): string {
  if (!actions || actions.length === 0) return '';

  const parts: string[] = [];
  for (const a of actions) {
    switch (a.actionName) {
      case 'wb_draw_text': {
        const content = String(a.params.content || '').slice(0, 30);
        parts.push(`drew text "${content}${content.length >= 30 ? '...' : ''}"`);
        break;
      }
      case 'wb_draw_shape':
        parts.push(`drew shape(${a.params.type || 'rectangle'})`);
        break;
      case 'wb_draw_chart': {
        const labels = Array.isArray(a.params.labels)
          ? a.params.labels
          : (a.params.data as Record<string, unknown>)?.labels;
        const chartType = a.params.chartType || a.params.type || 'bar';
        parts.push(
          `drew chart(${chartType}${labels ? `, labels: [${(labels as string[]).slice(0, 4).join(',')}]` : ''})`,
        );
        break;
      }
      case 'wb_draw_latex': {
        const latex = String(a.params.latex || '').slice(0, 30);
        parts.push(`drew formula "${latex}${latex.length >= 30 ? '...' : ''}"`);
        break;
      }
      case 'wb_draw_table': {
        const data = a.params.data as unknown[][] | undefined;
        const rows = data?.length || 0;
        const cols = (data?.[0] as unknown[])?.length || 0;
        parts.push(`drew table(${rows}×${cols})`);
        break;
      }
      case 'wb_draw_line': {
        const pts = a.params.points as string[] | undefined;
        const hasArrow = pts?.includes('arrow') ? ' arrow' : '';
        parts.push(`drew${hasArrow} line`);
        break;
      }
      case 'wb_clear':
        parts.push('CLEARED whiteboard');
        break;
      case 'wb_delete':
        parts.push(`deleted element "${a.params.elementId}"`);
        break;
      case 'wb_open':
      case 'wb_close':
        // Skip open/close from summary — they're structural, not content
        break;
    }
  }
  return parts.join(', ');
}

/**
 * Replay the whiteboard ledger to compute current element count and contributors.
 */
export function summarizeWhiteboardForDirector(ledger: WhiteboardActionRecord[]): {
  elementCount: number;
  contributors: string[];
} {
  let elementCount = 0;
  const contributorSet = new Set<string>();

  for (const record of ledger) {
    if (record.actionName === 'wb_clear') {
      elementCount = 0;
      // Don't reset contributors — they still participated
    } else if (record.actionName === 'wb_delete') {
      elementCount = Math.max(0, elementCount - 1);
    } else if (record.actionName.startsWith('wb_draw_')) {
      elementCount++;
      contributorSet.add(record.agentName);
    }
  }

  return {
    elementCount,
    contributors: Array.from(contributorSet),
  };
}

/**
 * Build the whiteboard state section for the director prompt.
 * Returns empty string if there are no whiteboard actions.
 */
function buildWhiteboardStateForDirector(ledger?: WhiteboardActionRecord[]): string {
  if (!ledger || ledger.length === 0) return '';

  const { elementCount, contributors } = summarizeWhiteboardForDirector(ledger);
  const crowdedWarning =
    elementCount > 5
      ? '\n⚠ The whiteboard is getting crowded. Consider routing to an agent that will organize or clear it rather than adding more.'
      : '';

  return `
# Whiteboard State
Elements on whiteboard: ${elementCount}
Contributors: ${contributors.length > 0 ? contributors.join(', ') : 'none'}${crowdedWarning}
`;
}

/**
 * Parse the director's decision from its response.
 *
 * Tolerates common LLM output quirks:
 *  - Markdown code fences (```json … ``` or ``` … ```)
 *  - Prose wrapped around the JSON object
 *  - Bare "END" / "USER" keywords with no JSON envelope
 *  - Empty content (e.g. reasoning model put everything in the reasoning
 *    channel)
 *
 * Returns three possible shapes:
 *   { nextAgentId, shouldEnd:false }            → dispatch that agent / USER
 *   { nextAgentId:null, shouldEnd:true, unableToDecide:false } → explicit END
 *   { nextAgentId:null, shouldEnd:true, unableToDecide:true  } → parse failed;
 *     the caller can choose to use a first-turn fallback instead of ending.
 *
 * @param content - Raw LLM response content
 * @param availableAgentIds - Optional list of valid agent ids; when provided,
 *   used as a last-resort heuristic (pick the first mentioned agent id).
 */
export function parseDirectorDecision(
  content: string,
  availableAgentIds?: string[],
): {
  nextAgentId: string | null;
  shouldEnd: boolean;
  unableToDecide?: boolean;
} {
  const raw = (content || '').trim();

  if (!raw) {
    log.warn('[Director] Empty content from LLM — falling through to caller fallback');
    return { nextAgentId: null, shouldEnd: true, unableToDecide: true };
  }

  // 1) Strip markdown code fences: ```json\n{...}\n``` or ```\n{...}\n```
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidates: string[] = [];
  if (fenced && fenced[1]) candidates.push(fenced[1].trim());
  candidates.push(raw);

  for (const candidate of candidates) {
    // 2) Try extracting a JSON object containing "next_agent"
    const jsonMatch = candidate.match(/\{[\s\S]*?"next_agent"[\s\S]*?\}/);
    const toParse = jsonMatch ? jsonMatch[0] : candidate;
    try {
      const parsed = JSON.parse(toParse);
      const nextAgent =
        typeof parsed?.next_agent === 'string' ? parsed.next_agent.trim() : undefined;
      if (nextAgent !== undefined) {
        if (!nextAgent || nextAgent.toUpperCase() === 'END') {
          return { nextAgentId: null, shouldEnd: true };
        }
        if (nextAgent.toUpperCase() === 'USER') {
          return { nextAgentId: 'USER', shouldEnd: false };
        }
        return { nextAgentId: nextAgent, shouldEnd: false };
      }
    } catch {
      // fall through to next strategy
    }
  }

  // 3) Heuristic: bare keywords
  const upper = raw.toUpperCase();
  if (/\bEND\b/.test(upper) && !/\bnext_agent\b/i.test(raw)) {
    return { nextAgentId: null, shouldEnd: true };
  }
  if (/\bUSER\b/.test(upper) && !/\bnext_agent\b/i.test(raw)) {
    return { nextAgentId: 'USER', shouldEnd: false };
  }

  // 4) Heuristic: pick the first known agent id mentioned in the text.
  if (availableAgentIds?.length) {
    // Match in order of first occurrence to respect the LLM's preference
    let bestIdx = Infinity;
    let bestId: string | null = null;
    for (const id of availableAgentIds) {
      const i = raw.indexOf(id);
      if (i !== -1 && i < bestIdx) {
        bestIdx = i;
        bestId = id;
      }
    }
    if (bestId) {
      log.warn(
        `[Director] Heuristic match: agent "${bestId}" found in unstructured response`,
      );
      return { nextAgentId: bestId, shouldEnd: false };
    }
  }

  log.warn('[Director] Failed to parse decision:', raw.slice(0, 200));
  return { nextAgentId: null, shouldEnd: true, unableToDecide: true };
}
