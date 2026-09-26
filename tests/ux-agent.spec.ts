import { test, expect } from '@playwright/test';
import path from 'path';
import { runUxTestGoal, type UxTestGoal } from '../src/agent/ux-test-agent';
import { CONTROL_API_BASE_URL, config } from '../src/config';

const COCKPIT_URL = config.cockpitUrl;
const DASHBOARD_URL = `${CONTROL_API_BASE_URL.replace(/\/api$/, '')}/dashboard`;

test.describe('Autonomous UI/UX Test Agent Suite - FlytBase Cockpit', () => {

  test.beforeEach(async ({ request }) => {
    // Clear faults and ensure simulator is fresh with sufficient battery
    try {
      await request.delete(`${CONTROL_API_BASE_URL}/control/fault`);
      const stateRes = await request.get(`${CONTROL_API_BASE_URL}/control/state`);
      if (stateRes.ok()) {
        const state = await stateRes.json();
        const drone1 = state.drones?.['drone-1'];
        if (!state.running || (drone1 && drone1.battery < 20)) {
          await request.post(`${CONTROL_API_BASE_URL}/control/sim`, { data: { action: 'reset' } });
          await request.post(`${CONTROL_API_BASE_URL}/control/sim`, { data: { action: 'start' } });
        }
      }
    } catch (err) {
      console.warn('[beforeEach] Simulator setup check:', err);
    }
  });

  test.afterEach(async ({ request }) => {
    // Always land any airborne drone and clean up faults
    try {
      await request.delete(`${CONTROL_API_BASE_URL}/control/fault`);
      const stateRes = await request.get(`${CONTROL_API_BASE_URL}/control/state`);
      if (stateRes.ok()) {
        const state = await stateRes.json();
        for (const [id, d] of Object.entries(state.drones || {})) {
          const drone = d as any;
          if (drone.status === 'in_flight' || drone.status === 'taking_off') {
            await request.post(`${CONTROL_API_BASE_URL}/control/command`, {
              data: { deviceId: id, type: 'land' },
            });
          }
        }
      }
    } catch (err) {
      console.warn('[afterEach] Cleanup error:', err);
    }
  });

  /**
   * Goal 1: Autonomous agent starts a drone's flight
   * Desktop viewport (1280x800)
   */
  test('Autonomous agent starts a drone flight', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop-only goal');

    // Setup: navigate to operator control panel where flight controls reside
    await page.goto(DASHBOARD_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const screenshotPath = path.join(testInfo.outputDir, 'takeoff-goal-before.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot-before', { path: screenshotPath, contentType: 'image/png' });

    const goal: UxTestGoal = {
      id: 'ux-agent.takeoff',
      title: "Autonomous agent starts a drone's flight",
      instruction: "Find the control that lets a user start a drone's flight, for whichever drone is currently selected or available, and use it.",
      verification: "Does the drone now show a status indicating it is airborne or in the process of taking off?",
      capabilityId: 'ux-agent.takeoff',
      viewport: 'desktop',
      checkType: 'presence',
    };

    let verdict;
    try {
      verdict = await runUxTestGoal(page, goal, testInfo);
    } finally {
      // Direct hardcoded cleanup per requirement
      await request.post(`${CONTROL_API_BASE_URL}/control/command`, {
        data: { deviceId: 'drone-1', type: 'land' },
      });
    }

    expect(verdict.result).toBe('pass');
  });

  /**
   * Goal 2: Autonomous agent switches which drone is being monitored
   * Desktop viewport (1280x800)
   */
  test('Autonomous agent switches which drone is being monitored', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop-only goal');

    // Setup: open Cockpit Main UI
    await page.goto(COCKPIT_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const screenshotPath = path.join(testInfo.outputDir, 'switch-drone-before.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot-before', { path: screenshotPath, contentType: 'image/png' });

    const goal: UxTestGoal = {
      id: 'ux-agent.switch-drone',
      title: 'Autonomous agent switches which drone is being monitored',
      instruction: 'Switch the view to show a different drone than whichever one is currently selected.',
      verification: 'Is the telemetry panel now showing data for a different drone than before?',
      capabilityId: 'ux-agent.switch-drone',
      viewport: 'desktop',
      checkType: 'presence',
    };

    const verdict = await runUxTestGoal(page, goal, testInfo);
    expect(verdict.result).toBe('pass');
  });

  /**
   * Goal 3: Autonomous agent determines whether video is currently live
   * Desktop viewport (1280x800)
   */
  test('Autonomous agent determines whether video is currently live', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop-only goal');

    // Setup: open Cockpit Main UI
    await page.goto(COCKPIT_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const screenshotPath = path.join(testInfo.outputDir, 'video-live-before.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot-before', { path: screenshotPath, contentType: 'image/png' });

    const goal: UxTestGoal = {
      id: 'ux-agent.check-video-live',
      title: 'Autonomous agent determines whether video is currently live',
      instruction: 'Look at the video feed area and determine whether it is currently showing a live stream.',
      verification: 'Did the agent correctly report the true current state of the video feed (live or not), matching what a human would see?',
      capabilityId: 'ux-agent.check-video-live',
      viewport: 'desktop',
      checkType: 'presence',
    };

    const verdict = await runUxTestGoal(page, goal, testInfo);
    expect(verdict.result).toBe('pass');
  });

  /**
   * Goal 4: Autonomous agent attempts to reach the flight control at mobile width
   * Mobile viewport (390x844)
   */
  test('Autonomous agent attempts to reach the flight control at mobile width [reach-flight-control-mobile]', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Mobile-only goal');

    // Setup: open Cockpit Main UI at mobile viewport
    await page.goto(COCKPIT_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const screenshotPath = path.join(testInfo.outputDir, 'mobile-flight-before.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('screenshot-before', { path: screenshotPath, contentType: 'image/png' });

    const goal: UxTestGoal = {
      id: 'ux-agent.reach-flight-control-mobile',
      title: 'Autonomous agent attempts to reach the flight control at mobile width',
      instruction: 'At this screen size, find and use the control that starts or stops a drone\'s flight.',
      verification: 'Was the agent able to actually locate and interact with the control, or did it fail/get stuck because the control was unreachable at this viewport?',
      capabilityId: 'ux-agent.reach-flight-control-mobile',
      viewport: 'mobile',
      checkType: 'visual-judgment',
    };

    let verdict;
    try {
      verdict = await runUxTestGoal(page, goal, testInfo);
    } finally {
      // Ensure any flight is cleaned up
      await request.post(`${CONTROL_API_BASE_URL}/control/command`, {
        data: { deviceId: 'drone-1', type: 'land' },
      });
    }

    // Expecting verdict to be either pass (if agent found it via link/scroll) or fail (if unreachable)
    expect(['pass', 'fail']).toContain(verdict.result);
  });

});
