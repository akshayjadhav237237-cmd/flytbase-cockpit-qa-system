import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import type { TestInfo } from '@playwright/test';
import { config } from '../config';
import { runUxTestGoal, type UxTestGoal } from '../agent/ux-test-agent';
import { finalizeEvidence } from '../evidence/recorder';
import { planScenariosFromFeatureSummary, type PlannedScenario } from './planner';
import type { CapabilityExpectation, ScenarioVerdict } from '../types';

// Standard viewport configurations matching playwright.config.ts
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;

export interface FeatureAgentPipelineOptions {
  cockpitUrl?: string;
  onLog?: (line: string) => void;
  runsBaseDir?: string;
}

/**
 * Creates a mock Playwright TestInfo object conforming to TestInfo interface
 * required by finalizeEvidence and runUxTestGoal.
 */
function createMockTestInfo(title: string, outputDir: string): {
  testInfo: TestInfo;
  attachments: Array<{ name: string; path?: string; contentType?: string }>;
} {
  const attachments: Array<{ name: string; path?: string; contentType?: string }> = [];

  const testInfo = {
    title,
    outputDir,
    attachments,
    attach: async (name: string, options: { path?: string; body?: any; contentType?: string }) => {
      attachments.push({
        name,
        path: options.path,
        contentType: options.contentType || 'application/octet-stream',
      });
    },
  } as unknown as TestInfo;

  return { testInfo, attachments };
}

/**
 * Runs the end-to-end autonomous feature test agent pipeline:
 * 1. AI planning from feature summary
 * 2. Playwright browser execution for each planned scenario
 * 3. Video recording, screenshots, and verdict persistence
 * 4. Spec capability additions persistence
 *
 * Emits logs to console and options.onLog if provided.
 */
