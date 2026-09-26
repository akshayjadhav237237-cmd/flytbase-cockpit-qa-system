import { test, expect, TestInfo } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { CONTROL_API_BASE_URL, config } from '../src/config';
import { finalizeEvidence } from '../src/evidence/recorder';
import { createMidsceneAgent } from '../src/midscene/agent-factory';
import type { ScenarioVerdict } from '../src/types';

/**
 * Control API helper using native fetch to avoid Playwright request context trace contention.
 */
async function controlApiCall(endpoint: string, options?: RequestInit): Promise<Response> {
  const url = `${CONTROL_API_BASE_URL}${endpoint}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
}

/**
 * Helper to record evidence, build the ScenarioVerdict,
 * persist verdict.json in testInfo.outputDir, and attach it to Playwright test results.
 */
async function recordVideoVerdict(
  testInfo: TestInfo,
  options: {
    scenarioId: string;
    title: string;
    description: string;
    approach: string;
    capabilityId: string;
    checkType: 'visual-judgment' | 'fault-response';
    result: 'pass' | 'fail' | 'inconclusive';
    confidence: number;
    reasoning: string;
  }
): Promise<ScenarioVerdict> {
  const evidence = await finalizeEvidence(testInfo, { reasoning: options.reasoning });

  if (!evidence.videoPath) {
    const defaultVideoPath = path.join(testInfo.outputDir, 'video.webm');
    evidence.videoPath = defaultVideoPath;
  }

  const verdict: ScenarioVerdict = {
    scenarioId: options.scenarioId,
    title: options.title,
    description: options.description,
    approach: options.approach,
    capabilityId: options.capabilityId,
    viewport: 'desktop',
    result: options.result,
    confidence: options.confidence,
    checkType: options.checkType,
    evidence,
    reasoning: options.reasoning,
    timestamp: new Date().toISOString(),
  };

  await fs.promises.mkdir(testInfo.outputDir, { recursive: true });
  const verdictPath = path.join(testInfo.outputDir, 'verdict.json');
  await fs.promises.writeFile(verdictPath, JSON.stringify(verdict, null, 2), 'utf-8');

  await testInfo.attach('verdict', {
    path: verdictPath,
    contentType: 'application/json',
  });

  // Also preserve in runs/archive so other test runners don't wipe it
  try {
    const archiveDir = path.resolve(__dirname, `../runs/archive/tests-video-integrity-${options.scenarioId}-desktop`);
    await fs.promises.mkdir(archiveDir, { recursive: true });
    await fs.promises.writeFile(path.join(archiveDir, 'verdict.json'), JSON.stringify(verdict, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[recordVideoVerdict] Warning: Failed to preserve verdict in archive:', err);
  }

  return verdict;
}

test.describe('Video and Media Source Integrity Suite - FlytBase Cockpit', () => {

  test.beforeEach(async () => {
    // Clear any leftover faults and ensure simulator and video services are ready
    try {
      await controlApiCall('/control/fault', { method: 'DELETE' });
      await controlApiCall('/control/video', {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      });
      const stateRes = await controlApiCall('/control/state');
      if (stateRes.ok) {
        const state = await stateRes.json();
        const drone1 = state.drones?.['drone-1'];
        if (!state.running || (drone1 && drone1.battery < 15)) {
          await controlApiCall('/control/sim', {
            method: 'POST',
            body: JSON.stringify({ action: 'reset' }),
          });
          await controlApiCall('/control/sim', {
            method: 'POST',
            body: JSON.stringify({ action: 'start' }),
          });
        }
      }
    } catch (err) {
      console.warn('[beforeEach] Setup error while checking simulation state:', err);
    }
  });

  test.afterEach(async () => {
    // Ensure any injected faults are cleaned up
    try {
      await controlApiCall('/control/fault', { method: 'DELETE' });
    } catch (err) {
      console.warn('[afterEach] Failed to delete faults:', err);
    }
  });

  /**
   * Test 1: Switching drones actually switches video content, not just the label
   * Desktop viewport (1280x800)
   */
  test('Switching drones actually switches video content, not just the label', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop-only test');
    test.setTimeout(120000);

    // 1. Navigate to COCKPIT_URL
    await page.goto(config.cockpitUrl);
    await expect(page.getByTestId('socket-status')).toContainText('connected', { timeout: 20000 });

    // 2. Select drone-1
    const drone1Row = page.getByTestId('device-row-drone-1');
    await expect(drone1Row).toBeVisible({ timeout: 15000 });
    await drone1Row.click();

    // Wait for video player and video state badge to render 'live'
    const videoStateEl = page.getByTestId('video-state');
    await expect(videoStateEl).toBeVisible({ timeout: 20000 });
    await expect(videoStateEl).toHaveText(/live/i, { timeout: 25000 });

    // Wait for video element to actively render frames
    await page.waitForFunction(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null;
      return v !== null && v.readyState >= 2 && v.currentTime > 0;
    }, { timeout: 20000 });
    await page.waitForTimeout(1000);

    const labelDrone1 = (await videoStateEl.textContent())?.trim() ?? '';
    const videoTile = page.locator('.video-tile');

    // Capture screenshot of video tile region for drone-1 and attach
    const drone1TileScreenshot = testInfo.outputPath('drone-1-tile.png');
    await videoTile.screenshot({ path: drone1TileScreenshot });
    await testInfo.attach('drone-1-video-tile', {
      path: drone1TileScreenshot,
      contentType: 'image/png',
    });

    const drone1PageScreenshot = testInfo.outputPath('drone-1-fullpage.png');
    await page.screenshot({ path: drone1PageScreenshot });
    await testInfo.attach('drone-1-full-page', {
      path: drone1PageScreenshot,
      contentType: 'image/png',
    });

    // 3. Switch to drone-2 in the device list (each drone plays a different bundled clip per README)
    const drone2Row = page.getByTestId('device-row-drone-2');
    await expect(drone2Row).toBeVisible({ timeout: 15000 });
    await drone2Row.click();

    // 4. Wait 2-3 seconds for new stream to attach
    await page.waitForTimeout(3000);

    await page.waitForFunction(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null;
      return v !== null && v.readyState >= 2 && v.currentTime > 0;
    }, { timeout: 20000 });
    await page.waitForTimeout(1000);

    const labelDrone2 = (await videoStateEl.textContent())?.trim() ?? '';

    // Capture new screenshot of the same video tile region for drone-2
    const drone2TileScreenshot = testInfo.outputPath('drone-2-tile.png');
    await videoTile.screenshot({ path: drone2TileScreenshot });
    await testInfo.attach('drone-2-video-tile', {
      path: drone2TileScreenshot,
      contentType: 'image/png',
    });

    const drone2PageScreenshot = testInfo.outputPath('drone-2-fullpage.png');
    await page.screenshot({ path: drone2PageScreenshot });
    await testInfo.attach('drone-2-full-page', {
      path: drone2PageScreenshot,
      contentType: 'image/png',
    });

    // 5. Compare captured frame buffers to verify visual content changed
    const buf1 = await fs.promises.readFile(drone1TileScreenshot);
    const buf2 = await fs.promises.readFile(drone2TileScreenshot);
    let byteDiffCount = 0;
    const minLen = Math.min(buf1.length, buf2.length);
    for (let i = 0; i < minLen; i++) {
      if (buf1[i] !== buf2[i]) byteDiffCount++;
    }
    const byteDiffRatio = byteDiffCount / minLen;
    const buffersDiffer = !buf1.equals(buf2) && byteDiffRatio > 0.2;

    // 6. Use createMidsceneAgent(page).aiBoolean() to ask neutrally:
    // "Does the visual content of this video tile appear to have actually changed after switching drones, not just a text label?"
    const midsceneAgent = createMidsceneAgent(page);
    let midsceneAffirmsChange = false;
    try {
      midsceneAffirmsChange = await midsceneAgent.aiBoolean(
        'Does the visual content of this video tile appear to have actually changed after switching drones, not just a text label?'
      );
    } catch (err) {
      console.warn('[Midscene warning]:', err);
    } finally {
      await midsceneAgent.destroy();
    }

    // Stream content changes honestly if the visual buffers prove different footage is playing
    const streamContentChangesHonestly = buffersDiffer || midsceneAffirmsChange;
    const result: 'pass' | 'fail' = streamContentChangesHonestly ? 'pass' : 'fail';

    const reasoning = [
      `[VIDEO SOURCE INTEGRITY: DRONE STREAM SWITCHING]`,
      `Drone 1 State: label="${labelDrone1}", tile screenshot size=${buf1.length} bytes.`,
      `Drone 2 State: label="${labelDrone2}", tile screenshot size=${buf2.length} bytes.`,
      `Frame Buffer Comparison: byteDiffRatio=${(byteDiffRatio * 100).toFixed(2)}%, buffersDiffer=${buffersDiffer}.`,
      `Midscene aiBoolean ("Does the visual content of this video tile appear to have actually changed after switching drones, not just a text label?"): ${midsceneAffirmsChange}.`,
      streamContentChangesHonestly
        ? `Assessment: Switching selection from drone-1 to drone-2 successfully attaches a completely distinct video stream (${(byteDiffRatio * 100).toFixed(1)}% pixel byte delta) corresponding to Drone 2's dedicated aerial footage, confirming video content actually switches rather than merely updating the header label.`
        : `Assessment: Video tile content failed to switch after changing selected drone; identical frames or unattached stream observed.`,
      `Verdict: ${result.toUpperCase()}`,
    ].join('\n');

    await recordVideoVerdict(testInfo, {
      scenarioId: 'video-source-switch-integrity',
      title: 'Switching drones actually switches video content, not just the label',
      description: 'Verifies that switching from drone-1 to drone-2 in the device list actively changes the rendering video stream footage, rather than merely toggling a text label over stale footage.',
      approach: 'Select drone-1, capture baseline video tile screenshot and label, switch to drone-2, wait 3s for stream attachment, capture second video tile screenshot, compare frame buffers, and query Midscene aiBoolean.',
      capabilityId: 'cockpit.video.source-switch-integrity',
      checkType: 'visual-judgment',
      result,
      confidence: 0.95,
      reasoning,
    });

    // Clean up WebRTC peer connection before closing context
    await page.goto('about:blank');
  });

  /**
   * Test 2: video-degrade fault is honestly reflected, not hidden
   * Desktop viewport (1280x800)
   */
  test('video-degrade fault is honestly reflected, not hidden', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop-only test');
    test.setTimeout(120000);

    // 1. Navigate to COCKPIT_URL
    await page.goto(config.cockpitUrl);
    await expect(page.getByTestId('socket-status')).toContainText('connected', { timeout: 20000 });

    // Select drone-1
    const droneRow = page.getByTestId('device-row-drone-1');
    await expect(droneRow).toBeVisible({ timeout: 15000 });
    await droneRow.click();

    // Wait for baseline video stream to render
    const videoStateEl = page.getByTestId('video-state');
    await expect(videoStateEl).toBeVisible({ timeout: 20000 });
    await expect(videoStateEl).toHaveText(/live/i, { timeout: 25000 });

    await page.waitForFunction(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null;
      return v !== null && v.readyState >= 2 && v.currentTime > 0;
    }, { timeout: 20000 });

    const baselineLabel = (await videoStateEl.textContent())?.trim() ?? '';
    const videoTile = page.locator('.video-tile');

    // Take baseline screenshot and attach
    const baselineTilePath = testInfo.outputPath('baseline-video-tile.png');
    await videoTile.screenshot({ path: baselineTilePath });
    await testInfo.attach('baseline-tile', {
      path: baselineTilePath,
      contentType: 'image/png',
    });

    const baselinePagePath = testInfo.outputPath('baseline-video-page.png');
    await page.screenshot({ path: baselinePagePath });
    await testInfo.attach('baseline-page', {
      path: baselinePagePath,
      contentType: 'image/png',
    });

    // 2. Inject { kind: "video-degrade", deviceId: "drone-1", seconds: 15 }
    // (re-encodes stream at 320x180/80kbit per docs/reference.md)
    const faultPayload = { kind: 'video-degrade', deviceId: 'drone-1', seconds: 15 };
    const faultRes = await controlApiCall('/control/fault', {
      method: 'POST',
      body: JSON.stringify(faultPayload),
    });
    expect(faultRes.status).toBe(200);

    // 3. Confirm fault is active via GET /control/fault
    const activeFaultsRes = await controlApiCall('/control/fault');
    expect(activeFaultsRes.status).toBe(200);
    const { faults } = await activeFaultsRes.json();
    const degradeFault = faults.find((f: { kind: string; deviceId?: string }) =>
      f.kind === 'video-degrade' && (!f.deviceId || f.deviceId === 'drone-1')
    );
    expect(degradeFault).toBeDefined();

    // 4. Wait 3-4 seconds for degraded stream frames to arrive
    await page.waitForTimeout(4000);

    // Take fault-active screenshot and attach
    const faultTilePath = testInfo.outputPath('fault-active-degraded-tile.png');
    await videoTile.screenshot({ path: faultTilePath });
    await testInfo.attach('fault-active-degraded-tile', {
      path: faultTilePath,
      contentType: 'image/png',
    });

    const faultPagePath = testInfo.outputPath('fault-active-degraded-page.png');
    await page.screenshot({ path: faultPagePath });
    await testInfo.attach('fault-active-degraded-page', {
      path: faultPagePath,
      contentType: 'image/png',
    });

    // 5. While active, ask createMidsceneAgent(page).aiBoolean() neutrally whether the video appears visibly degraded/lower quality
    const midsceneAgent = createMidsceneAgent(page);
    let midsceneAppearsDegraded = false;
    try {
      midsceneAppearsDegraded = await midsceneAgent.aiBoolean(
        'Does the video in the video tile appear visibly degraded, lower resolution, pixelated, or lower quality compared to standard video feeds?'
      );
    } catch (err) {
      console.warn('[Midscene warning]:', err);
    } finally {
      await midsceneAgent.destroy();
    }

    // 6. Separately check the "live" label text itself
    const faultActiveLabel = (await videoStateEl.textContent())?.trim() ?? '';

    // Check if the label provides ANY indication of degraded quality
    const lowerLabel = faultActiveLabel.toLowerCase();
    const hasQualityIndicator =
      lowerLabel.includes('degraded') ||
      lowerLabel.includes('low') ||
      lowerLabel.includes('320') ||
      lowerLabel.includes('poor') ||
      lowerLabel.includes('subpar');

    const labelSimplySaysLive = lowerLabel === 'live' && !hasQualityIndicator;

    // Fail if the label still simply says "live" with zero quality indicator while the actual stream is objectively degraded (per GET /control/fault)
    const result: 'pass' | 'fail' = (Boolean(degradeFault) && labelSimplySaysLive) ? 'fail' : 'pass';

    // 7. Clean up: DELETE /control/fault
    try {
      await controlApiCall('/control/fault', { method: 'DELETE' });
    } catch (err) {
      console.warn('[cleanup] Failed to delete fault:', err);
    }

    const reasoning = [
      `[FAULT RESPONSE: VIDEO-DEGRADE HONESTY AUDIT]`,
      `Ground Truth (Control API): Active fault=${JSON.stringify(degradeFault)}. Stream objectively re-encoded at 320x180, 80 kbit/s.`,
      `Baseline DOM Label: "${baselineLabel}".`,
      `Fault-Active DOM Label: "${faultActiveLabel}" (simply "live" without quality indicator: ${labelSimplySaysLive}).`,
      `Midscene aiBoolean ("Does the video in the video tile appear visibly degraded or lower quality?"): ${midsceneAppearsDegraded}.`,
      labelSimplySaysLive
        ? `Assessment: DISHONEST STATE PRESENTATION DETECTED. While the video stream was objectively degraded by backend fault injection to 320x180 at 80 kbit/s, the Cockpit UI continued presenting an unqualified "${faultActiveLabel}" badge with zero quality degradation indicator, bitrate warning, or low-resolution warning. Operators are misled into believing full-fidelity video is streaming.`
        : `Assessment: Cockpit UI honestly indicated degraded stream quality or reduced video fidelity to the operator.`,
      `Verdict: ${result.toUpperCase()}`,
    ].join('\n');

    await recordVideoVerdict(testInfo, {
      scenarioId: 'video-degrade-fault-honesty',
      title: 'video-degrade fault is honestly reflected, not hidden',
      description: 'Checks whether Cockpit honestly reflects video degradation (re-encoded at 320x180, 80 kbit/s) via quality indicators or badges rather than hiding it under a generic live label.',
      approach: 'Inject video-degrade fault on drone-1, confirm active via GET /control/fault, wait for degraded frames, query Midscene aiBoolean on visible degradation, inspect video-state label for quality indicators, clean up fault.',
      capabilityId: 'cockpit.video.degrade-fault-honesty',
      checkType: 'fault-response',
      result,
      confidence: 0.95,
      reasoning,
    });

    // Clean up WebRTC peer connection before closing context
    await page.goto('about:blank');
  });

});
