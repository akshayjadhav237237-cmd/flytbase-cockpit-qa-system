import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CapabilityExpectation, ScenarioVerdict } from '../types';

/**
 * Returns directory of current file across ESM / CJS / tsx environments.
 */
function getDirname(): string {
  if (typeof __dirname !== 'undefined') {
    return __dirname;
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

/**
 * Type guard for ScenarioVerdict matching src/types.ts.
 */
export function isScenarioVerdict(data: unknown): data is ScenarioVerdict {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  return (
    typeof candidate.scenarioId === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.capabilityId === 'string' &&
    typeof candidate.result === 'string' &&
    ['pass', 'fail', 'inconclusive'].includes(candidate.result) &&
    typeof candidate.confidence === 'number' &&
    typeof candidate.reasoning === 'string'
  );
}

/**
 * Recursively scans runs/ for verdict JSON files matching the ScenarioVerdict shape.
 * Ignores attachment files to avoid duplicates.
 */
export function scanVerdicts(runsDir: string): ScenarioVerdict[] {
  if (!fs.existsSync(runsDir)) {
    return [];
  }

  const verdictFilePaths: string[] = [];

  function traverse(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip attachments directories, node_modules, and .git
        if (entry.name === 'attachments' || entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        traverse(fullPath);
      } else if (entry.isFile()) {
        // Target verdict files, avoiding attachments
        if (entry.name === 'verdict.json') {
          verdictFilePaths.push(fullPath);
        } else if (
          entry.name.endsWith('.json') &&
          !entry.name.startsWith('.') &&
          entry.name !== 'package.json' &&
          !fullPath.includes(`${path.sep}attachments${path.sep}`)
        ) {
          // If a verdict JSON file is named with suffix e.g. *-verdict.json
          if (entry.name.includes('verdict')) {
            verdictFilePaths.push(fullPath);
          }
        }
      }
    }
  }

  traverse(runsDir);

  // Deduplicate by scenarioId, keeping latest timestamp
  const verdictsByScenario = new Map<string, { verdict: ScenarioVerdict; mtime: number }>();

  for (const filePath of verdictFilePaths) {
    try {
      const rawContent = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(rawContent);
      if (isScenarioVerdict(parsed)) {
        const mtime = fs.statSync(filePath).mtimeMs;
        const existing = verdictsByScenario.get(parsed.scenarioId);
        if (!existing) {
          verdictsByScenario.set(parsed.scenarioId, { verdict: parsed, mtime });
        } else {
          const existingTime = new Date(existing.verdict.timestamp).getTime() || existing.mtime;
          const newTime = new Date(parsed.timestamp).getTime() || mtime;
          if (newTime >= existingTime) {
            verdictsByScenario.set(parsed.scenarioId, { verdict: parsed, mtime });
          }
        }
      }
    } catch (err) {
      console.warn(`[report/generate] Warning: Failed to parse verdict JSON at "${filePath}":`, err);
    }
  }

  return Array.from(verdictsByScenario.values()).map((entry) => entry.verdict);
}

/**
 * Loads capability expectations from src/spec/capability-spec.json.
 */
export function loadCapabilitySpecs(specPath: string): CapabilityExpectation[] {
  if (!fs.existsSync(specPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(specPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as CapabilityExpectation[];
    }
  } catch (err) {
    console.warn(`[report/generate] Warning: Failed to load capability spec from "${specPath}":`, err);
  }
  return [];
}

/**
 * Groups and sorts verdicts cleanly by capability area based on capability-spec.json.
 * Fail and inconclusive are partitioned into findings; pass verdicts into passed.
 */
export function groupAndSortVerdicts(
  verdicts: ScenarioVerdict[],
  specs: CapabilityExpectation[]
): {
  findings: ScenarioVerdict[];
  passed: ScenarioVerdict[];
} {
  const capabilityMap = new Map<string, CapabilityExpectation>();
  const specAreas: string[] = [];

  for (const spec of specs) {
    capabilityMap.set(spec.id, spec);
    if (!specAreas.includes(spec.area)) {
      specAreas.push(spec.area);
    }
  }

  const getArea = (capabilityId: string): string => {
    return capabilityMap.get(capabilityId)?.area || 'Other';
  };

  const getAreaRank = (area: string): number => {
    const idx = specAreas.indexOf(area);
    return idx === -1 ? 999 : idx;
  };

  const getCapabilityRank = (capabilityId: string): number => {
    const idx = specs.findIndex((s) => s.id === capabilityId);
    return idx === -1 ? 999 : idx;
  };

  const compareVerdicts = (a: ScenarioVerdict, b: ScenarioVerdict): number => {
    const areaA = getArea(a.capabilityId);
    const areaB = getArea(b.capabilityId);
    const areaRankDiff = getAreaRank(areaA) - getAreaRank(areaB);
    if (areaRankDiff !== 0) return areaRankDiff;

    const capRankDiff = getCapabilityRank(a.capabilityId) - getCapabilityRank(b.capabilityId);
    if (capRankDiff !== 0) return capRankDiff;

    return a.title.localeCompare(b.title);
  };

  const findings = verdicts
    .filter((v) => v.result === 'fail' || v.result === 'inconclusive')
    .sort(compareVerdicts);

  const passed = verdicts
    .filter((v) => v.result === 'pass')
    .sort(compareVerdicts);

  return { findings, passed };
}

/**
 * Formats findings and passed checks into SUBMISSION.md markdown.
 */
export function formatSubmissionMarkdown(findings: ScenarioVerdict[], passed: ScenarioVerdict[]): string {
  const findingsBlocks = findings.map((v, idx) => {
    const n = idx + 1;
    const title = v.title.trim();
    const description = v.description.trim();
    const approach = v.approach.trim();
    const videoPath = v.evidence?.videoPath ?? '';
    const result = v.result;
    const confidence = v.confidence;
    const reasoning = v.reasoning.trim();

    return (
      `### ${n}. ${title}\n` +
      `**Description:** ${description}\n` +
      `**Approach:** ${approach}\n` +
      `**Video:** [TODO: upload ${videoPath} and paste shareable link here]\n` +
      `**Result:** ${result} (confidence: ${confidence})\n` +
      `**Reasoning:** ${reasoning}`
    );
  });

  const alsoVerifiedLines = passed.map((v) => {
    return `- ${v.title.trim()} (${v.capabilityId.trim()})`;
  });

  const sections: string[] = [
    '# System Design',
    '[placeholder: "TODO: describe testing system architecture here"]',
    '',
    '# Scenarios',
    '',
    '## Findings',
  ];

  if (findingsBlocks.length > 0) {
    sections.push(findingsBlocks.join('\n\n'));
  }

  sections.push('');
  sections.push('## Also verified');

  if (alsoVerifiedLines.length > 0) {
    sections.push(alsoVerifiedLines.join('\n'));
  }

  return sections.join('\n') + '\n';
}

/**
 * Main report generation workflow.
 */
export function generateReport(options?: {
  runsDir?: string;
  specPath?: string;
  outputPath?: string;
}): {
  findingsCount: number;
  passedCount: number;
  outputPath: string;
} {
  const baseDir = getDirname();
  const runsDir = options?.runsDir || path.resolve(baseDir, '../../runs');
  const specPath = options?.specPath || path.resolve(baseDir, '../spec/capability-spec.json');
  const outputPath = options?.outputPath || path.resolve(runsDir, 'SUBMISSION.md');

  const verdicts = scanVerdicts(runsDir);
  const specs = loadCapabilitySpecs(specPath);
  const { findings, passed } = groupAndSortVerdicts(verdicts, specs);

  const markdown = formatSubmissionMarkdown(findings, passed);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown, 'utf-8');

  return {
    findingsCount: findings.length,
    passedCount: passed.length,
    outputPath,
  };
}

/**
 * CLI execution entrypoint
 */
export function main(): void {
  const result = generateReport();

  console.log('============================================================');
  console.log('FlytBase Cockpit QA System - Report Summary');
  console.log('============================================================');
  console.log(`Findings (failing/inconclusive): ${result.findingsCount}`);
  console.log(`Also verified (passing checks):   ${result.passedCount}`);
  console.log(`Total scenarios reported:        ${result.findingsCount + result.passedCount}`);
  console.log(`Submission report written to:    ${result.outputPath}`);
  console.log('============================================================');
  console.log(`Summary: ${result.findingsCount} findings vs. ${result.passedCount} passing checks.`);
}

// Automatically execute main when run directly
main();
