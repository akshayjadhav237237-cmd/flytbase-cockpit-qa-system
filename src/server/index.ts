import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { TEST_CASES, TestCase } from './test-cases';
import { runFeatureAgentPipeline } from '../feature-test-agent/runner';
import type { ScenarioVerdict } from '../types';

// Ensure .env is loaded
dotenv.config();

const PORT = Number(process.env.CONTROL_PANEL_PORT) || 4500;
const app = express();

// Enable JSON body parsing
app.use(express.json());

// Enable CORS for all incoming cross-origin requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// In-memory run state interface
export interface RunRecord {
  runId: string;
  testCaseId: string;
  status: 'running' | 'complete' | 'failed';
  logs: string[];
  scenarios: ScenarioVerdict[];
  listeners: Array<(log: string) => void>;
  onDoneListeners: Array<() => void>;
  startTime: number;
}

// In-memory run storage
const runs = new Map<string, RunRecord>();

/**
 * Appends a log line to a run, broadcasting to all active SSE subscribers.
 */
function addRunLog(run: RunRecord, line: string): void {
  const cleanLine = line.replace(/\r/g, '');
  run.logs.push(cleanLine);
  for (const listener of run.listeners) {
    try {
      listener(cleanLine);
    } catch {
      // Ignore errors on disconnected listeners
    }
  }
}

/**
 * Triggers completion on all done listeners for a run.
 */
function finishRun(run: RunRecord, finalStatus: 'complete' | 'failed'): void {
  run.status = finalStatus;
  for (const doneCb of run.onDoneListeners) {
    try {
      doneCb();
    } catch {
      // Ignore errors on completed listeners
    }
  }
  run.onDoneListeners = [];
  run.listeners = [];
}

/**
 * Recursively scans runsDir for verdict.json files created/modified after sinceTime.
 */
function findRecentVerdicts(runsDir: string, sinceTime: number): ScenarioVerdict[] {
  if (!fs.existsSync(runsDir)) {
    return [];
  }

  const verdictFiles: string[] = [];

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile() && entry.name === 'verdict.json') {
        verdictFiles.push(fullPath);
      }
    }
  }

  walk(runsDir);

  const matched: ScenarioVerdict[] = [];
  const seen = new Set<string>();

  for (const file of verdictFiles) {
    try {
      const stats = fs.statSync(file);
      if (stats.mtimeMs >= sinceTime) {
        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.scenarioId && parsed.result) {
          const key = `${parsed.scenarioId}-${parsed.viewport || 'desktop'}`;
          if (!seen.has(key)) {
            seen.add(key);
            matched.push(parsed as ScenarioVerdict);
          }
        }
      }
    } catch {
      // Skip invalid JSON
    }
  }

  return matched;
}

/**
 * Asynchronously executes a test case run (feature-summary or spec-file).
 */
