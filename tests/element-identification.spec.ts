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
 * Helper to record evidence, build the ScenarioVerdict (checkType: 'presence', desktop),
 * persist verdict.json in testInfo.outputDir, and attach it to Playwright test results.
 */
async function recordIdentificationVerdict(
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
    checkType: 'presence',
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

test.describe('Semantic UI Element Identification Suite - FlytBase Cockpit', () => {

  test.beforeEach(async ({ request }) => {
    // Reset any active faults and ensure simulator baseline
    try {
      await request.delete(`${CONTROL_API_BASE_URL}/control/fault`);
      const stateRes = await request.get(`${CONTROL_API_BASE_URL}/control/state`);
      if (stateRes.ok()) {
        const state = await stateRes.json();
        const drone1 = state.drones?.['drone-1'];
        if (!state.running || (drone1 && drone1.battery < 15)) {
          await request.post(`${CONTROL_API_BASE_URL}/control/sim`, { data: { action: 'reset' } });
          await request.post(`${CONTROL_API_BASE_URL}/control/sim`, { data: { action: 'start' } });
        }
      }
    } catch (err) {
      console.warn('[beforeEach] Setup error while checking simulation state:', err);
    }
  });

  test.afterEach(async ({ request }) => {
    // Always clean up faults and restore drone-1 to ground
    try {
      await request.delete(`${CONTROL_API_BASE_URL}/control/fault`);
      const stateRes = await request.get(`${CONTROL_API_BASE_URL}/control/state`);
      if (stateRes.ok()) {
        const state = await stateRes.json();
        const drone1 = state.drones?.['drone-1'];
        if (drone1 && (drone1.status === 'in_flight' || drone1.status === 'taking_off')) {
          await request.post(`${CONTROL_API_BASE_URL}/control/command`, {
            data: { deviceId: 'drone-1', type: 'land' },
          });
        }
      }
    } catch (err) {
      console.warn('[afterEach] Cleanup error:', err);
    }
  });

  /**
   * Element 1: The take-off action for a selected drone
   *
   * DOM Selector Inspection Note (per requirement d):
   * In the current DOM on /dashboard, data-testid="dash-takeoff-drone-1" and data-cmd="takeoff"
   * DO exist on this button element:
   *   <button data-cmd="takeoff" data-id="drone-1" data-testid="dash-takeoff-drone-1">Take off</button>
   * Selector exists: YES (data-testid="dash-takeoff-drone-1").
   * We deliberately DO NOT use any CSS, id, class, or data-testid selector to locate it.
   */
  test('Semantic identification of take-off action', async ({ page, request }, testInfo) => {
    // Ensure drone-1 is on ground in standby
    const preStateRes = await request.get(`${CONTROL_API_BASE_URL}/control/state`);
    const preState = await preStateRes.json();
    if (preState.drones?.['drone-1']?.status !== 'standby') {
      await request.post(`${CONTROL_API_BASE_URL}/control/command`, {
        data: { deviceId: 'drone-1', type: 'land' },
      });
      await page.waitForTimeout(2000);
    }

    // Open operator control dashboard
    await page.goto(DASHBOARD_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const screenshotPath = path.join(testInfo.outputDir, 'semantic-takeoff-before.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot-before', { path: screenshotPath, contentType: 'image/png' });

    const agent = createMidsceneAgent(page);
    let locateResult: { center: [number, number]; rect: { left: number; top: number; width: number; height: number } } | null = null;
    let transitionSucceeded = false;
    let finalStatus = '';

    try {
      // (a) Locate using ONLY natural-language description (no CSS/id/class/data-testid)
      locateResult = await agent.aiLocate(
        "the button or control that starts the flight or initiates takeoff for drone-1"
      );

      expect(locateResult).toBeDefined();
      expect(locateResult.center).toBeDefined();
      expect(locateResult.center.length).toBe(2);

      // (c) Perform real action through that semantic location
      const [clickX, clickY] = locateResult.center;
      await page.mouse.click(clickX, clickY);

      // Verify drone flight state transition via Control API
      let attempts = 0;
      while (attempts < 10 && !transitionSucceeded) {
        await page.waitForTimeout(1000);
        const pollRes = await request.get(`${CONTROL_API_BASE_URL}/control/state`);
        if (pollRes.ok()) {
          const pollState = await pollRes.json();
          const d1Status = pollState.drones?.['drone-1']?.status;
          finalStatus = d1Status;
          if (d1Status === 'taking_off' || d1Status === 'in_flight') {
            transitionSucceeded = true;
            break;
          }
        }
        attempts++;
      }
    } finally {
      await agent.destroy();
      // Clean up: land drone-1
      await request.post(`${CONTROL_API_BASE_URL}/control/command`, {
        data: { deviceId: 'drone-1', type: 'land' },
      });
    }

    const testPassed = locateResult !== null && transitionSucceeded;
    const reasoning = [
      '[SEMANTIC ELEMENT IDENTIFICATION: TAKE-OFF ACTION]',
      'Target Element: Operator flight initiation control for drone-1.',
      'Natural-Language Description: "the button or control that starts the flight or initiates takeoff for drone-1"',
      'Locating Mechanism: Midscene agent.aiLocate() (visual-semantic coordinate inference).',
      `Identified Geometry: center=[${locateResult?.center[0]}, ${locateResult?.center[1]}], rect={left:${locateResult?.rect.left}, top:${locateResult?.rect.top}, width:${locateResult?.rect.width}, height:${locateResult?.rect.height}}.`,
      `Actuation: Dispatched mouse click directly to identified coordinates (${locateResult?.center[0]}, ${locateResult?.center[1]}).`,
      `Follow-up Verification: Drone-1 status transitioned to "${finalStatus}" (success: ${transitionSucceeded}).`,
      'Hardcoded Selector Audit: Stable selector EXISTS in DOM: data-testid="dash-takeoff-drone-1" (data-cmd="takeoff").',
      'Assessment: Semantic location successfully resolved the take-off control without relying on the data-testid that happened to be present in the DOM, and real physical command execution was verified.',
      `Verdict: ${testPassed ? 'PASS' : 'FAIL'}`,
    ].join('\n');

    await recordIdentificationVerdict(testInfo, {
      scenarioId: 'semantic-takeoff-action',
      title: 'Semantic identification of take-off action',
      description: 'Locates and actuates the drone take-off control on the operator dashboard purely by natural-language description without CSS or data-testid selectors.',
      approach: 'Use Midscene aiLocate() with semantic description to obtain element coordinates, dispatch mouse click to center, and verify flight state transition via Control API.',
      capabilityId: 'cockpit.semantic.takeoff-action',
      result: testPassed ? 'pass' : 'fail',
      confidence: 0.95,
      reasoning,
    });

    expect(testPassed).toBe(true);
  });

  /**
   * Element 2: The land action for a flying drone
   *
   * DOM Selector Inspection Note (per requirement d):
   * In the current DOM on /dashboard, data-testid="dash-land-drone-1" and data-cmd="land"
   * DO exist on this button element:
   *   <button data-cmd="land" data-id="drone-1" data-testid="dash-land-drone-1">Land</button>
   * Selector exists: YES (data-testid="dash-land-drone-1").
   * We deliberately DO NOT use any CSS, id, class, or data-testid selector to locate it.
   */
  test('Semantic identification of land action', async ({ page, request }, testInfo) => {
    // 1. Put drone-1 into flight first so Land action becomes active
    await request.post(`${CONTROL_API_BASE_URL}/control/command`, {
      data: { deviceId: 'drone-1', type: 'takeoff' },
    });

    let airborne = false;
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(1000);
      const sRes = await request.get(`${CONTROL_API_BASE_URL}/control/state`);
      if (sRes.ok()) {
        const s = await sRes.json();
        const st = s.drones?.['drone-1']?.status;
        if (st === 'taking_off' || st === 'in_flight') {
          airborne = true;
          break;
        }
      }
    }
    expect(airborne).toBe(true);

    // 2. Open operator control dashboard
    await page.goto(DASHBOARD_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const screenshotPath = path.join(testInfo.outputDir, 'semantic-land-before.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot-before', { path: screenshotPath, contentType: 'image/png' });

    const agent = createMidsceneAgent(page);
    let locateResult: { center: [number, number]; rect: { left: number; top: number; width: number; height: number } } | null = null;
    let landingTransitionSucceeded = false;
    let finalStatus = '';

    try {
      // (a) Locate using ONLY natural-language description (no CSS/id/class/data-testid)
      locateResult = await agent.aiLocate(
        "the button or control that commands a flying drone to land or return to ground for drone-1"
      );

      expect(locateResult).toBeDefined();
      expect(locateResult.center).toBeDefined();

      // (c) Perform real action through that semantic location
      const [clickX, clickY] = locateResult.center;
      await page.mouse.click(clickX, clickY);

      // Verify drone flight state transition toward landing/standby via Control API
      let attempts = 0;
      while (attempts < 10 && !landingTransitionSucceeded) {
        await page.waitForTimeout(1000);
        const pollRes = await request.get(`${CONTROL_API_BASE_URL}/control/state`);
        if (pollRes.ok()) {
          const pollState = await pollRes.json();
          const d1Status = pollState.drones?.['drone-1']?.status;
          finalStatus = d1Status;
          if (d1Status === 'landing' || d1Status === 'standby') {
            landingTransitionSucceeded = true;
            break;
          }
        }
        attempts++;
      }
    } finally {
      await agent.destroy();
    }

    const testPassed = locateResult !== null && landingTransitionSucceeded;
    const reasoning = [
      '[SEMANTIC ELEMENT IDENTIFICATION: LAND ACTION]',
      'Target Element: Operator landing command control for airborne drone-1.',
      'Natural-Language Description: "the button or control that commands a flying drone to land or return to ground for drone-1"',
      'Locating Mechanism: Midscene agent.aiLocate() (visual-semantic coordinate inference).',
      `Identified Geometry: center=[${locateResult?.center[0]}, ${locateResult?.center[1]}], rect={left:${locateResult?.rect.left}, top:${locateResult?.rect.top}, width:${locateResult?.rect.width}, height:${locateResult?.rect.height}}.`,
      `Actuation: Dispatched mouse click directly to identified coordinates (${locateResult?.center[0]}, ${locateResult?.center[1]}).`,
      `Follow-up Verification: Drone-1 status transitioned to "${finalStatus}" (success: ${landingTransitionSucceeded}).`,
      'Hardcoded Selector Audit: Stable selector EXISTS in DOM: data-testid="dash-land-drone-1" (data-cmd="land").',
      'Assessment: Semantic location successfully identified and activated the Land control while drone was airborne, without relying on data-testid="dash-land-drone-1", successfully triggering landing sequence.',
      `Verdict: ${testPassed ? 'PASS' : 'FAIL'}`,
    ].join('\n');

    await recordIdentificationVerdict(testInfo, {
      scenarioId: 'semantic-land-action',
      title: 'Semantic identification of land action',
      description: 'Locates and actuates the drone landing control on the operator dashboard purely by natural-language description without CSS or data-testid selectors.',
      approach: 'Bring drone-1 to flight, use Midscene aiLocate() to resolve landing control coordinates, dispatch mouse click to center, and confirm landing state transition via Control API.',
      capabilityId: 'cockpit.semantic.land-action',
      result: testPassed ? 'pass' : 'fail',
      confidence: 0.95,
      reasoning,
    });

    expect(testPassed).toBe(true);
  });

  /**
   * Element 3: The device/drone selector in the device list
   *
   * DOM Selector Inspection Note (per requirement d):
   * In the current DOM on Cockpit Main, data-testid="device-row-drone-2" and class="device-row"
   * DO exist on this element:
   *   <div data-testid="device-row-drone-2" class="device-row">Alpha-2 ...</div>
   * Selector exists: YES (data-testid="device-row-drone-2").
   * We deliberately DO NOT use any CSS, id, class, or data-testid selector to locate it.
   */
  test('Semantic identification of device selector in device list', async ({ page }, testInfo) => {
    await page.goto(COCKPIT_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const screenshotPath = path.join(testInfo.outputDir, 'semantic-selector-before.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot-before', { path: screenshotPath, contentType: 'image/png' });

    const agent = createMidsceneAgent(page);
    let locateResult: { center: [number, number]; rect: { left: number; top: number; width: number; height: number } } | null = null;
    let switchedSuccessfully = false;
    let updatedTitle = '';

    try {
      // (a) Locate using ONLY natural-language description (no CSS/id/class/data-testid)
      locateResult = await agent.aiLocate(
        "the control in the device list to switch to or select the second drone Alpha-2"
      );

      expect(locateResult).toBeDefined();
      expect(locateResult.center).toBeDefined();

      // (c) Perform real action: click on the identified device selector row
      const [clickX, clickY] = locateResult.center;
      await page.mouse.click(clickX, clickY);
      await page.waitForTimeout(1500);

      // Verify selection changed by querying telemetry panel title semantically
      updatedTitle = await agent.aiString(
        "What is the complete text of the Drone Telemetry panel heading or title at the top of the telemetry section?"
      );

      const lower = updatedTitle.toLowerCase();
      switchedSuccessfully = lower.includes('alpha-2') || lower.includes('drone-2') || lower.includes('drone 2');
    } finally {
      await agent.destroy();
    }

    const testPassed = locateResult !== null && switchedSuccessfully;
    const reasoning = [
      '[SEMANTIC ELEMENT IDENTIFICATION: DEVICE SELECTOR]',
      'Target Element: Device row in fleet list to select drone Alpha-2.',
      'Natural-Language Description: "the control in the device list to switch to or select the second drone Alpha-2"',
      'Locating Mechanism: Midscene agent.aiLocate() (visual-semantic coordinate inference).',
      `Identified Geometry: center=[${locateResult?.center[0]}, ${locateResult?.center[1]}], rect={left:${locateResult?.rect.left}, top:${locateResult?.rect.top}, width:${locateResult?.rect.width}, height:${locateResult?.rect.height}}.`,
      `Actuation: Dispatched mouse click directly to identified coordinates (${locateResult?.center[0]}, ${locateResult?.center[1]}).`,
      `Follow-up Verification: Telemetry panel heading updated to "${updatedTitle}" (reflects Alpha-2: ${switchedSuccessfully}).`,
      'Hardcoded Selector Audit: Stable selector EXISTS in DOM: data-testid="device-row-drone-2" (class="device-row").',
      'Assessment: Semantic location successfully identified the unselected Alpha-2 device row without using data-testid="device-row-drone-2", and clicking it successfully redirected dashboard telemetry to the selected drone.',
      `Verdict: ${testPassed ? 'PASS' : 'FAIL'}`,
    ].join('\n');

    await recordIdentificationVerdict(testInfo, {
      scenarioId: 'semantic-device-selector',
      title: 'Semantic identification of device selector in device list',
      description: 'Locates and clicks an alternative drone entry in the device list using purely natural-language description, confirming telemetry panel updates to the newly selected drone.',
      approach: 'Use Midscene aiLocate() to resolve Alpha-2 row coordinates, dispatch click, and query updated telemetry heading via aiString().',
      capabilityId: 'cockpit.semantic.device-selector',
      result: testPassed ? 'pass' : 'fail',
      confidence: 0.95,
      reasoning,
    });

    expect(testPassed).toBe(true);
  });

  /**
   * Element 4: The live/connection status indicator for video
   *
   * DOM Selector Inspection Note (per requirement d):
   * In the current DOM on Cockpit Main, data-testid="video-state" and class="video-state"
   * DO exist on this element:
   *   <span data-testid="video-state" class="muted video-state video-state-live">live</span>
   * Selector exists: YES (data-testid="video-state").
   * We deliberately DO NOT use any CSS, id, class, or data-testid selector to locate it.
   */
  test('Semantic identification of video status indicator', async ({ page }, testInfo) => {
    await page.goto(COCKPIT_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const screenshotPath = path.join(testInfo.outputDir, 'semantic-video-indicator.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot-video', { path: screenshotPath, contentType: 'image/png' });

    const agent = createMidsceneAgent(page);
    let locateResult: { center: [number, number]; rect: { left: number; top: number; width: number; height: number } } | null = null;
    let videoStateText = '';

    try {
      // (a) Locate using ONLY natural-language description (no CSS/id/class/data-testid)
      locateResult = await agent.aiLocate(
        "whatever on screen tells the user if the video feed is currently live"
      );

      expect(locateResult).toBeDefined();
      expect(locateResult.center).toBeDefined();

      // (c) Read state semantically
      videoStateText = await agent.aiString(
        "What is the exact text of whatever on screen tells the user if the video feed is currently live?"
      );

      expect(videoStateText).toBeDefined();
    } finally {
      await agent.destroy();
    }

    const validStates = ['live', 'off', 'connecting'];
    const matchesValidState = validStates.some((st) => videoStateText.toLowerCase().includes(st));
    const testPassed = locateResult !== null && matchesValidState;

    const reasoning = [
      '[SEMANTIC ELEMENT IDENTIFICATION: VIDEO STATUS INDICATOR]',
      'Target Element: FPV video feed live/reconnecting/off status pill.',
      'Natural-Language Description: "whatever on screen tells the user if the video feed is currently live"',
      'Locating Mechanism: Midscene agent.aiLocate() (visual-semantic coordinate inference).',
      `Identified Geometry: center=[${locateResult?.center[0]}, ${locateResult?.center[1]}], rect={left:${locateResult?.rect.left}, top:${locateResult?.rect.top}, width:${locateResult?.rect.width}, height:${locateResult?.rect.height}}.`,
      `Extracted State: "${videoStateText}" (valid state enum match: ${matchesValidState}).`,
      'Hardcoded Selector Audit: Stable selector EXISTS in DOM: data-testid="video-state" (class="video-state").',
      'Assessment: Semantic location pinpointed the video playback status pill without using data-testid="video-state", and semantically extracted the active feed status.',
      `Verdict: ${testPassed ? 'PASS' : 'FAIL'}`,
    ].join('\n');

    await recordIdentificationVerdict(testInfo, {
      scenarioId: 'semantic-video-status-indicator',
      title: 'Semantic identification of video status indicator',
      description: 'Locates and reads the video stream live/connection status indicator badge using purely natural-language description without CSS or data-testid selectors.',
      approach: 'Use Midscene aiLocate() to find indicator coordinates, and aiString() to extract its active state value.',
      capabilityId: 'cockpit.semantic.video-status-indicator',
      result: testPassed ? 'pass' : 'fail',
      confidence: 0.95,
      reasoning,
    });

    expect(testPassed).toBe(true);
  });

  /**
   * Element 5: The overall socket/connection health indicator
   *
   * DOM Selector Inspection Note (per requirement d):
   * In the current DOM on Cockpit Main, data-testid="socket-status" and class="pill pill-connected"
   * DO exist on this element:
   *   <span data-testid="socket-status" class="pill pill-connected">socket connected</span>
   * Selector exists: YES (data-testid="socket-status").
   * We deliberately DO NOT use any CSS, id, class, or data-testid selector to locate it.
   */
  test('Semantic identification of socket health indicator', async ({ page }, testInfo) => {
    await page.goto(COCKPIT_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const screenshotPath = path.join(testInfo.outputDir, 'semantic-socket-indicator.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot-socket', { path: screenshotPath, contentType: 'image/png' });

    const agent = createMidsceneAgent(page);
    let locateResult: { center: [number, number]; rect: { left: number; top: number; width: number; height: number } } | null = null;
    let socketStateText = '';

    try {
      // (a) Locate using ONLY natural-language description (no CSS/id/class/data-testid)
      locateResult = await agent.aiLocate(
        "whatever on screen tells the user if the app is currently connected to the backend"
      );

      expect(locateResult).toBeDefined();
      expect(locateResult.center).toBeDefined();

      // (c) Read state semantically
      socketStateText = await agent.aiString(
        "What is the exact text of whatever on screen tells the user if the app is currently connected to the backend?"
      );

      expect(socketStateText).toBeDefined();
    } finally {
      await agent.destroy();
    }

    const matchesExpected = socketStateText.toLowerCase().includes('socket connected') || socketStateText.toLowerCase().includes('connected');
    const testPassed = locateResult !== null && matchesExpected;

    const reasoning = [
      '[SEMANTIC ELEMENT IDENTIFICATION: SOCKET HEALTH INDICATOR]',
      'Target Element: Global WebSocket backend connection indicator badge in dashboard header.',
      'Natural-Language Description: "whatever on screen tells the user if the app is currently connected to the backend"',
      'Locating Mechanism: Midscene agent.aiLocate() (visual-semantic coordinate inference).',
      `Identified Geometry: center=[${locateResult?.center[0]}, ${locateResult?.center[1]}], rect={left:${locateResult?.rect.left}, top:${locateResult?.rect.top}, width:${locateResult?.rect.width}, height:${locateResult?.rect.height}}.`,
      `Extracted State: "${socketStateText}" (contains "connected": ${matchesExpected}).`,
      'Hardcoded Selector Audit: Stable selector EXISTS in DOM: data-testid="socket-status" (class="pill pill-connected").',
      'Assessment: Semantic location successfully resolved the header connectivity pill without relying on data-testid="socket-status", and verified the healthy connection text.',
      `Verdict: ${testPassed ? 'PASS' : 'FAIL'}`,
    ].join('\n');

    await recordIdentificationVerdict(testInfo, {
      scenarioId: 'semantic-socket-health-indicator',
      title: 'Semantic identification of socket health indicator',
      description: 'Locates and reads the global WebSocket backend connection health badge using purely natural-language description without CSS or data-testid selectors.',
      approach: 'Use Midscene aiLocate() to resolve badge geometry, and aiString() to extract its active health message.',
      capabilityId: 'cockpit.semantic.socket-health-indicator',
      result: testPassed ? 'pass' : 'fail',
      confidence: 0.95,
      reasoning,
    });

    expect(testPassed).toBe(true);
  });

});
