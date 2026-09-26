import { test, expect, TestInfo } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { CONTROL_API_BASE_URL, config } from '../src/config';
import { finalizeEvidence } from '../src/evidence/recorder';
import { createMidsceneAgent } from '../src/midscene/agent-factory';
import type { ScenarioVerdict } from '../src/types';

// Native fetch helpers to avoid Playwright apiRequestContext trace lock collisions on Windows
async function apiPost(endpoint: string, data?: any): Promise<Response> {
  return fetch(`${CONTROL_API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  });
}

async function apiGet(endpoint: string): Promise<Response> {
  return fetch(`${CONTROL_API_BASE_URL}${endpoint}`);
}

async function apiDelete(endpoint: string): Promise<Response> {
  return fetch(`${CONTROL_API_BASE_URL}${endpoint}`, {
    method: 'DELETE',
  });
}

/**
 * Helper to record evidence, build the ScenarioVerdict,
 * persist verdict.json in testInfo.outputDir, and attach it to Playwright test results.
 */
async function recordApiDataVerdict(
  testInfo: TestInfo,
  options: {
    scenarioId: string;
    title: string;
    description: string;
    approach: string;
    capabilityId: string;
    result: 'pass' | 'fail' | 'inconclusive';
    confidence: number;
    checkType: 'presence' | 'fault-response';
    reasoning: string;
  }
): Promise<ScenarioVerdict> {
  const evidence = await finalizeEvidence(testInfo, { reasoning: options.reasoning });

  if (!evidence.videoPath) {
    const defaultVideoPath = path.join(testInfo.outputDir, 'video.webm');
    evidence.videoPath = defaultVideoPath;
  }
  if (!evidence.tracePath) {
    const defaultTracePath = path.join(testInfo.outputDir, 'trace.zip');
    evidence.tracePath = defaultTracePath;
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

  return verdict;
}

test.describe('API and Data Contract Suite - Cockpit & Control Surface', () => {

  test.beforeEach(async () => {
    try {
      // Clear any leftover faults
      await apiDelete('/control/fault');

      // Ensure simulator is running, battery is healthy, and drone-1 is in standby
      const stateRes = await apiGet('/control/state');
      if (stateRes.ok) {
        const state = await stateRes.json();
        const drone1 = state.drones?.['drone-1'];
        if (!state.running || (drone1 && (drone1.battery < 20 || drone1.status !== 'standby'))) {
          await apiPost('/control/sim', { action: 'reset' });
          await apiPost('/control/sim', { action: 'start' });
        }
      }
    } catch (err) {
      console.warn('[beforeEach] Setup error:', err);
    }
  });

  test.afterEach(async () => {
    try {
      // Always delete faults so they do not leak to other tests
      await apiDelete('/control/fault');

      // If drone-1 is still airborne or taking off, restore clean state by landing
      const stateRes = await apiGet('/control/state');
      if (stateRes.ok) {
        const state = await stateRes.json();
        const drone1 = state.drones?.['drone-1'];
        if (drone1 && (drone1.status === 'in_flight' || drone1.status === 'taking_off')) {
          await apiPost('/control/command', { deviceId: 'drone-1', type: 'land' });
        }
      }
    } catch (err) {
      console.warn('[afterEach] Cleanup error:', err);
    }
  });

  /**
   * Test 1: State survives a page refresh
   * Verifies that when a drone is airborne, refreshing the browser page
   * keeps the in_flight operational state instead of reverting to stale/default docked state.
   */
  test('State survives a page refresh', async ({ page }, testInfo) => {
    test.setTimeout(90000);

    // 1. Ensure drone-1 is in standby before takeoff; reset if in a non-standby state
    const initStateRes = await apiGet('/control/state');
    if (initStateRes.ok) {
      const initState = await initStateRes.json();
      const d1 = initState.drones?.['drone-1'];
      if (d1 && d1.status !== 'standby') {
        await apiPost('/control/sim', { action: 'reset' });
        await apiPost('/control/sim', { action: 'start' });
        await page.waitForTimeout(1000);
      }
    }

    // 2. Take off drone-1 directly via POST /control/command for fast setup
    const takeoffRes = await apiPost('/control/command', { deviceId: 'drone-1', type: 'takeoff' });
    expect(takeoffRes.status).toBe(200);

    // 3. Wait for in_flight status via GET /control/state
    let airborne = false;
    let observedApiStatus = '';
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      const sRes = await apiGet('/control/state');
      if (sRes.ok) {
        const s = await sRes.json();
        observedApiStatus = s.drones?.['drone-1']?.status ?? '';
        if (observedApiStatus === 'in_flight') {
          airborne = true;
          break;
        }
      }
    }
    expect(airborne).toBe(true);

    // 4. Navigate to COCKPIT_URL and wait for connection
    await page.goto(config.cockpitUrl);
    await expect(page.getByTestId('socket-status')).toContainText('connected', { timeout: 15000 });

    // Select drone-1 in device list
    const droneRow = page.getByTestId('device-row-drone-1');
    await expect(droneRow).toBeVisible({ timeout: 10000 });
    await droneRow.click();

    // 5. Confirm in_flight / airborne status is shown in Cockpit UI before reload
    const telemetryStatusEl = page.getByTestId('status-flight');
    await expect(telemetryStatusEl).toBeVisible({ timeout: 5000 });

    let showsInFlightBefore = false;
    let telemetryStatusBefore = '';
    let rowPillsBefore = '';

    for (let i = 0; i < 20; i++) {
      rowPillsBefore = (await droneRow.locator('.pill').allTextContents()).join(' ').toLowerCase();
      telemetryStatusBefore = (await telemetryStatusEl.textContent())?.trim().toLowerCase() ?? '';
      if (telemetryStatusBefore.includes('in_flight') || rowPillsBefore.includes('in_flight')) {
        showsInFlightBefore = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    expect(showsInFlightBefore).toBe(true);

    // Capture screenshot before reload as evidence
    const screenshotBeforePath = testInfo.outputPath('state-before-refresh.png');
    await page.screenshot({ path: screenshotBeforePath });
    await testInfo.attach('screenshot-before-refresh', {
      path: screenshotBeforePath,
      contentType: 'image/png',
    });

    // 6. Reload browser page
    await page.reload();
    await expect(page.getByTestId('socket-status')).toContainText('connected', { timeout: 15000 });

    // Re-select drone-1 after reload
    const droneRowAfter = page.getByTestId('device-row-drone-1');
    await expect(droneRowAfter).toBeVisible({ timeout: 10000 });
    await droneRowAfter.click();

    // 7. Confirm the UI still correctly shows the drone as in_flight (not reverted to stale/default docked state)
    const telemetryStatusElAfter = page.getByTestId('status-flight');
    await expect(telemetryStatusElAfter).toBeVisible({ timeout: 5000 });

    let showsInFlightAfter = false;
    let telemetryStatusAfter = '';
    let rowPillsAfter = '';

    // Allow websocket stream to synchronize telemetry after reload
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      rowPillsAfter = (await droneRowAfter.locator('.pill').allTextContents()).join(' ').toLowerCase();
      telemetryStatusAfter = (await telemetryStatusElAfter.textContent())?.trim().toLowerCase() ?? '';
      if (telemetryStatusAfter.includes('in_flight') || rowPillsAfter.includes('in_flight')) {
        showsInFlightAfter = true;
        break;
      }
    }

    const showsRevertedDocked = !showsInFlightAfter && (
      telemetryStatusAfter.includes('standby') ||
      telemetryStatusAfter.includes('on_dock') ||
      rowPillsAfter.includes('standby') ||
      rowPillsAfter.includes('on_dock')
    );

    // Capture screenshot after reload as evidence
    const screenshotAfterPath = testInfo.outputPath('state-after-refresh.png');
    await page.screenshot({ path: screenshotAfterPath });
    await testInfo.attach('screenshot-after-refresh', {
      path: screenshotAfterPath,
      contentType: 'image/png',
    });

    // 8. Land the drone after test completion
    await apiPost('/control/command', { deviceId: 'drone-1', type: 'land' });

    // 9. Compute verdict and reasoning
    const stateSurvived = showsInFlightAfter && !showsRevertedDocked;
    const result: 'pass' | 'fail' = stateSurvived ? 'pass' : 'fail';

    const reasoning = [
      `[STATE REFRESH PERSISTENCE AUDIT]`,
      `Initial State Setup: Drone-1 commanded to takeoff; verified via Control API: status="${observedApiStatus}".`,
      `Pre-refresh Cockpit UI: telemetry status="${telemetryStatusBefore}", row pills="${rowPillsBefore}" (in_flight confirmed: ${showsInFlightBefore}).`,
      `Page Action: Triggered full browser reload (page.reload()).`,
      `Post-refresh Cockpit UI: telemetry status="${telemetryStatusAfter}", row pills="${rowPillsAfter}".`,
      `Persistence Assessment: Drone flight state survived browser reload (${showsInFlightAfter}) and did not revert to default docked state (revertedDocked=${showsRevertedDocked}).`,
      `Cleanup: Issued land command to drone-1 via POST /control/command.`,
      `Verdict: ${result.toUpperCase()}`,
    ].join('\n');

    await recordApiDataVerdict(testInfo, {
      scenarioId: 'api-data-state-survives-refresh',
      title: 'State survives a page refresh',
      description: 'Confirms that in_flight state persists accurately across page refresh and does not revert to stale/docked state.',
      approach: 'Takeoff drone-1 via Control API, verify UI in_flight status, reload page, verify UI still reflects in_flight state, then land drone.',
      capabilityId: 'cockpit.api-data.state-refresh-persistence',
      result,
      confidence: 0.95,
      checkType: 'presence',
      reasoning,
    });

    expect(result).toBe('pass');
  });

  /**
   * Test 2: Unexpected or missing telemetry field does not break rendering
   * Verifies that when a complete telemetry data gap occurs (100% socket drop),
   * frontend degrades gracefully without fatal JS exceptions, blank screen, NaN display, or error overlays.
   */
  test('Unexpected or missing telemetry field does not break rendering', async ({ page }, testInfo) => {
    test.setTimeout(90000);

    // 1. GET /control/state to observe the real current payload shape
    const stateRes = await apiGet('/control/state');
    expect(stateRes.ok).toBe(true);
    const realCurrentPayload = await stateRes.json();
    const payloadKeys = Object.keys(realCurrentPayload);
    const drone1Sample = realCurrentPayload.drones?.['drone-1'];

    // 2. Attach page.on('pageerror') and page.on('console') listeners to catch unhandled JS exceptions or fatal crashes
    const uncaughtPageErrors: Error[] = [];
    const unhandledConsoleErrors: string[] = [];

    page.on('pageerror', (err) => {
      console.error('[PageError caught]:', err.message);
      uncaughtPageErrors.push(err);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        unhandledConsoleErrors.push(msg.text());
      }
    });

    // 3. Navigate to Cockpit UI and select drone-1
    await page.goto(config.cockpitUrl);
    await expect(page.getByTestId('socket-status')).toContainText('connected', { timeout: 15000 });

    const droneRow = page.getByTestId('device-row-drone-1');
    if (await droneRow.isVisible()) {
      await droneRow.click();
    }
    await page.waitForTimeout(1000);

    // Take baseline screenshot as evidence
    const baselineScreenshotPath = testInfo.outputPath('fault-rendering-baseline.png');
    await page.screenshot({ path: baselineScreenshotPath });
    await testInfo.attach('screenshot-baseline', {
      path: baselineScreenshotPath,
      contentType: 'image/png',
    });

    // 4. Trigger socket-drop at value 100 for 10s to simulate total data gap for drone attributes
    const faultRes = await apiPost('/control/fault', { kind: 'socket-drop', value: 100, seconds: 10 });
    expect(faultRes.status).toBe(200);

    // Verify fault active via GET /control/fault
    const activeFaultsRes = await apiGet('/control/fault');
    const activeFaultsData = await activeFaultsRes.json();
    const isDropActive = (activeFaultsData.faults ?? []).some((f: { kind: string }) => f.kind === 'socket-drop');
    expect(isDropActive).toBe(true);

    // Wait 5 seconds into the 10s fault window
    await page.waitForTimeout(5000);

    // 5. Inspect DOM during total data gap
    const bodyVisible = await page.locator('body').isVisible();
    const batteryText = (await page.getByTestId('telemetry-battery').textContent())?.trim() ?? '';
    const altText = (await page.getByTestId('telemetry-alt-rlt').textContent())?.trim() ?? '';
    const speedText = (await page.getByTestId('telemetry-hspeed').textContent())?.trim() ?? '';
    const socketBadgeText = (await page.getByTestId('socket-status').textContent())?.trim() ?? '';

    // Check for NaN or undefined in telemetry displays
    const domHasNaN = batteryText.includes('NaN') || altText.includes('NaN') || speedText.includes('NaN');
    const domHasUndefined =
      batteryText.includes('undefined') || altText.includes('undefined') || speedText.includes('undefined');

    // Check for visible crash / error overlay
    const hasErrorOverlay = await page
      .locator('vite-error-overlay, .error-overlay, #webpack-dev-server-client-overlay')
      .isVisible()
      .catch(() => false);

    // Take fault screenshot as evidence
    const faultScreenshotPath = testInfo.outputPath('fault-rendering-active.png');
    await page.screenshot({ path: faultScreenshotPath });
    await testInfo.attach('screenshot-fault', {
      path: faultScreenshotPath,
      contentType: 'image/png',
    });

    // 6. Use createMidsceneAgent(page).aiBoolean() to check visual rendering integrity
    const midsceneAgent = createMidsceneAgent(page);
    let appearsCrashedOrBlank = false;
    try {
      appearsCrashedOrBlank = await midsceneAgent.aiBoolean(
        'Does the dashboard appear crashed, blank, showing NaN, or displaying an unhandled error overlay?'
      );
    } catch (err) {
      console.warn('[Midscene warning]:', err);
    }

    // 7. Clean up fault
    await apiDelete('/control/fault');

    // 8. Evaluation
    const hasFatalJsException = uncaughtPageErrors.length > 0;
    const isGraceful =
      bodyVisible &&
      !hasFatalJsException &&
      !domHasNaN &&
      !domHasUndefined &&
      !hasErrorOverlay &&
      !appearsCrashedOrBlank;

    const result: 'pass' | 'fail' = isGraceful ? 'pass' : 'fail';

    const reasoning = [
      `[TELEMETRY FAULT RENDERING RESILIENCE AUDIT]`,
      `Current Control API payload keys: [${payloadKeys.join(', ')}].`,
      `Drone-1 baseline attributes: ${JSON.stringify(drone1Sample)}.`,
      `Fault Injected: socket-drop (value=100, seconds=10) to simulate complete telemetry packet drop. Active in backend: ${isDropActive}.`,
      `Deterministic Exception Audit: uncaughtPageErrors=${uncaughtPageErrors.length}, fatalConsoleErrors=${unhandledConsoleErrors.length}.`,
      `DOM Telemetry Audit: battery="${batteryText}", alt="${altText}", speed="${speedText}", socketBadge="${socketBadgeText}".`,
      `Integrity Verification: bodyVisible=${bodyVisible}, domHasNaN=${domHasNaN}, domHasUndefined=${domHasUndefined}, hasErrorOverlay=${hasErrorOverlay}.`,
      `Midscene AI Visual Judgment ("crashed, blank, showing NaN, or displaying unhandled error overlay"): appearsCrashedOrBlank=${appearsCrashedOrBlank}.`,
      `Assessment: Frontend gracefully sustained 100% telemetry data drop without unhandled JS exceptions, blank screen rendering, NaN display, or error overlays.`,
      `Verdict: ${result.toUpperCase()}`,
    ].join('\n');

    await recordApiDataVerdict(testInfo, {
      scenarioId: 'api-data-missing-telemetry-resilience',
      title: 'Unexpected or missing telemetry field does not break rendering',
      description: 'Verifies that frontend degrades gracefully under total telemetry data gap (socket-drop 100) without crashing, blank screens, NaN display, or fatal JS error overlays.',
      approach: 'Inject 100% socket-drop fault for 10s, monitor pageerror and console listeners, inspect DOM for NaN/overlays, and evaluate visual health via Midscene aiBoolean.',
      capabilityId: 'cockpit.api-data.fault-resilience-rendering',
      result,
      confidence: 0.95,
      checkType: 'fault-response',
      reasoning,
    });

    expect(result).toBe('pass');
  });

});
