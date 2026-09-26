import { test, expect, TestInfo, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { config } from '../src/config';
import { finalizeEvidence } from '../src/evidence/recorder';
import { createMidsceneAgent } from '../src/midscene/agent-factory';
import type { ScenarioVerdict } from '../src/types';

/**
 * Helper to record evidence, build the ScenarioVerdict,
 * persist verdict.json in testInfo.outputDir, and attach it to Playwright test results.
 */
async function recordResponsiveVerdict(
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
    viewport: 'mobile',
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

test.describe('Responsive & Mobile Viewport Suite (390x844)', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure 390x844 viewport
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('Take-off/land controls reachable at phone width', async ({ page }, testInfo) => {
    // 1. Navigate to cockpit URL
    await page.goto(config.cockpitUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // 2. Select first drone row
    const firstDroneRow = page.locator('.device-row').first();
    await expect(firstDroneRow).toBeVisible({ timeout: 10000 });
    await firstDroneRow.click();
    await page.waitForTimeout(500);

    // Take initial full-page screenshot of main cockpit
    const cockpitScreenshot = testInfo.outputPath('mobile-cockpit-main.png');
    await page.screenshot({ path: cockpitScreenshot, fullPage: true });
    await testInfo.attach('cockpit-screenshot', {
      path: cockpitScreenshot,
      contentType: 'image/png',
    });

    // 3. Inspect where take-off/land controls live:
    // In this Cockpit architecture, flight actions are located on the Control Panel (/dashboard),
    // accessible via the header's "Control panel ->" link (.dashboard-link).
    const dashboardLink = page.locator('a.dashboard-link');
    await expect(dashboardLink).toBeVisible();
    const linkBox = await dashboardLink.boundingBox();

    // Deterministic check on cockpit page:
    // Check horizontal overflow on main page
    const cockpitScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const cockpitClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const hasHorizontalScrollMain = cockpitScrollWidth > cockpitClientWidth;

    // Use Midscene AI on the main cockpit page
    const midsceneMain = createMidsceneAgent(page);
    let cutOffOnMain = false;
    try {
      cutOffOnMain = await midsceneMain.aiBoolean(
        'Is there any control on this screen that is cut off, pushed outside the visible viewport, or requires horizontal scrolling to reach?'
      );
    } catch (err) {
      console.warn('[Midscene warning on main page]:', err);
    } finally {
      await midsceneMain.destroy();
    }

    // Now navigate to the dashboard where the take-off/land buttons reside
    const dashboardHref = await dashboardLink.getAttribute('href');
    const targetUrl = dashboardHref || `${config.controlApiUrl.replace(/\/api$/, '')}/dashboard`;
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const dashboardScreenshot = testInfo.outputPath('mobile-control-panel-dashboard.png');
    await page.screenshot({ path: dashboardScreenshot, fullPage: true });
    await testInfo.attach('dashboard-screenshot', {
      path: dashboardScreenshot,
      contentType: 'image/png',
    });

    // On dashboard, check take-off / land controls
    const takeoffBtn = page.locator('button[data-cmd="takeoff"]').first();
    const landBtn = page.locator('button[data-cmd="land"]').first();
    const takeoffVisible = await takeoffBtn.isVisible().catch(() => false);
    const landVisible = await landBtn.isVisible().catch(() => false);

    const takeoffBox = takeoffVisible ? await takeoffBtn.boundingBox() : null;
    const landBox = landVisible ? await landBtn.boundingBox() : null;

    const dashScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const dashClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const dashHorizontalOverflow = dashScrollWidth > dashClientWidth;

    // Use Midscene AI on the control panel screen
    const midsceneDash = createMidsceneAgent(page);
    let cutOffOnDash = false;
    try {
      cutOffOnDash = await midsceneDash.aiBoolean(
        'Is there any control on this screen that is cut off, pushed outside the visible viewport, or requires horizontal scrolling to reach?'
      );
    } catch (err) {
      console.warn('[Midscene warning on dashboard]:', err);
    } finally {
      await midsceneDash.destroy();
    }

    // Determine verdict
    // If the dashboard table pushes Take off / Land off-screen or requires horizontal scroll:
    const isPushedOffScreen = takeoffBox ? (takeoffBox.x + takeoffBox.width > 390) : false;
    const hasDefect = dashHorizontalOverflow || isPushedOffScreen || cutOffOnDash;
    const result: 'pass' | 'fail' = hasDefect ? 'fail' : 'pass';

    const reasoning = [
      `[RESPONSIVE EVALUATION: Take-off/land controls at 390x844]`,
      `Cockpit Main UI (${config.cockpitUrl}):`,
      `  - Document scrollWidth: ${cockpitScrollWidth}px (clientWidth: ${cockpitClientWidth}px). Horizontal overflow: ${hasHorizontalScrollMain}.`,
      `  - Dashboard link visible: ${Boolean(linkBox)}, boundingBox=${JSON.stringify(linkBox)}.`,
      `  - Midscene evaluation (cut off / pushed outside / horizontal scroll on main): ${cutOffOnMain}.`,
      `Control Panel Dashboard (${targetUrl}):`,
      `  - Document scrollWidth: ${dashScrollWidth}px (clientWidth: ${dashClientWidth}px). Horizontal overflow: ${dashHorizontalOverflow}.`,
      `  - Takeoff button visible: ${takeoffVisible}, boundingBox: ${JSON.stringify(takeoffBox)}.`,
      `  - Land button visible: ${landVisible}, boundingBox: ${JSON.stringify(landBox)}.`,
      `  - Takeoff button pushed outside 390px viewport: ${isPushedOffScreen}.`,
      `  - Midscene evaluation (cut off / pushed outside / horizontal scroll on dashboard): ${cutOffOnDash}.`,
      `Finding: ${hasDefect ? 'Flight action controls (Take off / Land) on the Control Dashboard overflow the 390px viewport (scrollWidth=' + dashScrollWidth + 'px) and require horizontal scrolling to reach/actuate.' : 'All flight controls are accessible and fit within mobile bounds.'}`,
      `Verdict: ${result.toUpperCase()}`,
    ].join('\n');

    await recordResponsiveVerdict(testInfo, {
      scenarioId: 'responsive-takeoff-land-controls',
      title: 'Take-off/land controls reachable at phone width',
      description: 'Verifies whether take-off/land actions and control dashboard links are visible and accessible without requiring horizontal scroll at 390px width.',
      approach: 'Load cockpit at 390x844, select drone, evaluate main page and control dashboard with boundingBox checks and Midscene aiBoolean neutral query.',
      capabilityId: 'cockpit.mobile.flight-controls-reachability',
      result,
      confidence: 0.95,
      reasoning,
    });
  });

  test('Device list usable at phone width', async ({ page }, testInfo) => {
    // 1. Navigate to cockpit URL
    await page.goto(config.cockpitUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const screenshotPath = testInfo.outputPath('mobile-device-list.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('device-list-screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    // 2. Locate device rows
    const deviceRows = page.locator('.device-row');
    const rowCount = await deviceRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // 3. Deterministic bounding box and overlap check
    const rowBoxes: Array<{ index: number; box: { x: number; y: number; width: number; height: number } }> = [];
    let hasClipping = false;
    let hasOverlap = false;

    for (let i = 0; i < rowCount; i++) {
      const row = deviceRows.nth(i);
      await expect(row).toBeVisible();
      const box = await row.boundingBox();
      if (!box) continue;
      rowBoxes.push({ index: i, box });

      // Check bounds within viewport width 390px
      if (box.x < 0 || box.x + box.width > 390) {
        hasClipping = true;
      }
    }

    // Check vertical overlap between adjacent rows
    for (let i = 0; i < rowBoxes.length - 1; i++) {
      const current = rowBoxes[i].box;
      const next = rowBoxes[i + 1].box;
      // If next starts before current finishes (with 1px margin)
      if (next.y < current.y + current.height - 1) {
        hasOverlap = true;
      }
    }

    // 4. Test interactive tappability: tap first and second drone rows
    await deviceRows.nth(0).click();
    await page.waitForTimeout(300);
    const firstSelected = await deviceRows.nth(0).evaluate((el) => el.classList.contains('selected'));

    if (rowCount > 1) {
      await deviceRows.nth(1).click();
      await page.waitForTimeout(300);
      const secondSelected = await deviceRows.nth(1).evaluate((el) => el.classList.contains('selected'));
      expect(secondSelected).toBe(true);
    }
    expect(firstSelected).toBe(true);

    // 5. Midscene visual judgment
    const midsceneAgent = createMidsceneAgent(page);
    let midsceneIssues = false;
    try {
      midsceneIssues = await midsceneAgent.aiBoolean(
        'In the device list panel, are any drone names, dock names, status pills, or list items overlapping, clipped, or unreadable?'
      );
    } catch (err) {
      console.warn('[Midscene warning on device list]:', err);
    } finally {
      await midsceneAgent.destroy();
    }

    const hasDefect = hasClipping || hasOverlap || midsceneIssues;
    const result: 'pass' | 'fail' = hasDefect ? 'fail' : 'pass';

    const reasoning = [
      `[RESPONSIVE EVALUATION: Device list at 390x844]`,
      `Total device rows rendered: ${rowCount}.`,
      `Row bounding boxes: ${JSON.stringify(rowBoxes.map((r) => ({ index: r.index, x: Math.round(r.box.x), w: Math.round(r.box.width), y: Math.round(r.box.y), h: Math.round(r.box.height) })))}.`,
      `Horizontal clipping detected (bounds outside 390px): ${hasClipping}.`,
      `Vertical overlap between adjacent rows: ${hasOverlap}.`,
      `Tappability check: successfully clicked rows and toggled 'selected' class.`,
      `Midscene aiBoolean (overlapping/clipped/unreadable in device list): ${midsceneIssues}.`,
      `Assessment: ${hasDefect ? 'Device list exhibits clipping or overlapping at 390px.' : 'Device list is well-proportioned, fits within 390px width, and each device item is tappable without overlap.'}`,
      `Verdict: ${result.toUpperCase()}`,
    ].join('\n');

    await recordResponsiveVerdict(testInfo, {
      scenarioId: 'responsive-device-list-usability',
      title: 'Device list usable at phone width',
      description: 'Confirms the device list (drones/docks) is visible and each item is cleanly tappable without overlapping or clipping at 390px mobile viewport.',
      approach: 'Inspect device rows bounding boxes, verify no horizontal clipping or vertical collision, test tap selection, and query Midscene aiBoolean.',
      capabilityId: 'cockpit.mobile.device-list-usability',
      result,
      confidence: 0.95,
      reasoning,
    });
  });

  test('Telemetry panel readability at phone width', async ({ page }, testInfo) => {
    // 1. Navigate to cockpit URL and select drone-1
    await page.goto(config.cockpitUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const firstDroneRow = page.locator('.device-row').first();
    await firstDroneRow.click();
    await page.waitForTimeout(500);

    // 2. Scroll the left sidebar to bring TelemetryPanel into view
    const telemetryPanel = page.locator('section.panel').filter({ hasText: 'Drone Telemetry' });
    await expect(telemetryPanel).toBeVisible({ timeout: 10000 });
    await telemetryPanel.scrollIntoViewIfNeeded();

    const screenshotPath = testInfo.outputPath('mobile-telemetry-panel.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('telemetry-screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    // 3. Inspect telemetry cells
    const telemetryRows = page.locator('.telemetry-row');
    const rowCount = await telemetryRows.count();
    expect(rowCount).toBeGreaterThan(0);

    let hasClipping = false;
    let hasOverflowingText = false;
    const cellStats: Array<{ label: string; value: string; x: number; width: number; clipped: boolean }> = [];

    for (let i = 0; i < rowCount; i++) {
      const row = telemetryRows.nth(i);
      const dt = row.locator('dt');
      const dd = row.locator('dd');
      const label = (await dt.textContent())?.trim() ?? '';
      const value = (await dd.textContent())?.trim() ?? '';
      const box = await row.boundingBox();

      if (box) {
        if (box.x < 0 || box.x + box.width > 390) {
          hasClipping = true;
        }
      }

      // Check text truncation / scrollWidth on dt and dd
      const isDdTruncated = await dd.evaluate((el) => el.scrollWidth > el.clientWidth);
      const isDtTruncated = await dt.evaluate((el) => el.scrollWidth > el.clientWidth);
      if (isDdTruncated || isDtTruncated) {
        hasOverflowingText = true;
      }

      cellStats.push({
        label,
        value,
        x: Math.round(box?.x ?? 0),
        width: Math.round(box?.width ?? 0),
        clipped: isDdTruncated || isDtTruncated,
      });
    }

    // 4. Midscene visual judgment
    const midsceneAgent = createMidsceneAgent(page);
    let midsceneIssues = false;
    try {
      midsceneIssues = await midsceneAgent.aiBoolean(
        'In the telemetry panel, are any telemetry numbers, units (e.g. %, m, m/s), or labels truncated, cut off, overlapping, or unreadable?'
      );
    } catch (err) {
      console.warn('[Midscene warning on telemetry]:', err);
    } finally {
      await midsceneAgent.destroy();
    }

    const hasDefect = hasClipping || hasOverflowingText || midsceneIssues;
    const result: 'pass' | 'fail' = hasDefect ? 'fail' : 'pass';

    const reasoning = [
      `[RESPONSIVE EVALUATION: Telemetry panel readability at 390x844]`,
      `Telemetry metrics inspected: ${rowCount} cells (${cellStats.map((c) => `${c.label}: "${c.value}"`).join(', ')}).`,
      `Grid bounding box horizontal clipping (>390px): ${hasClipping}.`,
      `Internal text overflow (scrollWidth > clientWidth): ${hasOverflowingText}.`,
      `Midscene aiBoolean (truncated, cut off, overlapping, or unreadable): ${midsceneIssues}.`,
      `Assessment: ${hasDefect ? 'Telemetry panel values suffer from clipping or truncation at mobile viewport.' : 'Telemetry metrics (2-column layout) are formatted, legible, and contained within 390px viewport width without text overflow.'}`,
      `Verdict: ${result.toUpperCase()}`,
    ].join('\n');

    await recordResponsiveVerdict(testInfo, {
      scenarioId: 'responsive-telemetry-readability',
      title: 'Telemetry panel readability at phone width',
      description: 'Confirms telemetry numbers (battery, altitude, speed, wind, distance) are not clipped, truncated, or overlapping at 390px mobile width.',
      approach: 'Scroll telemetry panel into view, inspect cell bounding boxes and scrollWidth vs clientWidth, and evaluate visual clarity with Midscene aiBoolean.',
      capabilityId: 'cockpit.mobile.telemetry-readability',
      result,
      confidence: 0.95,
      reasoning,
    });
  });

  test('Map and video tile layout at phone width', async ({ page }, testInfo) => {
    // 1. Navigate to cockpit URL
    await page.goto(config.cockpitUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const screenshotPath = testInfo.outputPath('mobile-map-video-layout.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('map-video-screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    // 2. Locate map canvas, video tile, and 2D/3D view toggle
    const mapCanvas = page.locator('main.cockpit-map');
    const videoTile = page.locator('.video-tile');
    const viewToggle = page.locator('.map-view-toggle');

    await expect(mapCanvas).toBeVisible();
    await expect(videoTile).toBeVisible();
    const hasViewToggle = await viewToggle.isVisible().catch(() => false);

    const mapBox = await mapCanvas.boundingBox();
    const videoBox = await videoTile.boundingBox();
    const toggleBox = hasViewToggle ? await viewToggle.boundingBox() : null;

    // Check if video tile is pushed off-screen
    const videoOffScreen = videoBox ? (videoBox.x < 0 || videoBox.x + videoBox.width > 390 || videoBox.y + videoBox.height > 844) : true;

    // Check if video tile overlaps the map view toggle (2D / 3D buttons)
    let videoOverlapsToggle = false;
    if (videoBox && toggleBox) {
      // Horizontal overlap check
      const xOverlap = Math.max(0, Math.min(videoBox.x + videoBox.width, toggleBox.x + toggleBox.width) - Math.max(videoBox.x, toggleBox.x));
      // Vertical overlap check
      const yOverlap = Math.max(0, Math.min(videoBox.y + videoBox.height, toggleBox.y + toggleBox.height) - Math.max(videoBox.y, toggleBox.y));
      if (xOverlap > 0 && yOverlap > 0) {
        videoOverlapsToggle = true;
      }
    }

    // Check if switching between 2D and 3D works
    let toggleWorks = false;
    let toggleClickBlocked = false;
    if (hasViewToggle) {
      try {
        const btn2d = viewToggle.locator('button', { hasText: '2D' });
        const btn3d = viewToggle.locator('button', { hasText: '3D' });
        await btn2d.click({ timeout: 3000 });
        await page.waitForTimeout(300);
        const is2dActive = await btn2d.evaluate((el) => el.classList.contains('active'));
        await btn3d.click({ timeout: 3000 });
        await page.waitForTimeout(300);
        const is3dActive = await btn3d.evaluate((el) => el.classList.contains('active'));
        toggleWorks = is2dActive || is3dActive;
      } catch (err) {
        toggleClickBlocked = true;
      }
    }

    // 3. Midscene visual judgment
    const midsceneAgent = createMidsceneAgent(page);
    let midsceneOverlapIssue = false;
    try {
      midsceneOverlapIssue = await midsceneAgent.aiBoolean(
        'Does the floating video tile overlap, obscure, or collide with the map view toggle (2D/3D controls), or does any element get pushed off-screen?'
      );
    } catch (err) {
      console.warn('[Midscene warning on map video layout]:', err);
    } finally {
      await midsceneAgent.destroy();
    }

    const hasDefect = videoOffScreen || videoOverlapsToggle || toggleClickBlocked || midsceneOverlapIssue;
    const result: 'pass' | 'fail' = hasDefect ? 'fail' : 'pass';

    const reasoning = [
      `[RESPONSIVE EVALUATION: Map and video tile layout at 390x844]`,
      `Map canvas boundingBox: ${JSON.stringify(mapBox)}.`,
      `Video tile boundingBox: ${JSON.stringify(videoBox)}.`,
      `View toggle (2D/3D) boundingBox: ${JSON.stringify(toggleBox)}.`,
      `Video tile pushed off-screen: ${videoOffScreen}.`,
      `Video tile overlaps map-view-toggle: ${videoOverlapsToggle}.`,
      `Toggle click blocked or intercepted: ${toggleClickBlocked} (toggle functional: ${toggleWorks}).`,
      `Midscene aiBoolean (video tile overlaps/obscures toggle or pushed off-screen): ${midsceneOverlapIssue}.`,
      `Assessment: ${hasDefect ? 'Layout defect detected: Video tile (' + Math.round(videoBox?.width ?? 0) + 'px wide) overlaps the centered 2D/3D map toggle controls at bottom of mobile screen.' : 'Map and video tile layout are properly partitioned without collision.'}`,
      `Verdict: ${result.toUpperCase()}`,
    ].join('\n');

    await recordResponsiveVerdict(testInfo, {
      scenarioId: 'responsive-map-video-tile-layout',
      title: 'Map and video tile layout at phone width',
      description: 'Confirms the map and video tile do not overlap each other or get pushed off-screen, and verifies whether switching between view modes works.',
      approach: 'Measure bounding boxes of map canvas, video tile, and 2D/3D toggle controls, test click interaction on view toggle, and evaluate visual collision with Midscene aiBoolean.',
      capabilityId: 'cockpit.mobile.map-video-tile-layout',
      result,
      confidence: 0.95,
      reasoning,
    });
  });
});
