import type { TestInfo } from '@playwright/test';
import type { ScenarioVerdict } from '../types';

/**
 * Finalizes and extracts recorded evidence (video, trace, and screenshot paths)
 * attached to the Playwright TestInfo.
 *
 * @param testInfo - The Playwright TestInfo object from the active test context.
 * @param extra - Optional extra metadata such as judge reasoning.
 * @returns Structured evidence object matching ScenarioVerdict['evidence'].
 */
export async function finalizeEvidence(
  testInfo: TestInfo,
  extra?: { reasoning?: string }
): Promise<ScenarioVerdict['evidence']> {
  if (extra?.reasoning) {
    // Retained for downstream judge transparency and logging
  }
  const attachments = testInfo.attachments ?? [];

  // Locate video attachment attached by Playwright
  const videoAttachment = attachments.find(
    (att) =>
      att.name === 'video' ||
      att.contentType?.startsWith('video/') ||
      (typeof att.path === 'string' && att.path.endsWith('.webm'))
  );

  let videoPath = '';
  if (videoAttachment?.path) {
    videoPath = videoAttachment.path;
  } else {
    console.warn(
      `[qa-system/recorder] Warning: No video attachment path found for test "${testInfo.title}".`
    );
  }

  // Locate trace attachment attached by Playwright
  const traceAttachment = attachments.find(
    (att) =>
      att.name === 'trace' ||
      att.contentType === 'application/zip' ||
      (typeof att.path === 'string' && att.path.endsWith('.zip'))
  );

  let tracePath: string | undefined;
  if (traceAttachment?.path) {
    tracePath = traceAttachment.path;
  } else {
    console.warn(
      `[qa-system/recorder] Warning: No trace attachment path found for test "${testInfo.title}".`
    );
  }

  // Locate all screenshot attachments
  const screenshotPaths: string[] = attachments
    .filter(
      (att) =>
        att.name === 'screenshot' ||
        att.contentType?.startsWith('image/') ||
        (typeof att.path === 'string' && /\.(png|jpe?g|webp)$/i.test(att.path))
    )
    .map((att) => att.path)
    .filter((p): p is string => Boolean(p));

  const evidence: ScenarioVerdict['evidence'] = {
    videoPath,
    screenshotPaths,
    ...(tracePath ? { tracePath } : {}),
  };

  return evidence;
}