export async function runFeatureAgentPipeline(
  featureSummary: string,
  options?: FeatureAgentPipelineOptions
): Promise<ScenarioVerdict[]> {
  const log = (msg: string = '') => {
    console.log(msg);
    if (options?.onLog) {
      options.onLog(msg);
    }
  };

  const cockpitUrl = options?.cockpitUrl || config.cockpitUrl;

  log('\n======================================================');
  log('🤖 AUTONOMOUS QA FEATURE TEST AGENT');
  log('======================================================');
  log(`Cockpit Target: ${cockpitUrl}`);
  log(`Feature Summary:\n"${featureSummary}"\n`);
  log('⚡ Contacting AI Planner to generate scenarios...');

  // STEP 1: Autonomous Scenario Planning
  let plannedScenarios: PlannedScenario[];
  try {
    plannedScenarios = await planScenariosFromFeatureSummary(featureSummary, {
      cockpitUrl,
      knownScreens: ['cockpit-main', 'operator-dashboard'],
    });
  } catch (err: any) {
    log('\n❌ Scenario planning failed:');
    log(err.message || String(err));
    throw err;
  }

  // Display planned scenarios before execution
  log('\n======================================================');
  log(`📋 GENERATED SCENARIO PLAN (${plannedScenarios.length} Scenarios)`);
  log('======================================================');
  plannedScenarios.forEach((s, idx) => {
    log(`\n[Scenario ${idx + 1}/${plannedScenarios.length}] ${s.title}`);
    log(`  ID:           ${s.id}`);
    log(`  CapabilityID: ${s.capabilityId}`);
    log(`  Viewport:     ${s.viewport} (${s.viewport === 'mobile' ? '390x844' : '1280x800'})`);
    log(`  Instruction:  ${s.instruction}`);
    log(`  Verification: ${s.verification}`);
  });
  log('\n======================================================');
  log('🚀 BEGINNING AUTONOMOUS BROWSER EXECUTION');
  log('======================================================\n');

  // Launch Playwright browser
  const browser = await chromium.launch({
    headless: true,
  });

  const runsBaseDir = options?.runsBaseDir || path.resolve(__dirname, '../../runs/feature-agent');
  fs.mkdirSync(runsBaseDir, { recursive: true });

  const verdicts: ScenarioVerdict[] = [];

  try {
    for (let i = 0; i < plannedScenarios.length; i++) {
      const scenario = plannedScenarios[i];
      const scenarioDirName = scenario.id.replace(/[^a-zA-Z0-9._-]/g, '_');
      const scenarioOutputDir = path.join(runsBaseDir, scenarioDirName);
      fs.mkdirSync(scenarioOutputDir, { recursive: true });

      const viewportSize =
        scenario.viewport === 'mobile' ? VIEWPORTS.mobile : VIEWPORTS.desktop;

      log(`\n------------------------------------------------------`);
      log(`▶ Executing [${i + 1}/${plannedScenarios.length}]: "${scenario.title}"`);
      log(`  Viewport: ${scenario.viewport} (${viewportSize.width}x${viewportSize.height})`);
      log(`  Output Dir: ${scenarioOutputDir}`);
      log(`------------------------------------------------------`);

      // Create browser context with video recording enabled
      const context = await browser.newContext({
        viewport: viewportSize,
        recordVideo: {
          dir: scenarioOutputDir,
          size: viewportSize,
        },
      });

      const page = await context.newPage();
      const { testInfo, attachments } = createMockTestInfo(scenario.title, scenarioOutputDir);

      let verdict: ScenarioVerdict = {
        scenarioId: scenario.id,
        title: scenario.title,
        description: `Autonomous agent goal: ${scenario.instruction}`,
        approach: 'Autonomous agent execution via Midscene aiAct() and aiBoolean() verification.',
        capabilityId: scenario.capabilityId,
        viewport: scenario.viewport,
        result: 'fail',
        confidence: 0.9,
        checkType: 'visual-judgment',
        evidence: {
          videoPath: '',
          screenshotPaths: [],
        },
        reasoning: 'Pending execution',
        timestamp: new Date().toISOString(),
      };

      try {
        log(`  Navigating to ${cockpitUrl}...`);
        await page.goto(cockpitUrl, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(2000);

        // Capture initial before-action screenshot
        const beforeScreenshotPath = path.join(scenarioOutputDir, 'before.png');
        await page.screenshot({ path: beforeScreenshotPath });
        await testInfo.attach('screenshot-before', {
          path: beforeScreenshotPath,
          contentType: 'image/png',
        });

        const goal: UxTestGoal = {
          id: scenario.id,
          title: scenario.title,
          instruction: scenario.instruction,
          verification: scenario.verification,
          capabilityId: scenario.capabilityId,
          viewport: scenario.viewport,
          checkType: 'visual-judgment',
        };

        log(`  Invoking runUxTestGoal (Midscene AI agent)...`);
        verdict = await runUxTestGoal(page, goal, testInfo);

        // Capture final after-action screenshot
        try {
          const afterScreenshotPath = path.join(scenarioOutputDir, 'after.png');
          await page.screenshot({ path: afterScreenshotPath });
          await testInfo.attach('screenshot-after', {
            path: afterScreenshotPath,
            contentType: 'image/png',
          });
        } catch {
          // If page closed or destroyed, proceed
        }
      } catch (execErr: any) {
        log(`  Execution error during scenario ${scenario.id}: ${execErr.message || execErr}`);
        verdict.result = 'fail';
        verdict.reasoning = `Unhandled error during execution: ${execErr.message || execErr}`;
      } finally {
        // Retrieve video handle before closing page
        const video = page.video();
        await page.close().catch(() => {});
        await context.close().catch(() => {});

        // Finalize video path after context close
        let recordedVideoPath = '';
        if (video) {
          try {
            recordedVideoPath = await video.path();
          } catch (vErr) {
            log(`  Could not get video path for ${scenario.id}: ${vErr}`);
          }
        }

        const standardVideoPath = path.join(scenarioOutputDir, 'video.webm');
        if (recordedVideoPath && fs.existsSync(recordedVideoPath)) {
          if (recordedVideoPath !== standardVideoPath) {
            try {
              fs.copyFileSync(recordedVideoPath, standardVideoPath);
            } catch {
              // If copy fails, keep recordedVideoPath
            }
          }
        }

        const effectiveVideoPath = fs.existsSync(standardVideoPath)
          ? standardVideoPath
          : recordedVideoPath;

        if (effectiveVideoPath) {
          const existing = attachments.find((a) => a.name === 'video');
          if (existing) {
            existing.path = effectiveVideoPath;
          } else {
            attachments.push({
              name: 'video',
              path: effectiveVideoPath,
              contentType: 'video/webm',
            });
          }
        }

        // Finalize evidence using recorder's finalizeEvidence
        const finalizedEvidence = await finalizeEvidence(testInfo, {
          reasoning: verdict.reasoning,
        });

        // Ensure videoPath is populated
        if (effectiveVideoPath && !finalizedEvidence.videoPath) {
          finalizedEvidence.videoPath = effectiveVideoPath;
        }

        verdict.evidence = finalizedEvidence;

        // Persist final verdict.json with finalized evidence
        const verdictJsonPath = path.join(scenarioOutputDir, 'verdict.json');
        fs.writeFileSync(verdictJsonPath, JSON.stringify(verdict, null, 2), 'utf-8');
      }

      verdicts.push(verdict);
      log(`  Result: [${verdict.result.toUpperCase()}]`);
      log(`  Evidence Video: ${verdict.evidence.videoPath || 'None'}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // STEP 3: Write additions to src/spec/capability-spec.additions.feature-agent.json
  const additionsFilePath = path.resolve(
    __dirname,
    '../spec/capability-spec.additions.feature-agent.json'
  );

  const newExpectations: CapabilityExpectation[] = plannedScenarios.map((s) => ({
    id: s.capabilityId,
    area: 'Dynamic Feature Verification',
    screen: 'cockpit-main',
    description: `${s.title}: ${s.verification}`,
    viewport: s.viewport,
    checkType: 'visual-judgment',
  }));

  let existingExpectations: CapabilityExpectation[] = [];
  if (fs.existsSync(additionsFilePath)) {
    try {
      const content = fs.readFileSync(additionsFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        existingExpectations = parsed;
      }
    } catch (e) {
      log(`Could not read existing additions file, overwriting: ${e}`);
    }
  }

  const combinedMap = new Map<string, CapabilityExpectation>();
  for (const item of existingExpectations) {
    combinedMap.set(item.id, item);
  }
  for (const item of newExpectations) {
    combinedMap.set(item.id, item);
  }

  const updatedExpectations = Array.from(combinedMap.values());
  fs.mkdirSync(path.dirname(additionsFilePath), { recursive: true });
  fs.writeFileSync(additionsFilePath, JSON.stringify(updatedExpectations, null, 2), 'utf-8');

  // STEP 4: Print Final Summary
  const total = verdicts.length;
  const passed = verdicts.filter((v) => v.result === 'pass').length;
  const failed = verdicts.filter((v) => v.result === 'fail').length;
  const inconclusive = verdicts.filter((v) => v.result === 'inconclusive').length;

  log('\n======================================================');
  log('🏁 AUTONOMOUS FEATURE TEST SUITE RUN COMPLETE');
  log('======================================================');
  log(`Total Planned Scenarios: ${total}`);
  log(`✅ Passed:        ${passed}`);
  log(`❌ Failed:        ${failed}`);
  log(`⚠️  Inconclusive:  ${inconclusive}`);
  log('------------------------------------------------------');

  verdicts.forEach((v, idx) => {
    const symbol = v.result === 'pass' ? '✅' : v.result === 'fail' ? '❌' : '⚠️';
    log(`\n${idx + 1}. ${symbol} [${v.result.toUpperCase()}] ${v.title}`);
    log(`   ID:           ${v.scenarioId}`);
    log(`   CapabilityID: ${v.capabilityId}`);
    log(`   Viewport:     ${v.viewport}`);
    log(`   Video:        ${v.evidence.videoPath || 'N/A'}`);
    log(`   Screenshots:  ${v.evidence.screenshotPaths?.length || 0} captured`);
    log(`   Reasoning:    ${v.reasoning.split('\n')[0]}`);
  });

  log('\n======================================================');
  log(`📁 Capability additions written to:`);
  log(`   ${additionsFilePath}`);
  log('======================================================\n');

  return verdicts;
}
