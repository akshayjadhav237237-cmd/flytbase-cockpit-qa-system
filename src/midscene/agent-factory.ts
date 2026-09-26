import { PlaywrightAgent } from '@midscene/web/playwright';

/**
 * Creates and returns a Midscene PlaywrightAgent instance for a given Playwright page.
 *
 * Model configuration (such as MIDSCENE_MODEL_API_KEY, MIDSCENE_MODEL_BASE_URL,
 * MIDSCENE_MODEL_NAME, and MIDSCENE_MODEL_FAMILY)
 * is read automatically from environment variables by Midscene itself at runtime
 * (not passed as constructor arguments), per Midscene's official documentation.
 *
 * @param page - Playwright Page instance
 * @returns Initialized PlaywrightAgent attached to the page
 */
export function createMidsceneAgent(page: import('playwright').Page): PlaywrightAgent {
  return new PlaywrightAgent(page);
}
