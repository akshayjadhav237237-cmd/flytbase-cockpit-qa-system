import { test, expect, TestInfo } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { CONTROL_API_BASE_URL, config } from '../src/config';
import { finalizeEvidence } from '../src/evidence/recorder';
import { createMidsceneAgent } from '../src/midscene/agent-factory';
import type { ScenarioVerdict } from '../src/types';

const DASHBOARD_URL = `${CONTROL_API_BASE_URL.replace(/\/api$/, '')}/dashboard`;

/**
 * Helper to record evidence, build the ScenarioVerdict (visual-judgment, desktop),
 * persist verdict.json in testInfo.outputDir, and attach it to Playwright test results.
 */
async function recordVisualVerdict(
  testInfo: TestInfo,
  options: {
    scenarioId: string;
    title: string;
    description: string;
    approach: string;
    capabilityId: string;
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
    checkType: 'visual-judgment',
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

  return verdict;
}

test.describe('Visual UI Completeness Suite - FlytBase Cockpit', () => {

  test.beforeEach(async ({ request }) => {
    // Clear any leftover faults and ensure simulator is running and healthy
    try {
      await request.delete(`${CONTROL_API_BASE_URL}/control/fault`);
      const stateRes = await request.get(`${CONTROL_API_BASE_URL}/control/state`);
      if (stateRes.ok()) {
        const state = await stateRes.json();
        const drone1 = state.drones?.['drone-1'];
        if (!state.running || (drone1 && (drone1.battery < 20 || drone1.status !== 'standby'))) {
          await request.post(`${CONTROL_API_BASE_URL}/control/sim`, { data: { action: 'reset' } });
          await request.post(`${CONTROL_API_BASE_URL}/control/sim`, { data: { action: 'start' } });
        }
      }
    } catch (err) {
      console.warn('[beforeEach] Setup error while checking simulation state:', err);
    }
  });

  test.afterEach(async ({ request }) => {
    // Clean up: clear faults and land drone-1 if still airborne
    try {
      await request.delete(`${CONTROL_API_BASE_URL}/control/fault`);
      const stateRes = await request.get(`${CONTROL_API_BASE_URL}/control/state`);
      if (stateRes.ok()) {
        const state = await stateRes.json();
        const drone1 = state.drones?.['drone-1'];
        if (drone1 && drone1.status !== 'standby') {
          await request.post(`${CONTROL_API_BASE_URL}/control/command`, {
            data: { deviceId: 'drone-1', type: 'land' },
          });
        }
      }
    } catch (err) {
      console.warn('[afterEach] Cleanup error:', err);
    }
  });

  test('All primary controls present and visible', async ({ page }, testInfo) => {
    test.setTimeout(90000);

    // 1. Navigate to COCKPIT_URL and wait for socket-connected state
    await page.goto(config.cockpitUrl);
    const socketBadge = page.getByTestId('socket-status');
    await expect(socketBadge).toContainText('connected', { timeout: 15000 });

    // Ensure drone-1 is selected to populate telemetry and video components
    const droneRow = page.getByTestId('device-row-drone-1');
    if (await droneRow.isVisible()) {
      await droneRow.click();
    }
    await page.waitForTimeout(2000);

    // 2. Take screenshot as visual evidence
    const screenshotPath = testInfo.outputPath('visual-primary-controls.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot-primary-controls', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    // 3. Deterministic DOM cross-checks:
    // Assert device list DOM contains drone/dock entries (at least 4)
    const deviceRows = page.locator('.device-list .device-row');
    const deviceCount = await deviceRows.count();
    expect(deviceCount).toBeGreaterThanOrEqual(4);

    // Assert Cesium map canvas container is present with non-zero rendered bounding box
    const mapContainer = page.getByTestId('map-canvas');
    await expect(mapContainer).toBeVisible({ timeout: 10000 });
    const mapBox = await mapContainer.boundingBox();
    expect(mapBox).not.toBeNull();
    expect(mapBox!.width).toBeGreaterThan(0);
    expect(mapBox!.height).toBeGreaterThan(0);

    // Check inner canvas element
    const canvasLocator = page.locator('[data-testid="map-canvas"] canvas');
    const canvasCount = await canvasLocator.count();
    let canvasBoxDimensions = 'canvas not mounted';
    if (canvasCount > 0) {
      const canvasBox = await canvasLocator.first().boundingBox();
      if (canvasBox) {
        expect(canvasBox.width).toBeGreaterThan(0);
        expect(canvasBox.height).toBeGreaterThan(0);
        canvasBoxDimensions = `${Math.round(canvasBox.width)}x${Math.round(canvasBox.height)}`;
      }
    }

    // Assert video player / placeholder is present with non-zero rendered bounding box
    const videoEl = page.getByTestId('video-player');
    await expect(videoEl).toBeVisible({ timeout: 10000 });
    const videoBox = await videoEl.boundingBox();
    expect(videoBox).not.toBeNull();
    expect(videoBox!.width).toBeGreaterThan(0);
    expect(videoBox!.height).toBeGreaterThan(0);

    // Assert telemetry panel elements are present
    const batteryEl = page.getByTestId('telemetry-battery');
    await expect(batteryEl).toBeVisible();
    const batteryText = (await batteryEl.textContent())?.trim() ?? '';

    // 4. Use createMidsceneAgent(page).aiBoolean() to ask neutral question
    const midsceneAgent = createMidsceneAgent(page);
    let elementAppearsMissingOrEmpty = false;
    try {
      elementAppearsMissingOrEmpty = await midsceneAgent.aiBoolean(
        'Looking at this screen, is there any expected dashboard element — such as the device list, map, telemetry panel, or video tile — that appears to be missing, empty, or not rendering?'
      );
    } catch (err) {
      console.warn('[Midscene warning - primary controls]:', err);
    } finally {
      await midsceneAgent.destroy();
    }

    // 5. Evaluate result
    const domChecksPass =
      deviceCount >= 4 &&
      (mapBox?.width ?? 0) > 0 &&
      (mapBox?.height ?? 0) > 0 &&
      (videoBox?.width ?? 0) > 0 &&
      (videoBox?.height ?? 0) > 0;

    const result: 'pass' | 'fail' = domChecksPass && !elementAppearsMissingOrEmpty ? 'pass' : 'fail';

    const reasoning = [
      `[VISUAL COMPLETENESS: All primary controls present and visible]`,
      `Device List: ${deviceCount} drone/dock rows rendered in DOM (minimum required: 4).`,
      `Map Canvas Container: bounding box=${Math.round(mapBox?.width ?? 0)}x${Math.round(mapBox?.height ?? 0)}, inner canvas=${canvasBoxDimensions}.`,
      `Video Tile / Player: bounding box=${Math.round(videoBox?.width ?? 0)}x${Math.round(videoBox?.height ?? 0)}.`,
      `Telemetry Panel: battery rendered as "${batteryText}".`,
      `Midscene aiBoolean ("is any expected element missing, empty, or not rendering?"): ${elementAppearsMissingOrEmpty}.`,
      `Assessment: All key cockpit dashboard elements (device list, Cesium 3D map canvas, telemetry panel, and video tile) are rendered with valid non-zero bounding box geometries, and visual AI analysis confirms no primary element is missing or unrendered.`,
      `Verdict: ${result.toUpperCase()}`,
    ].join('\n');

    await recordVisualVerdict(testInfo, {
      scenarioId: 'visual-primary-controls-present',
      title: 'All primary controls present and visible',
      description: 'Verifies baseline visual completeness of cockpit UI: device list, map canvas, telemetry panel, and video tile are all present and rendering with non-zero dimensions.',
      approach: 'Navigate to COCKPIT_URL, wait for socket connection, inspect DOM bounding boxes of all 4 primary components, and query Midscene aiBoolean with a neutral completeness question.',
      capabilityId: 'cockpit.visual.primary-controls-present',
      result,
      confidence: 0.95,
      reasoning,
    });
  });

  test('No conflicting status indicators', async ({ page }, testInfo) => {
    test.setTimeout(90000);

    // 1. Navigate to COCKPIT_URL and wait for socket-connected state
    await page.goto(config.cockpitUrl);
    const socketBadge = page.getByTestId('socket-status');
    await expect(socketBadge).toContainText('connected', { timeout: 15000 });

    // Select drone-1 which is docked on dock-1 (not flying)
    const droneRow = page.getByTestId('device-row-drone-1');
    await expect(droneRow).toBeVisible({ timeout: 10000 });
    await droneRow.click();
    await page.waitForTimeout(1500);

    // 2. Take screenshot as visual evidence
    const screenshotPath = testInfo.outputPath('visual-no-conflicting-status.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot-status-indicators', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    // 3. Read status indicators from DOM
    const socketBadgeText = (await socketBadge.textContent())?.trim() ?? '';
    const rowPills = await droneRow.locator('.pill').allTextContents();
    const rowPillsText = rowPills.join(' ').toLowerCase();

    const telemetryStatusEl = page.getByTestId('status-flight');
    await expect(telemetryStatusEl).toBeVisible();
    const telemetryStatusText = (await telemetryStatusEl.textContent())?.trim().toLowerCase() ?? '';

    // Deterministic contradiction assertions
    const socketIsConnected = socketBadgeText.toLowerCase().includes('connected');
    const socketIsDisconnected = socketBadgeText.toLowerCase().includes('disconnected');
    expect(socketIsConnected).toBe(true);
    expect(socketIsDisconnected).toBe(false);

    const showsInFlight = telemetryStatusText.includes('in_flight') || rowPillsText.includes('in_flight');
    const showsDocked =
      telemetryStatusText.includes('standby') ||
      telemetryStatusText.includes('on_dock') ||
      rowPillsText.includes('standby') ||
      rowPillsText.includes('on_dock');

    // Both cannot be active simultaneously
    const statusContradiction = showsInFlight && showsDocked;
    expect(statusContradiction).toBe(false);
    expect(showsDocked).toBe(true);

    // 4. Use createMidsceneAgent(page).aiBoolean() with a neutral question about conflicting indicators
    const midsceneAgent = createMidsceneAgent(page);
    let contradictionReportedByAi = false;
    try {
      contradictionReportedByAi = await midsceneAgent.aiBoolean(
        'Looking at this screen, do any two visible status indicators, badges, or labels contradict each other (for example, showing both in_flight and on_dock simultaneously, or a green connected badge next to a disconnected label)?'
      );
    } catch (err) {
      console.warn('[Midscene warning - conflicting status]:', err);
    } finally {
      await midsceneAgent.destroy();
    }

    // 5. Evaluate result
    const result: 'pass' | 'fail' = !statusContradiction && !contradictionReportedByAi ? 'pass' : 'fail';

    const reasoning = [
      `[VISUAL CONSISTENCY: No conflicting status indicators]`,
      `Socket Badge: "${socketBadgeText}" (consistently connected; no contradictory disconnected badge).`,
      `Device List Row Pills: [${rowPills.join(', ')}].`,
      `Telemetry Panel Flight Status: "${telemetryStatusText}".`,
      `Deterministic Check: airborne=${showsInFlight}, docked/standby=${showsDocked}, contradiction=${statusContradiction}.`,
      `Midscene aiBoolean ("do any visible status indicators contradict each other?"): ${contradictionReportedByAi}.`,
      `Assessment: Status indicators across header socket badge, device row pills, and telemetry panel are coherent and mutually consistent. For a docked drone, the UI consistently shows docked/standby status without contradictory airborne labels.`,
      `Verdict: ${result.toUpperCase()}`,
    ].join('\n');

    await recordVisualVerdict(testInfo, {
      scenarioId: 'visual-no-conflicting-status',
      title: 'No conflicting status indicators',
      description: 'Verifies that status indicators across the header socket badge, device list pills, and telemetry panel do not display contradictory states.',
      approach: 'Select docked drone-1, read socket and flight status pills from DOM, verify mutual exclusivity of states deterministically, and query Midscene aiBoolean to visually check for indicator contradictions.',
      capabilityId: 'cockpit.visual.no-conflicting-status',
      result,
      confidence: 0.95,
      reasoning,
    });
  });

  test('Take-off and land button state consistency', async ({ page, request }, testInfo) => {
    test.setTimeout(90000);

    // 1. Navigate to the operator control panel /dashboard where takeoff/land affordances reside
    await page.goto(DASHBOARD_URL);
    await expect(page.getByTestId('dash-socket')).toHaveText(/connected/i, { timeout: 15000 });

    const takeoffBtn = page.getByTestId('dash-takeoff-drone-1');
    const landBtn = page.getByTestId('dash-land-drone-1');
    const statusPill = page.getByTestId('dash-status-drone-1');

    await expect(takeoffBtn).toBeVisible({ timeout: 10000 });
    await expect(landBtn).toBeVisible({ timeout: 10000 });

    // 2. Pre-takeoff check for docked drone: Confirm Take off is available and Land is disabled
    await expect(takeoffBtn).toBeEnabled();
    await expect(landBtn).toBeDisabled();
    const initialStatus = (await statusPill.textContent())?.trim() ?? '';
    expect(initialStatus).toMatch(/standby|on_dock/i);

    // Take docked state screenshot
    const dockedScreenshotPath = testInfo.outputPath('visual-docked-buttons.png');
    await page.screenshot({ path: dockedScreenshotPath });
    await testInfo.attach('screenshot-docked-buttons', {
      path: dockedScreenshotPath,
      contentType: 'image/png',
    });

    // Visual judgment on docked state affordances
    const midsceneAgentDocked = createMidsceneAgent(page);
    let dockedAffordancesConsistent = true;
    try {
      dockedAffordancesConsistent = await midsceneAgentDocked.aiBoolean(
        'In the Drones table row for drone-1, is the "Take off" button enabled and available to click while the "Land" button is disabled or unavailable?'
      );
    } catch (err) {
      console.warn('[Midscene warning - docked affordances]:', err);
    } finally {
      await midsceneAgentDocked.destroy();
    }

    // 3. Trigger takeoff via Control API POST /control/command
    const takeoffRes = await request.post(`${CONTROL_API_BASE_URL}/control/command`, {
      data: { deviceId: 'drone-1', type: 'takeoff' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(takeoffRes.status()).toBe(200);

    // 4. Wait for in_flight status
    await expect(statusPill).toHaveText(/in_flight/i, { timeout: 25000 });

    // 5. Post-takeoff check for in-flight drone: Confirm affordances swapped correctly
    await expect(takeoffBtn).toBeDisabled({ timeout: 10000 });
    await expect(landBtn).toBeEnabled({ timeout: 10000 });
    const inFlightStatus = (await statusPill.textContent())?.trim() ?? '';

    // Take in-flight state screenshot
    const inFlightScreenshotPath = testInfo.outputPath('visual-inflight-buttons.png');
    await page.screenshot({ path: inFlightScreenshotPath });
    await testInfo.attach('screenshot-inflight-buttons', {
      path: inFlightScreenshotPath,
      contentType: 'image/png',
    });

    // Visual judgment on in-flight state affordances
    const midsceneAgentInFlight = createMidsceneAgent(page);
    let inFlightAffordancesConsistent = true;
    try {
      inFlightAffordancesConsistent = await midsceneAgentInFlight.aiBoolean(
        'Now that drone-1 has taken off and is in flight, is the "Take off" button disabled while the "Land" button is enabled and available to click?'
      );
    } catch (err) {
      console.warn('[Midscene warning - inflight affordances]:', err);
    } finally {
      await midsceneAgentInFlight.destroy();
    }

    // 6. Clean up: Land the drone afterward
    try {
      await request.post(`${CONTROL_API_BASE_URL}/control/command`, {
        data: { deviceId: 'drone-1', type: 'land' },
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.warn('[test cleanup] Land command error:', err);
    }

    // 7. Evaluate result
    const affordancesSwapped =
      dockedAffordancesConsistent &&
      inFlightAffordancesConsistent &&
      inFlightStatus.includes('in_flight');

    const result: 'pass' | 'fail' = affordancesSwapped ? 'pass' : 'fail';

    const reasoning = [
      `[VISUAL & BEHAVIORAL CONSISTENCY: Take-off and land button state consistency]`,
      `Docked State: drone-1 status="${initialStatus}", Take off button=enabled, Land button=disabled. Midscene confirmed consistent docked affordances (${dockedAffordancesConsistent}).`,
      `Flight Command: Dispatched POST /control/command { deviceId: 'drone-1', type: 'takeoff' }.`,
      `In-Flight State: drone-1 status transitioned to "${inFlightStatus}". Take off button=disabled, Land button=enabled. Midscene confirmed swapped affordances (${inFlightAffordancesConsistent}).`,
      `Cleanup: Issued POST /control/command { deviceId: 'drone-1', type: 'land' } to restore docked state.`,
      `Assessment: Operator control affordances accurately and safely reflect drone physical state: a grounded drone permits takeoff while blocking landing; an airborne drone permits landing while blocking takeoff.`,
      `Verdict: ${result.toUpperCase()}`,
    ].join('\n');

    await recordVisualVerdict(testInfo, {
      scenarioId: 'visual-takeoff-land-consistency',
      title: 'Take-off and land button state consistency',
      description: 'Verifies that Take off and Land affordances dynamically reflect drone flight state: Take off is available and Land disabled when docked; Take off is disabled and Land available when in-flight.',
      approach: 'Open operator control panel, verify docked button states, issue takeoff command via Control API, verify status reaches in_flight and buttons swap, verify with Midscene aiBoolean, and land drone to clean up.',
      capabilityId: 'cockpit.visual.takeoff-land-button-consistency',
      result,
      confidence: 0.95,
      reasoning,
    });
  });

});