async function executeRun(
  run: RunRecord,
  testCase: TestCase,
  customSummary?: string
): Promise<void> {
  const startTime = run.startTime;
  const qaRoot = path.resolve(__dirname, '../../');

  if (testCase.type === 'feature-summary') {
    const summary = customSummary || testCase.summary || testCase.description || testCase.title;
    addRunLog(run, `[FEATURE-AGENT] Initiating autonomous run for "${testCase.title}"`);
    addRunLog(run, `[FEATURE-AGENT] Feature summary: "${summary}"`);

    try {
      const scenarios = await runFeatureAgentPipeline(summary, {
        onLog: (line) => addRunLog(run, line),
      });

      run.scenarios = scenarios;
      addRunLog(
        run,
        `[FEATURE-AGENT] Run completed successfully with ${scenarios.length} scenario verdict(s).`
      );
      finishRun(run, 'complete');
    } catch (err: any) {
      addRunLog(run, `[FEATURE-AGENT ERROR] Pipeline failed: ${err.message || String(err)}`);
      run.scenarios = [
        {
          scenarioId: testCase.id,
          title: testCase.title,
          description: testCase.description || testCase.title,
          approach: 'Autonomous feature test pipeline with Midscene AI agent',
          capabilityId: testCase.id,
          viewport: 'desktop',
          result: 'fail',
          confidence: 0.9,
          checkType: 'visual-judgment',
          evidence: {
            videoPath: '',
            screenshotPaths: [],
          },
          reasoning: `Execution aborted due to fatal error: ${err.message || String(err)}`,
          timestamp: new Date().toISOString(),
        },
      ];
      finishRun(run, 'failed');
    }
    return;
  }

  // Spec-file test case: spawn Playwright child process
  const specFile = testCase.file || '';
  const grepPattern = testCase.grep || '';

  addRunLog(run, `[PLAYWRIGHT] Spawning test: ${specFile} --grep "${grepPattern}"`);

  // Wrap grep pattern in double quotes so cmd.exe preserves spaces on Windows
  const args = [
    'playwright',
    'test',
    specFile,
    '--grep',
    `"${grepPattern}"`,
    '--reporter=list',
  ];

  const child = spawn('npx', args, {
    cwd: qaRoot,
    shell: true,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  });

  const handleStreamData = (chunk: Buffer | string) => {
    const text = chunk.toString();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim().length > 0) {
        addRunLog(run, line);
      }
    }
  };

  child.stdout?.on('data', handleStreamData);
  child.stderr?.on('data', handleStreamData);

  child.on('error', (err) => {
    addRunLog(run, `[PLAYWRIGHT ERROR] Process spawn failure: ${err.message}`);
  });

  child.on('close', (exitCode) => {
    addRunLog(run, `[PLAYWRIGHT] Test process finished with exit code ${exitCode}`);

    try {
      const runsDir = path.resolve(qaRoot, 'runs');
      const foundVerdicts = findRecentVerdicts(runsDir, startTime - 3000);

      if (foundVerdicts.length > 0) {
        run.scenarios = foundVerdicts;
        addRunLog(run, `[PLAYWRIGHT] Collected ${foundVerdicts.length} scenario verdict(s).`);
      } else {
        addRunLog(run, `[PLAYWRIGHT] No verdict.json found in runs/; constructing scenario verdict from execution.`);
        const fallbackVerdict: ScenarioVerdict = {
          scenarioId: testCase.id,
          title: testCase.title,
          description: testCase.description || `Execution of ${specFile}`,
          approach: `Playwright CLI execution: npx playwright test ${specFile} --grep "${grepPattern}"`,
          capabilityId: testCase.id,
          viewport: 'desktop',
          result: exitCode === 0 ? 'pass' : 'fail',
          confidence: exitCode === 0 ? 0.95 : 0.8,
          checkType: 'fault-response',
          evidence: {
            videoPath: '',
            screenshotPaths: [],
          },
          reasoning:
            exitCode === 0
              ? `Playwright test passed with exit code 0.`
              : `Playwright test failed with exit code ${exitCode}. Check process logs for details.`,
          timestamp: new Date().toISOString(),
        };
        run.scenarios = [fallbackVerdict];
      }

      finishRun(run, exitCode === 0 ? 'complete' : 'complete');
    } catch (e: any) {
      addRunLog(run, `[PLAYWRIGHT ERROR] Verdict extraction error: ${e.message}`);
      finishRun(run, 'failed');
    }
  });
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

/**
 * 1. GET /api/test-cases
 * Returns list of available test cases (both feature-summary and spec-file)
 */
app.get('/api/test-cases', (_req: Request, res: Response) => {
  res.json(TEST_CASES);
});

/**
 * 2. POST /api/run/:testCaseId (and POST /api/run)
 * Starts an asynchronous run for the specified test case. Returns immediately with { runId }.
 */
