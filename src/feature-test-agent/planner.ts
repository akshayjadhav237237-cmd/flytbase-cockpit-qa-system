import { midsceneEnv } from '../config';

export interface PlannedScenario {
  id: string;
  title: string;
  instruction: string;
  verification: string;
  capabilityId: string;
  viewport: 'desktop' | 'mobile';
}

export interface AppContext {
  cockpitUrl: string;
  knownScreens?: string[];
}

/**
 * Strips markdown code fences if present in raw string.
 */
function cleanJsonText(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return cleaned;
}

/**
 * Validates and normalizes scenario objects.
 */
function validateScenarios(items: any[]): PlannedScenario[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Planned scenarios output is not a non-empty array');
  }

  return items.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Scenario at index ${idx} is not an object: ${JSON.stringify(item)}`);
    }

    const id = String(item.id || `feature-agent.scenario-${idx + 1}`).trim();
    const title = String(item.title || `Scenario ${idx + 1}`).trim();
    const instruction = String(item.instruction || '').trim();
    const verification = String(item.verification || '').trim();
    let capabilityId = String(item.capabilityId || id).trim();
    const rawViewport = String(item.viewport || 'desktop').toLowerCase().trim();
    const viewport: 'desktop' | 'mobile' = rawViewport === 'mobile' ? 'mobile' : 'desktop';

    if (!instruction) {
      throw new Error(`Scenario "${title}" is missing an "instruction" field`);
    }
    if (!verification) {
      throw new Error(`Scenario "${title}" is missing a "verification" field`);
    }

    if (!capabilityId.startsWith('feature-agent.')) {
      capabilityId = `feature-agent.${capabilityId.replace(/^feature[-.]?agent[-.]?/, '')}`;
    }

    return {
      id,
      title,
      instruction,
      verification,
      capabilityId,
      viewport,
    };
  });
}

/**
 * Calls Gemini model using the OpenAI-compatible chat completions endpoint.
 */
async function callChatCompletions(
  messages: Array<{ role: string; content: string }>,
  modelName: string,
  apiKey: string,
  baseUrl: string
): Promise<string> {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const endpoint = `${normalizedBase}chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model API request failed with status ${response.status} (${response.statusText}): ${errorText}`);
  }

  const data = (await response.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`Model API returned unexpected response shape: ${JSON.stringify(data)}`);
  }

  return content;
}

/**
 * Autonomously plans 3 to 6 test scenarios from a developer's feature summary.
 * Calls Gemini model via OpenAI-compatible endpoint, parses and validates JSON,
 * retrying once with an explicit correction prompt if parsing fails.
 */
export async function planScenariosFromFeatureSummary(
  featureSummary: string,
  appContext: AppContext
): Promise<PlannedScenario[]> {
  const env = midsceneEnv();
  const apiKey = env.MIDSCENE_MODEL_API_KEY;
  if (!apiKey) {
    throw new Error('MIDSCENE_MODEL_API_KEY is not configured in environment or .env');
  }

  const systemPrompt = `You are an expert QA Test Planner for an autonomous web UI testing system.
Given a developer's feature summary for a web application reachable at ${appContext.cockpitUrl}, generate 3 to 6 concrete, independent test scenarios to verify that the feature works end-to-end from a real user's perspective.
Focus on user interactions: clicking, toggling, selecting, verifying real effects and state changes. Do not just test passive appearances.

Each scenario must follow this exact shape:
- id: short unique kebab-case ID (e.g. "feature-agent.toggle-2d-3d")
- title: human-readable scenario title
- instruction: WHAT TO DO in plain English with NO selectors, NO DOM IDs, and NO code. The autonomous agent will execute this instruction directly via AI vision and action.
- verification: WHAT OUTCOME TO CHECK FOR in plain English. The agent will evaluate this question/statement to determine pass or fail.
- capabilityId: short unique kebab-case ID prefixed with "feature-agent." (e.g. "feature-agent.toggle-2d-3d")
- viewport: either "desktop" or "mobile" based on what is most suitable to test (desktop: 1280x800, mobile: 390x844). Include both desktop and mobile if responsive behavior is relevant.

CRITICAL REQUIREMENT:
Respond ONLY with a valid JSON array of scenario objects matching the schema above.
Do NOT include any markdown code fences, backticks, commentary, or conversational prose.
Only raw JSON array: [ { ... }, { ... } ]`;

  const userPrompt = `Feature Summary:
"""
${featureSummary}
"""

App Context:
- Cockpit URL: ${appContext.cockpitUrl}
${appContext.knownScreens && appContext.knownScreens.length > 0 ? `- Known Screens: ${appContext.knownScreens.join(', ')}` : ''}

Generate 3 to 6 concrete test scenarios to thoroughly verify this feature.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let rawContent = await callChatCompletions(
    messages,
    env.MIDSCENE_MODEL_NAME,
    apiKey,
    env.MIDSCENE_MODEL_BASE_URL
  );

  try {
    const cleaned = cleanJsonText(rawContent);
    const parsed = JSON.parse(cleaned);
    return validateScenarios(parsed);
  } catch (firstErr: any) {
    console.warn(`[planner] First JSON parse attempt failed: ${firstErr.message}. Retrying with correction prompt...`);
    
    // Retry once with explicit correction message
    const retryMessages = [
      ...messages,
      { role: 'assistant', content: rawContent },
      {
        role: 'user',
        content: `Your previous response could not be parsed as JSON: ${firstErr.message}.
Please respond ONLY with a valid, clean JSON array of scenario objects.
No backticks, no markdown code block fences, no introduction, no explanation.
Schema: [ { "id": "...", "title": "...", "instruction": "...", "verification": "...", "capabilityId": "feature-agent....", "viewport": "desktop" | "mobile" } ]`,
      },
    ];

    const retryContent = await callChatCompletions(
      retryMessages,
      env.MIDSCENE_MODEL_NAME,
      apiKey,
      env.MIDSCENE_MODEL_BASE_URL
    );

    try {
      const cleanedRetry = cleanJsonText(retryContent);
      const parsedRetry = JSON.parse(cleanedRetry);
      return validateScenarios(parsedRetry);
    } catch (secondErr: any) {
      console.error('[planner] Second JSON parse attempt also failed.');
      console.error('[planner] Raw model output was:\n', retryContent);
      throw new Error(
        `Failed to parse model-generated scenario plan after retry. Raw response: ${retryContent}`
      );
    }
  }
}
