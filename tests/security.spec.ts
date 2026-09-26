import { test, expect, TestInfo } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { CONTROL_API_BASE_URL } from '../src/config';
import { finalizeEvidence } from '../src/evidence/recorder';
import type { ScenarioVerdict } from '../src/types';

/**
 * Helper to record evidence, build the ScenarioVerdict (marked as 'fail' for security finding),
 * persist verdict.json in testInfo.outputDir, and attach it to Playwright test results.
 */
async function recordSecurityVerdict(
  testInfo: TestInfo,
  options: {
    scenarioId: string;
    title: string;
    description: string;
    approach: string;
    capabilityId: string;
    reasoning: string;
  }
): Promise<ScenarioVerdict> {
  const evidence = await finalizeEvidence(testInfo, { reasoning: options.reasoning });

  const verdict: ScenarioVerdict = {
    scenarioId: options.scenarioId,
    title: options.title,
    description: options.description,
    approach: options.approach,
    capabilityId: options.capabilityId,
    viewport: 'desktop',
    result: 'fail', // Deliberate security assessment verdict: lack of auth is a critical finding
    confidence: 1.0,
    checkType: 'security',
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

test.describe('Security & Permissions Suite - Control API & Surface', () => {

  test('Unauthenticated command execution', async ({ request }, testInfo) => {
    // 1. Ensure drone-1 is on ground in standby so takeoff command is valid
    const stateRes = await request.get(`${CONTROL_API_BASE_URL}/control/state`);
    if (stateRes.ok()) {
      const state = await stateRes.json();
      const drone1 = state.drones?.['drone-1'];
      if (drone1 && drone1.status !== 'standby') {
        // Reset simulation state so drone-1 is grounded and ready
        await request.post(`${CONTROL_API_BASE_URL}/control/sim`, { data: { action: 'reset' } });
        await request.post(`${CONTROL_API_BASE_URL}/control/sim`, { data: { action: 'start' } });
      }
    }

    // 2. Dispatch takeoff command with no auth headers, cookies, or prior session
    const commandPayload = { deviceId: 'drone-1', type: 'takeoff' };
    const res = await request.post(`${CONTROL_API_BASE_URL}/control/command`, {
      data: commandPayload,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Assert it succeeds (200 status, response confirms action)
    expect(res.status()).toBe(200);
    const resBody = await res.json();
    expect(resBody.ok).toBe(true);

    // 3. Clean up: land the drone afterward
    const landPayload = { deviceId: 'drone-1', type: 'land' };
    const landRes = await request.post(`${CONTROL_API_BASE_URL}/control/command`, {
      data: landPayload,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    expect(landRes.status()).toBe(200);
    const landBody = await landRes.json();

    // 4. Record request, response, and real-world security impact reasoning
    const reasoning = [
      `[SECURITY AUDIT FINDING: VULNERABILITY CONFIRMED]`,
      `Unauthenticated flight control command execution succeeded with HTTP 200 without any authentication, authorization, or session validation.`,
      `Request: POST ${CONTROL_API_BASE_URL}/control/command with payload ${JSON.stringify(commandPayload)} (no auth headers, no cookies).`,
      `Response: HTTP ${res.status()} ${JSON.stringify(resBody)}.`,
      `Cleanup Request: POST ${CONTROL_API_BASE_URL}/control/command with payload ${JSON.stringify(landPayload)}.`,
      `Cleanup Response: HTTP ${landRes.status()} ${JSON.stringify(landBody)}.`,
      `Real-world impact: Any device or actor on the network can force active drones to take off, alter flight states, or force landings during live missions. Without authentication or caller logging, rogue or accidental commands cannot be prevented or audited.`,
    ].join('\n');

    await recordSecurityVerdict(testInfo, {
      scenarioId: 'sec-unauth-command-execution',
      title: 'Unauthenticated command execution',
      description: 'Verifies whether flight control commands (/control/command) can be executed without authentication.',
      approach: 'Direct HTTP POST to /control/command with takeoff command without auth headers or cookies.',
      capabilityId: 'security.control.unauthenticated-command-execution',
      reasoning,
    });
  });

  test('Unauthenticated fault injection', async ({ request }, testInfo) => {
    // 1. Dispatch fault injection with no credentials
    const faultPayload = { kind: 'sim-offline', seconds: 5 };
    const res = await request.post(`${CONTROL_API_BASE_URL}/control/fault`, {
      data: faultPayload,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Assert it succeeds (200 status, response confirms fault)
    expect(res.status()).toBe(200);
    const resBody = await res.json();
    expect(resBody.faults).toBeDefined();

    // 2. Clean up: clear fault after
    const clearRes = await request.delete(`${CONTROL_API_BASE_URL}/control/fault`);
    expect(clearRes.status()).toBe(200);
    const clearBody = await clearRes.json();

    // 3. Record request, response, and real-world security impact reasoning
    const reasoning = [
      `[SECURITY AUDIT FINDING: VULNERABILITY CONFIRMED]`,
      `Unauthenticated fault injection succeeded with HTTP 200 without any authentication or credentials.`,
      `Request: POST ${CONTROL_API_BASE_URL}/control/fault with payload ${JSON.stringify(faultPayload)} (no auth headers, no cookies).`,
      `Response: HTTP ${res.status()} ${JSON.stringify(resBody)}.`,
      `Cleanup Request: DELETE ${CONTROL_API_BASE_URL}/control/fault.`,
      `Cleanup Response: HTTP ${clearRes.status()} ${JSON.stringify(clearBody)}.`,
      `Real-world impact: Any entity on the network can inject simulated hardware dropouts, sensor failures, or network freezes during live operations. This can blind operators, trigger unneeded emergency procedures, or mask actual hardware anomalies with zero audit attribution.`,
    ].join('\n');

    await recordSecurityVerdict(testInfo, {
      scenarioId: 'sec-unauth-fault-injection',
      title: 'Unauthenticated fault injection',
      description: 'Verifies whether system fault injection (/control/fault) can be performed without authentication.',
      approach: 'Direct HTTP POST to /control/fault with sim-offline payload without auth headers or cookies.',
      capabilityId: 'security.control.unauthenticated-fault-injection',
      reasoning,
    });
  });

  test('Unauthenticated destructive action', async ({ request }, testInfo) => {
    // 1. POST /control/drones to add a drone with no credentials
    const dronePayload = { name: 'SecTestDrone' };
    const addRes = await request.post(`${CONTROL_API_BASE_URL}/control/drones`, {
      data: dronePayload,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Assert creation succeeds
    expect(addRes.status()).toBe(200);
    const addBody = await addRes.json();
    const droneId = addBody.drone?.id || addBody.id;
    expect(droneId).toBeTruthy();

    // 2. DELETE /control/drones/:id to remove it, with no credentials
    let delRes;
    let delBody;
    try {
      delRes = await request.delete(`${CONTROL_API_BASE_URL}/control/drones/${droneId}`);
      expect(delRes.status()).toBe(200);
      delBody = await delRes.json();
      expect(delBody.ok).toBe(true);
    } finally {
      // Ensure drone removal if assertion threw earlier
      if (!delRes || !delRes.ok()) {
        await request.delete(`${CONTROL_API_BASE_URL}/control/drones/${droneId}`).catch(() => {});
      }
    }

    // 3. Record request, response, and real-world security impact reasoning
    const reasoning = [
      `[SECURITY AUDIT FINDING: VULNERABILITY CONFIRMED]`,
      `Unauthenticated destructive fleet modification succeeded with HTTP 200 without any administrative credentials.`,
      `Creation Request: POST ${CONTROL_API_BASE_URL}/control/drones with payload ${JSON.stringify(dronePayload)} (no credentials).`,
      `Creation Response: HTTP ${addRes.status()} ${JSON.stringify(addBody)}.`,
      `Deletion Request: DELETE ${CONTROL_API_BASE_URL}/control/drones/${droneId} (no credentials).`,
      `Deletion Response: HTTP ${delRes.status()} ${JSON.stringify(delBody)}.`,
      `Real-world impact: Any actor on the network can arbitrarily add phantom drones to the fleet or delete registered drones and docks. Removing operational drones eliminates telemetry and control visibility, while rogue entries can disrupt airspace management and deceive human operators.`,
    ].join('\n');

    await recordSecurityVerdict(testInfo, {
      scenarioId: 'sec-unauth-destructive-action',
      title: 'Unauthenticated destructive action',
      description: 'Verifies whether fleet entities (/control/drones) can be created and deleted without administrative authentication.',
      approach: 'Direct HTTP POST to create drone and DELETE to remove drone with no auth headers or cookies.',
      capabilityId: 'security.control.unauthenticated-destructive-action',
      reasoning,
    });
  });

  test('Control panel reachability', async ({ request }, testInfo) => {
    // 1. GET /dashboard with no credentials
    const dashboardUrl = new URL('/dashboard', CONTROL_API_BASE_URL).href;
    const res = await request.get(dashboardUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    // Assert it returns 200, i.e. anyone on the network can reach the operator control surface
    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'] || '';
    expect(contentType).toContain('text/html');
    const bodyText = await res.text();
    expect(bodyText.length).toBeGreaterThan(0);
    expect(bodyText).toContain('<');

    // 2. Record request, response, and real-world security impact reasoning
    const bodyPreview = bodyText.substring(0, 150).replace(/\r?\n/g, ' ');
    const reasoning = [
      `[SECURITY AUDIT FINDING: VULNERABILITY CONFIRMED]`,
      `Control panel operator interface (/dashboard) is reachable over the network without any authentication challenge.`,
      `Request: GET ${dashboardUrl} (no auth headers, no cookies, no active session).`,
      `Response: HTTP ${res.status()} Content-Type: "${contentType}" (Length: ${bodyText.length} bytes, Preview: "${bodyPreview}...").`,
      `Real-world impact: Anyone on the local network or routed subnet can access the mission control dashboard directly. The interface provides unauthenticated access to flight telemetry, status displays, and control triggers without requiring a login, SSO credential, or session verification.`,
    ].join('\n');

    await recordSecurityVerdict(testInfo, {
      scenarioId: 'sec-unauth-control-panel-reachability',
      title: 'Control panel reachability',
      description: 'Verifies whether the operator dashboard (/dashboard) is exposed on the network without authentication.',
      approach: 'Direct HTTP GET to /dashboard without cookies or authorization headers.',
      capabilityId: 'security.dashboard.unauthenticated-reachability',
      reasoning,
    });
  });

});