const handleRunRequest = (req: Request, res: Response): void => {
  const rawId = req.params.testCaseId;
  const testCaseId = (Array.isArray(rawId) ? rawId[0] : rawId) || req.body?.testCaseId || req.body?.id;
  const customSummary = req.body?.summary || req.body?.featureSummary;

  let testCase = TEST_CASES.find((t) => t.id === testCaseId);

  // Allow ad-hoc custom feature summaries if not matching a registered ID
  if (!testCase && customSummary) {
    testCase = {
      id: testCaseId || `custom-${Date.now()}`,
      title: req.body?.title || 'Custom Feature Summary Test',
      type: 'feature-summary',
      summary: customSummary,
      description: customSummary,
    };
  }

  if (!testCase) {
    res.status(404).json({
      error: `Test case "${testCaseId}" not found. Available test cases can be queried at GET /api/test-cases`,
    });
    return;
  }

  const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const runRecord: RunRecord = {
    runId,
    testCaseId: testCase.id,
    status: 'running',
    logs: [],
    scenarios: [],
    listeners: [],
    onDoneListeners: [],
    startTime: Date.now(),
  };

  runs.set(runId, runRecord);

  // Initiate execution asynchronously
  executeRun(runRecord, testCase, customSummary).catch((err) => {
    addRunLog(runRecord, `[FATAL] Uncaught error during run execution: ${err.message || err}`);
    finishRun(runRecord, 'failed');
  });

  // Immediately respond with runId
  res.status(200).json({ runId });
};

app.post('/api/run/:testCaseId', handleRunRequest);
app.post('/api/run', handleRunRequest);

/**
 * 3. GET /api/run/:runId/stream
 * Server-Sent Events (SSE) streaming endpoint.
 * Immediately pushes all buffered logs, streams new logs in real-time,
 * and pushes 'event: done' before closing upon completion.
 */
app.get('/api/run/:runId/stream', (req: Request, res: Response): void => {
  const rawId = req.params.runId;
  const runId = Array.isArray(rawId) ? rawId[0] : rawId;
  const run = runs.get(runId);

  if (!run) {
    res.status(404).json({ error: `Run with ID "${runId}" not found` });
    return;
  }

  // Set standard SSE response headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const sendLogLine = (log: string) => {
    const lines = log.split(/\r?\n/);
    for (const l of lines) {
      res.write(`data: ${l}\n\n`);
    }
  };

  // 1. Immediately send all existing buffered logs
  for (const existingLog of run.logs) {
    sendLogLine(existingLog);
  }

  // 2. If the run is already finished, push done event and terminate stream
  if (run.status !== 'running') {
    res.write('event: done\ndata: complete\n\n');
    res.end();
    return;
  }

  // 3. Otherwise attach active listeners for streaming
  const logListener = (line: string) => {
    sendLogLine(line);
  };
  run.listeners.push(logListener);

  const doneListener = () => {
    res.write('event: done\ndata: complete\n\n');
    res.end();
  };
  run.onDoneListeners.push(doneListener);

  // Handle client disconnect gracefully
  req.on('close', () => {
    run.listeners = run.listeners.filter((l) => l !== logListener);
    run.onDoneListeners = run.onDoneListeners.filter((d) => d !== doneListener);
  });
});

/**
 * 4. GET /api/run/:runId/result
 * Returns execution state and scenario verdicts.
 * If running: { status: "running" }
 * If complete/failed: { status: "complete", scenarios: ScenarioVerdict[] }
 */
app.get('/api/run/:runId/result', (req: Request, res: Response): void => {
  const rawId = req.params.runId;
  const runId = Array.isArray(rawId) ? rawId[0] : rawId;
  const run = runs.get(runId);

  if (!run) {
    res.status(404).json({ error: `Run with ID "${runId}" not found` });
    return;
  }

  if (run.status === 'running') {
    res.json({ status: 'running' });
    return;
  }

  res.json({
    status: run.status,
    scenarios: run.scenarios,
  });
});

// -------------------------------------------------------------
// Static File Serving
// -------------------------------------------------------------

// Serve static frontend files from qa-system/src/server/public at /
const publicDir = path.resolve(__dirname, 'public');
app.use(express.static(publicDir));

// Serve test run artifacts (videos, screenshots, traces, verdicts) from qa-system/runs at /runs
const runsDir = path.resolve(__dirname, '../../runs');
app.use('/runs', express.static(runsDir));

// Fallback to index.html for Single Page Applications if client accesses routes
app.use((req: Request, res: Response, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/runs/')) {
    return next();
  }
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return next();
});

// Start Express HTTP server
export const server = app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 QA Control Panel Server listening on port ${PORT}`);
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/test-cases`);
  console.log(`   Artifacts: http://localhost:${PORT}/runs`);
  console.log(`======================================================\n`);
});

export default app;
