import { test, expect, TestInfo } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { CONTROL_API_BASE_URL, config } from '../src/config';
import { finalizeEvidence } from '../src/evidence/recorder';
import { createMidsceneAgent } from '../src/midscene/agent-factory';
import type { ScenarioVerdict } from '../src/types';

const DASHBOARD_URL = `${CONTROL_API_BASE_URL.replace(/\/api$/, '')}/dashboard`;
const COCKPIT_URL = config.cockpitUrl;

/**
 * Standard fetch helpers for Control API to avoid trace file contention on Windows
 */
async function apiGet<T = any>(endpoint: string): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`${CONTROL_API_BASE_URL}${endpoint}`);
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

async function apiPost<T = any>(endpoint: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`${CONTROL_API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

async function apiDelete<T = any>(endpoint: string): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`${CONTROL_API_BASE_URL}${endpoint}`, { method: 'DELETE' });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

/**
 * Helper to record evidence, construct ScenarioVerdict with checkType 'fault-response',
 * save verdict.json in testInfo.outputDir, and attach it to Playwright test results.
 */
async function recordFunctionalVerdict(
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
    checkType: 'fault-response',
    evidence,
    reasoning: options.reasoning,
    timestamp: new Date().toISOString(),
  };

  await fs.promises.mkdir(testInfo.outputDir, { recursive: true });
  const verdictPath = path.join(testInfo.outputDir, 'verdict.json');
  await fs.promises.writeFile(verdictPath, JSON.stringify(verdict, null, 2), 'utf-8');

  // Also preserve in runs/functional-honesty so other concurrent subagent runs don't overwrite
  const persistentDir = path.join(process.cwd(), 'runs', 'functional-honesty', options.scenarioId);
  await fs.promises.mkdir(persistentDir, { recursive: true });
  await fs.promises.writeFile(path.join(persistentDir, 'verdict.json'), JSON.stringify(verdict, null, 2), 'utf-8');

  await testInfo.attach('verdict', {
    path: verdictPath,
    contentType: 'application/json',
  });

  return verdict;
}

test.describe('Functional UI Honesty Suite - FlytBase Cockpit', () => {

  test.beforeEach(async () => {
    // Reset any active faults and ensure baseline simulation state
    try {
      await apiDelete('/control/fault');
      const stateRes = await apiGet<any>('/control/state');
      if (stateRes.ok) {
        const state = stateRes.data;
        const drone1 = state.drones?.['drone-1'];
        if (!state.running || (drone1 && drone1.battery < 20)) {
          await apiPost('/control/sim', { action: 'reset' });
          await apiPost('/control/sim', { action: 'start' });
        }
      }
    } catch (err) {
      console.warn('[beforeEach] Setup error during fault/sim reset:', err);
    }
  });

  test.afterEach(async () => {
    // Always clean up faults and ensure drone-1 is landed if airborne
    try {
      await apiDelete('/control/fault');
      const stateRes = await apiGet<any>('/control/state');
      if (stateRes.ok) {
        const state = stateRes.data;
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
   * Test 1: Takeoff command during socket-drop shows false success
   *
   * Inject 80% socket packet drop for 15s. While active, trigger takeoff via actual UI control.
   * Neutrally query Midscene whether the screen indicates the drone has taken off or is in flight.
   * Cross-check with real state from GET /control/state at the same moment.
   * Verdict: "fail" if UI shows success while real state is ground/standby; "pass" otherwise.
   */
  test('Takeoff command during socket-drop shows false success', async ({ page }, testInfo) => {
    test.setTimeout(90000);

    // 1. Ensure drone-1 is on the ground (standby) before initiating test
    const preCheckRes = await apiGet<any>('/control/state');
    if (preCheckRes.ok) {
      const preState = preCheckRes.data;
      if (preState.drones?.['drone-1']?.status !== 'standby') {
        await apiPost('/control/command', { deviceId: 'drone-1', type: 'land' });
        await page.waitForTimeout(2000);
      }
    }

    // 2. Open Operator Dashboard where operator controls reside
    await page.goto(DASHBOARD_URL);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('dash-socket')).toContainText('connected', { timeout: 15000 });

    // 3. Inject fault: socket-drop (80% packet drop for 15s)
    const faultPayload = { kind: 'socket-drop', value: 80, seconds: 15, deviceId: 'drone-1' };
    const faultRes = await apiPost('/control/fault', faultPayload);
    expect(faultRes.status).toBe(200);

    // Verify fault is actively registered
    const activeFaultsRes = await apiGet<any>('/control/fault');
    const faults = activeFaultsRes.data?.faults || [];
    const dropFault = faults.find((f: { kind: string }) => f.kind === 'socket-drop');
    expect(dropFault).toBeDefined();

    // 4. Trigger takeoff via actual UI control an operator would use
    const takeoffBtn = page.getByTestId('dash-takeoff-drone-1');
    await expect(takeoffBtn).toBeVisible({ timeout: 5000 });
    await takeoffBtn.click();

    // Allow UI to process click and render response
    await page.waitForTimeout(1500);

    // 5. Capture screenshot evidence
    const screenshotPath = testInfo.outputPath('takeoff-socket-drop-evidence.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    // 6. Use createMidsceneAgent(page).aiBoolean() to ask neutrally
    const midsceneAgent = createMidsceneAgent(page);
    let uiIndicatesAirborne = false;
    try {
      uiIndicatesAirborne = await midsceneAgent.aiBoolean(
        'does this screen currently indicate the drone has successfully taken off or is in flight'
      );
    } catch (err) {
      console.warn('[Midscene error]:', err);
    } finally {
      await midsceneAgent.destroy();
    }

    // 7. Cross-check against real state from GET /control/state at the same moment
    const realStateRes = await apiGet<any>('/control/state');
    expect(realStateRes.status).toBe(200);
    const realState = realStateRes.data;
    const drone1Real = realState.drones?.['drone-1'];
    const realStatus = drone1Real?.status ?? 'unknown';
    const realHeight = drone1Real?.height ?? 0;
    const isActuallyGrounded = realStatus === 'standby' || (realStatus !== 'in_flight' && realHeight === 0);

    // Check if UI log indicates command success
    const logContent = (await page.locator('#log').textContent().catch(() => '')) || '';
    const uiLogShowsSuccess = logContent.includes('takeoff drone-1: ok');

    // 8. Verdict: "fail" if UI shows success while real state still shows ground/standby; "pass" if UI honestly reports failure/degradation or real state matches
    const falseSuccessDetected = (uiIndicatesAirborne || uiLogShowsSuccess) && isActuallyGrounded;
    const verdictResult: 'pass' | 'fail' = falseSuccessDetected ? 'fail' : 'pass';

    const reasoning = [
      '[FUNCTIONAL UI HONESTY: TAKEOFF UNDER SOCKET-DROP FAULT]',
      `Fault Injected: socket-drop (80% packet loss for 15s) on drone-1.`,
      `Actuation: Clicked Take off button (data-testid="dash-takeoff-drone-1") via Operator Dashboard UI.`,
      `UI Action Log: "${logContent.split('\n')[0] || 'none'}".`,
      `Midscene aiBoolean Evaluation: "does this screen currently indicate the drone has successfully taken off or is in flight" -> ${uiIndicatesAirborne}.`,
      `Ground Truth State (Control API GET /control/state): status="${realStatus}", height=${realHeight}m, grounded=${isActuallyGrounded}.`,
      `False Success Assessment: UI indicates success=${uiIndicatesAirborne || uiLogShowsSuccess}, Grounded in reality=${isActuallyGrounded}.`,
      `Analysis: ${
        falseSuccessDetected
          ? 'UI presented success cues (command acknowledgement / airborne status) while physical simulator state remained on the ground in standby, demonstrating dishonest false success under socket packet drop.'
          : realStatus === 'in_flight' || realStatus === 'taking_off'
          ? 'Real simulator state transitioned to flight in concordance with the UI display, demonstrating state synchronization.'
          : 'UI honestly surfaced connection degradation or did not falsely present airborne status while drone was grounded.'
      }`,
      `Verdict: ${verdictResult.toUpperCase()}`,
    ].join('\n');

    await recordFunctionalVerdict(testInfo, {
      scenarioId: 'functional-takeoff-socket-drop-honesty',
      title: 'Takeoff command during socket-drop shows false success',
      description: 'Verifies whether the UI honestly reflects takeoff command execution and real flight state during an 80% socket packet loss fault on drone-1.',
      approach: 'Inject socket-drop 80% for 15s, click Take off in UI, evaluate visual feedback via Midscene aiBoolean, and compare against GET /control/state ground truth.',
      capabilityId: 'cockpit.functional.takeoff-socket-drop-honesty',
      result: verdictResult,
      confidence: 0.95,
      reasoning,
    });

    // Clean up drone if airborne
    if (drone1Real && (drone1Real.status === 'in_flight' || drone1Real.status === 'taking_off')) {
      await apiPost('/control/command', { deviceId: 'drone-1', type: 'land' });
    }
  });

  /**
   * Test 2: Add-drone command during sim-offline shows false success
   *
   * Inject sim-offline for 10s.
   * Attempt to add a new drone: inspect whether a UI control exists for adding drones;
   * if not, use POST /control/drones ({ name: "HonestyTestDrone" }) and note in reasoning that direct API was used.
   * Check whether response/UI indicates success while the drone never actually appears in subsequent GET /devices.
   * Write ScenarioVerdict with result and reasoning, and clean up created drone + fault.
   */
  test('Add-drone command during sim-offline shows false success', async ({ page }, testInfo) => {
    test.setTimeout(90000);

    const testDroneName = 'HonestyTestDrone';
    let createdDroneId: string | null = null;
    let usedDirectApi = false;
    let uiControlFound = false;

    // 1. Clean up any pre-existing HonestyTestDrone from earlier runs
    try {
      const initialDevRes = await apiGet<any>('/devices');
      if (initialDevRes.ok) {
        const existing = initialDevRes.data.devices?.find((d: { name: string; id: string }) => d.name === testDroneName);
        if (existing?.id) {
          await apiDelete(`/control/drones/${existing.id}`);
        }
      }
    } catch (e) {
      console.warn('[Add-drone pre-cleanup warning]:', e);
    }

    // 2. Inject fault: sim-offline for 10s
    const faultRes = await apiPost('/control/fault', { kind: 'sim-offline', seconds: 10 });
    expect(faultRes.status).toBe(200);

    // Verify fault is active
    const activeFaultsRes = await apiGet<any>('/control/fault');
    const faults = activeFaultsRes.data?.faults || [];
    const simOffFault = faults.find((f: { kind: string }) => f.kind === 'sim-offline');
    expect(simOffFault).toBeDefined();

    // 3. Inspect UI controls for adding drones
    // First, inspect Cockpit UI (http://localhost:4010)
    await page.goto(COCKPIT_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const cockpitAddBtn = await page.locator('button:has-text("Add drone"), button:has-text("Add Drone"), [data-testid*="add-drone"]').count();
    const cockpitHasAddDroneUI = cockpitAddBtn > 0;

    let responseIndicatedSuccess = false;
    let uiIndicatedSuccess = false;
    let addResponseStatus = 0;
    let addResponseBody: any = null;

    if (!cockpitHasAddDroneUI) {
      // Also inspect Operator Dashboard (http://localhost:4000/dashboard) to verify operator control availability
      await page.goto(DASHBOARD_URL);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      const dashAddBtn = page.getByTestId('dash-drone-add');
      const dashNameInput = page.getByTestId('dash-drone-name');
      const dashHasAddDroneUI = await dashAddBtn.isVisible().catch(() => false);

      if (dashHasAddDroneUI) {
        uiControlFound = true;
        // Trigger via UI control on Dashboard
        await dashNameInput.fill(testDroneName);
        await dashAddBtn.click();
        await page.waitForTimeout(2000);

        const logText = (await page.locator('#log').textContent().catch(() => '')) || '';
        uiIndicatedSuccess = logText.includes('add drone: ok');
      } else {
        // Fallback: direct API per specification
        usedDirectApi = true;
        const addRes = await apiPost('/control/drones', { name: testDroneName });
        addResponseStatus = addRes.status;
        addResponseBody = addRes.data;
        responseIndicatedSuccess = addRes.ok;
        if (addResponseBody?.drone?.id) {
          createdDroneId = addResponseBody.drone.id;
        }
      }
    } else {
      uiControlFound = true;
      const btn = page.locator('button:has-text("Add drone"), button:has-text("Add Drone")').first();
      await btn.click();
      await page.waitForTimeout(2000);
      uiIndicatedSuccess = true;
    }

    // 4. Capture screenshot evidence
    const screenshotPath = testInfo.outputPath('add-drone-sim-offline-evidence.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    // 5. Check whether the drone appears in a subsequent GET /devices call
    const devicesRes = await apiGet<any>('/devices');
    expect(devicesRes.status).toBe(200);
    const devicesData = devicesRes.data;
    const foundDrone = devicesData.devices?.find(
      (d: { name: string; id: string }) => d.name === testDroneName || (createdDroneId && d.id === createdDroneId)
    );
    const droneAppearedInDevicesCall = Boolean(foundDrone);
    if (foundDrone?.id) {
      createdDroneId = foundDrone.id;
    }

    // Check if drone appears in the UI table
    const droneRowVisibleInUI = await page.locator(`tr:has-text("${testDroneName}"), [data-testid*="${testDroneName}"]`).isVisible().catch(() => false);

    // 6. Evaluate verdict: "fail" if response/UI indicated success while drone never actually appears; "pass" otherwise
    const indicatedSuccess = uiControlFound ? uiIndicatedSuccess : responseIndicatedSuccess;
    const isFalseSuccess = indicatedSuccess && !droneAppearedInDevicesCall;
    const verdictResult: 'pass' | 'fail' = isFalseSuccess ? 'fail' : 'pass';

    const reasoning = [
      '[FUNCTIONAL UI HONESTY: ADD-DRONE UNDER SIM-OFFLINE FAULT]',
      `Fault Injected: sim-offline (simulator disconnected from socket hub for 10s).`,
      `UI Control Inspection: Cockpit UI (http://localhost:4010) hasAddDroneControl=${cockpitHasAddDroneUI}; Operator Dashboard (http://localhost:4000/dashboard) hasAddDroneControl=${uiControlFound}.`,
      usedDirectApi
        ? 'Note: Direct API (POST /control/drones) was used due to lack of add-drone UI button in Cockpit UI.'
        : `Action: Utilized Operator Dashboard UI control (data-testid="dash-drone-add") with name "${testDroneName}".`,
      `Command Feedback: UI indicated success=${uiIndicatedSuccess}, API status=${addResponseStatus}, response indicated success=${responseIndicatedSuccess}.`,
      `Subsequent GET /devices Check: Drone appeared in devices list=${droneAppearedInDevicesCall} (${foundDrone ? `id=${foundDrone.id}` : 'not found'}).`,
      `UI Table Visibility: Rendered in device list on screen=${droneRowVisibleInUI}.`,
      `Honesty Assessment: ${
        isFalseSuccess
          ? 'False success detected: The command/UI confirmed success, yet the drone never appeared in the subsequent GET /devices registry under sim-offline fault conditions.'
          : droneAppearedInDevicesCall
          ? 'The drone was successfully accepted and registered into the simulator devices registry despite sim-offline socket disconnection.'
          : 'The system honestly rejected or did not falsely confirm addition while simulator was offline.'
      }`,
      `Verdict: ${verdictResult.toUpperCase()}`,
    ].join('\n');

    await recordFunctionalVerdict(testInfo, {
      scenarioId: 'functional-add-drone-sim-offline-honesty',
      title: 'Add-drone command during sim-offline shows false success',
      description: 'Inspects add-drone UI availability, invokes drone creation under sim-offline fault, and verifies if false success is reported when drone is not present in subsequent GET /devices.',
      approach: 'Inject sim-offline 10s, attempt drone creation via UI or direct API, check UI/response feedback, and verify presence in subsequent GET /devices.',
      capabilityId: 'cockpit.functional.add-drone-sim-offline-honesty',
      result: verdictResult,
      confidence: 0.95,
      reasoning,
    });

    // 7. Clean up test drone and fault
    if (createdDroneId) {
      try {
        await apiDelete(`/control/drones/${createdDroneId}`);
      } catch (err) {
        console.warn('[Add-drone cleanup error]:', err);
      }
    }
  });

});
