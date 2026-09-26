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
 * Escapes unsafe HTML characters to prevent XSS / broken layout.
 */
function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Type guard for ScenarioVerdict matching src/types.ts.
 */
function isScenarioVerdict(data: unknown): data is ScenarioVerdict {
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
 * Scans runs/ recursively for verdict JSON files matching ScenarioVerdict.
 * Reuses the proven scanning algorithm from generate.ts, deduplicating by
 * scenarioId and keeping the latest timestamp or file mtime.
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
        if (entry.name === 'attachments' || entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        traverse(fullPath);
      } else if (entry.isFile()) {
        if (entry.name === 'verdict.json') {
          verdictFilePaths.push(fullPath);
        } else if (
          entry.name.endsWith('.json') &&
          !entry.name.startsWith('.') &&
          entry.name !== 'package.json' &&
          !fullPath.includes(`${path.sep}attachments${path.sep}`)
        ) {
          if (entry.name.includes('verdict')) {
            verdictFilePaths.push(fullPath);
          }
        }
      }
    }
  }

  traverse(runsDir);

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
      console.warn(`[dashboard-generator] Warning: Failed to parse verdict at "${filePath}":`, err);
    }
  }

  return Array.from(verdictsByScenario.values()).map((entry) => entry.verdict);
}

/**
 * Loads capability expectations from capability-spec.json.
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
    console.warn(`[dashboard-generator] Warning: Failed to load spec from "${specPath}":`, err);
  }
  return [];
}

/**
 * Resolves category for each verdict.
 *
 * Reliability comment:
 * We primarily look up the registered `area` from `src/spec/capability-spec.json`,
 * ensuring 100% exact alignment with generate.ts and SUBMISSION.md.
 * If a verdict's capabilityId is not yet registered in the spec (e.g. ad-hoc feature runs),
 * we reliably infer the category from capabilityId prefix or scenario prefix:
 * - 'cockpit.freshness' -> 'Freshness & Degraded State'
 * - 'security' / 'sec-' -> 'Security and permissions'
 * - 'cockpit.geospatial' -> 'Map and geospatial'
 * - 'cockpit.video' -> 'Video Feed'
 * - 'cockpit.api-data' -> 'API and data'
 * - 'cockpit.performance' -> 'Performance & Load'
 * - 'ux-agent' -> 'Autonomous UX Agent'
 * - 'feature-agent' -> 'Map 2D/3D & Features'
 * - default -> 'General Quality'
 */
function resolveCategory(v: ScenarioVerdict, specMap: Map<string, string>): string {
  const registeredArea = specMap.get(v.capabilityId);
  if (registeredArea && registeredArea !== 'Other') {
    return registeredArea;
  }

  const id = (v.capabilityId || v.scenarioId || '').toLowerCase();
  if (id.includes('freshness')) return 'Freshness & Degraded State';
  if (id.includes('sec-') || id.includes('security')) return 'Security and permissions';
  if (id.includes('geospatial')) return 'Map and geospatial';
  if (id.includes('video')) return 'Video Feed';
  if (id.includes('api-data')) return 'API and data';
  if (id.includes('perf') || id.includes('load')) return 'Performance & Load';
  if (id.includes('ux-agent') || id.includes('takeoff') || id.includes('flight')) return 'Flight Operations';
  if (id.includes('feature-agent')) return 'Map 2D/3D & Features';
  if (id.includes('responsive') || id.includes('mobile')) return 'Mobile Responsiveness';
  if (id.includes('visual')) return 'Visual UI Completeness';
  if (id.includes('semantic') || id.includes('element')) return 'Semantic Element Identification';

  return registeredArea || 'General Quality';
}

/**
 * Resolves the relative path from dashboard.html (in runs/) to the video file,
 * verifying that the file actually exists on disk.
 */
function resolveVideoRelativePath(videoPath: string | undefined, runsDir: string): string | null {
  if (!videoPath) return null;

  // Check direct path
  if (fs.existsSync(videoPath)) {
    const rel = path.relative(runsDir, videoPath).replace(/\\/g, '/');
    return rel;
  }

  // Check alternative candidate paths within runsDir
  const fileName = path.basename(videoPath);
  const parentFolder = path.basename(path.dirname(videoPath));
  const candidateDirs = ['desktop', 'mobile', 'archive', 'functional-honesty', 'feature-agent'];

  for (const c of candidateDirs) {
    const p1 = path.join(runsDir, c, parentFolder, fileName);
    if (fs.existsSync(p1)) {
      return path.relative(runsDir, p1).replace(/\\/g, '/');
    }
  }

  return null;
}

/**
 * Builds the complete, standalone dashboard HTML page.
 */
export function buildDashboardHtml(
  verdicts: ScenarioVerdict[],
  specs: CapabilityExpectation[],
  runsDir: string
): string {
  const specMap = new Map<string, string>();
  for (const s of specs) {
    specMap.set(s.id, s.area);
  }

  // Enrich verdicts with resolved category and existing video path
  const enriched = verdicts.map((v) => {
    const category = resolveCategory(v, specMap);
    const videoRelPath = resolveVideoRelativePath(v.evidence?.videoPath, runsDir);
    const isFinding = v.result === 'fail' || v.result === 'inconclusive';
    return {
      verdict: v,
      category,
      videoRelPath,
      isFinding,
    };
  });

  // Sort: Group by category, then findings first, then passes, then title
  enriched.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    // Findings first within category
    if (a.isFinding && !b.isFinding) return -1;
    if (!a.isFinding && b.isFinding) return 1;
    return a.verdict.title.localeCompare(b.verdict.title);
  });

  // Calculate summary metrics
  const totalScenarios = enriched.length;
  const findingsCount = enriched.filter((e) => e.isFinding).length;
  const passesCount = enriched.filter((e) => !e.isFinding).length;
  const passRate = totalScenarios > 0 ? ((passesCount / totalScenarios) * 100).toFixed(1) : '0';

  // Category breakdown
  const categoryStats = new Map<string, { total: number; findings: number; passes: number }>();
  for (const e of enriched) {
    const stat = categoryStats.get(e.category) || { total: 0, findings: 0, passes: 0 };
    stat.total++;
    if (e.isFinding) stat.findings++;
    else stat.passes++;
    categoryStats.set(e.category, stat);
  }

  const categoryList = Array.from(categoryStats.keys()).sort();

  // Render Category Filter Buttons
  const categoryButtonsHtml = categoryList
    .map((cat) => {
      const stat = categoryStats.get(cat)!;
      return `<button class="filter-pill category-filter" data-category="${escapeHtml(cat)}">${escapeHtml(cat)} <span class="pill-count">${stat.total}</span></button>`;
    })
    .join('');

  // Render Summary Category Breakdown Chips
  const categoryBreakdownChipsHtml = categoryList
    .map((cat) => {
      const stat = categoryStats.get(cat)!;
      return `<div class="category-chip"><span class="chip-name">${escapeHtml(cat)}</span><span class="chip-badge ${stat.findings > 0 ? 'chip-has-findings' : 'chip-all-pass'}">${stat.findings > 0 ? `${stat.findings} findings / ${stat.total}` : `${stat.total} pass`}</span></div>`;
    })
    .join('');

  // Render Scenario Cards
  const cardsHtml = enriched
    .map((item, idx) => {
      const v = item.verdict;
      const isFinding = item.isFinding;
      const statusClass = isFinding ? 'finding' : 'verified';
      const statusLabel = isFinding ? 'FINDING' : 'VERIFIED';
      const confidencePercent = Math.round((v.confidence || 0.95) * 100);

      const videoElement = item.videoRelPath
        ? `<div class="video-container">
             <video controls preload="metadata" class="scenario-video" src="${escapeHtml(item.videoRelPath)}"></video>
           </div>`
        : `<div class="video-placeholder">
             <div class="placeholder-icon">🎥</div>
             <div class="placeholder-text">Video not available</div>
           </div>`;

      return `
      <article class="scenario-card" data-category="${escapeHtml(item.category)}" data-result="${escapeHtml(v.result)}" data-status="${statusClass}">
        <div class="card-header">
          <div class="card-tags">
            <span class="category-tag">${escapeHtml(item.category)}</span>
            <span class="viewport-tag">${escapeHtml(v.viewport || 'desktop')}</span>
          </div>
          <span class="status-badge badge-${statusClass}">${statusLabel}</span>
        </div>

        <h3 class="card-title">${escapeHtml(v.title)}</h3>

        <div class="card-meta">
          <span class="meta-item"><span class="meta-label">ID:</span> <code>${escapeHtml(v.scenarioId)}</code></span>
          <span class="meta-item"><span class="meta-label">Check:</span> ${escapeHtml(v.checkType || 'presence')}</span>
          <span class="meta-item"><span class="meta-label">Confidence:</span> ${confidencePercent}%</span>
        </div>

        ${videoElement}

        <div class="card-content">
          <div class="content-block">
            <span class="content-heading">Description</span>
            <p class="content-text">${escapeHtml(v.description)}</p>
          </div>

          <div class="content-block">
            <span class="content-heading">Approach</span>
            <p class="content-text">${escapeHtml(v.approach)}</p>
          </div>

          <div class="reasoning-wrapper">
            <button type="button" class="reasoning-toggle-btn" onclick="toggleReasoning(this)">
              <span class="toggle-text">View Detailed Reasoning & Evidence</span>
              <svg class="toggle-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <div class="reasoning-body" style="display: none;">
              <pre class="reasoning-pre">${escapeHtml(v.reasoning)}</pre>
            </div>
          </div>
        </div>
      </article>
      `;
    })
    .join('\n');

  const generatedTime = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FlytBase Cockpit — QA Testing System Dashboard</title>
  <style>
    /* ==========================================================================
       Dark-mode Single Theme Typography and Variables
       ========================================================================== */
    :root {
      --bg-base: #0a0d14;
      --bg-surface: #121824;
      --bg-card: #182030;
      --bg-card-hover: #1e283d;
      --border-subtle: #243047;
      --border-strong: #334360;

      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --text-dim: #64748b;

      --finding-red: #ef4444;
      --finding-red-glow: rgba(239, 68, 68, 0.25);
      --finding-bg: rgba(239, 68, 68, 0.12);
      --finding-border: rgba(239, 68, 68, 0.45);

      --verified-green: #10b981;
      --verified-green-glow: rgba(16, 185, 129, 0.25);
      --verified-bg: rgba(16, 185, 129, 0.12);
      --verified-border: rgba(16, 185, 129, 0.45);

      --accent-blue: #38bdf8;
      --accent-blue-bg: rgba(56, 189, 248, 0.12);

      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 14px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-base);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding: 24px;
      min-height: 100vh;
    }

    /* Container */
    .dashboard-container {
      max-width: 1560px;
      margin: 0 auto;
    }

    /* Header */
    .header-banner {
      background: linear-gradient(135deg, #161f30 0%, #101622 100%);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 28px 32px;
      margin-bottom: 24px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    }

    .header-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 8px;
    }

    .main-title {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .main-title-badge {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 4px 10px;
      border-radius: 9999px;
      background: var(--accent-blue-bg);
      color: var(--accent-blue);
      border: 1px solid rgba(56, 189, 248, 0.3);
    }

    .header-subtitle {
      color: var(--text-muted);
      font-size: 14px;
      margin-bottom: 24px;
    }

    .timestamp-badge {
      font-size: 12px;
      color: var(--text-dim);
    }

    /* Summary Metrics Strip */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }

    .metric-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .metric-card.finding {
      border-color: var(--finding-border);
      background: linear-gradient(180deg, var(--finding-bg) 0%, var(--bg-surface) 100%);
    }

    .metric-card.verified {
      border-color: var(--verified-border);
      background: linear-gradient(180deg, var(--verified-bg) 0%, var(--bg-surface) 100%);
    }

    .metric-number {
      font-size: 32px;
      font-weight: 800;
      line-height: 1;
    }

    .metric-number.finding { color: var(--finding-red); }
    .metric-number.verified { color: var(--verified-green); }
    .metric-number.total { color: #ffffff; }
    .metric-number.rate { color: var(--accent-blue); }

    .metric-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    /* Category Breakdown Strip */
    .category-breakdown-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--border-subtle);
    }

    .category-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 6px 12px;
      font-size: 12px;
    }

    .chip-name {
      color: var(--text-muted);
      font-weight: 500;
    }

    .chip-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .chip-has-findings {
      background: var(--finding-bg);
      color: var(--finding-red);
      border: 1px solid var(--finding-border);
    }

    .chip-all-pass {
      background: var(--verified-bg);
      color: var(--verified-green);
      border: 1px solid var(--verified-border);
    }

    /* Controls & Filter Bar */
    .controls-panel {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 20px;
      margin-bottom: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .search-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .search-input {
      flex: 1;
      min-width: 260px;
      background: var(--bg-base);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 10px 14px;
      color: var(--text-main);
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s ease;
    }

    .search-input:focus {
      border-color: var(--accent-blue);
    }

    .filter-group-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .filter-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-right: 6px;
      min-width: 80px;
    }

    .filter-pill {
      background: var(--bg-base);
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
      border-radius: 9999px;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }

    .filter-pill:hover {
      border-color: var(--border-strong);
      color: var(--text-main);
      background: #162030;
    }

    .filter-pill.active {
      background: #2563eb;
      border-color: #3b82f6;
      color: #ffffff;
      font-weight: 600;
      box-shadow: 0 0 12px rgba(37, 99, 235, 0.4);
    }

    .filter-pill.active-finding {
      background: #dc2626;
      border-color: #ef4444;
      color: #ffffff;
      font-weight: 600;
      box-shadow: 0 0 12px rgba(220, 38, 38, 0.4);
    }

    .filter-pill.active-verified {
      background: #059669;
      border-color: #10b981;
      color: #ffffff;
      font-weight: 600;
      box-shadow: 0 0 12px rgba(5, 150, 105, 0.4);
    }

    .pill-count {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.15);
      color: inherit;
    }

    .results-count-bar {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 16px;
      padding-left: 4px;
    }

    /* Scenario Cards Grid */
    .scenario-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 20px;
    }

    .scenario-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .scenario-card:hover {
      transform: translateY(-2px);
      border-color: var(--border-strong);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }

    .scenario-card[data-status="finding"] {
      border-left: 4px solid var(--finding-red);
    }

    .scenario-card[data-status="verified"] {
      border-left: 4px solid var(--verified-green);
    }

    .card-header {
      padding: 16px 20px 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .card-tags {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .category-tag {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--accent-blue);
      background: var(--accent-blue-bg);
      padding: 3px 8px;
      border-radius: 4px;
    }

    .viewport-tag {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-dim);
      background: rgba(255, 255, 255, 0.05);
      padding: 3px 8px;
      border-radius: 4px;
    }

    /* Prominent Status Badges (Visible from a distance) */
    .status-badge {
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 5px 12px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .badge-finding {
      background: var(--finding-red);
      color: #ffffff;
      box-shadow: 0 0 14px var(--finding-red-glow);
    }

    .badge-verified {
      background: var(--verified-green);
      color: #ffffff;
      box-shadow: 0 0 14px var(--verified-green-glow);
    }

    .card-title {
      padding: 0 20px;
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.35;
      margin-bottom: 8px;
    }

    .card-meta {
      padding: 0 20px 12px 20px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 12px;
      color: var(--text-dim);
    }

    .meta-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .meta-label {
      font-weight: 600;
      color: var(--text-muted);
    }

    .card-meta code {
      background: rgba(0, 0, 0, 0.3);
      padding: 1px 5px;
      border-radius: 3px;
      font-family: monospace;
      color: #e2e8f0;
    }

    /* Video Player & Placeholder */
    .video-container {
      width: 100%;
      background: #000000;
      border-top: 1px solid var(--border-subtle);
      border-bottom: 1px solid var(--border-subtle);
      aspect-ratio: 16 / 9;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .scenario-video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000000;
    }

    .video-placeholder {
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #0f141d;
      border-top: 1px solid var(--border-subtle);
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      color: var(--text-dim);
    }

    .placeholder-icon {
      font-size: 24px;
    }

    .placeholder-text {
      font-size: 13px;
      font-weight: 500;
    }

    /* Card Content & Details */
    .card-content {
      padding: 16px 20px 20px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      flex: 1;
    }

    .content-block {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .content-heading {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
    }

    .content-text {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.45;
    }

    /* Reasoning Collapsible */
    .reasoning-wrapper {
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }

    .reasoning-toggle-btn {
      width: 100%;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 8px 12px;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: background 0.15s ease, color 0.15s ease;
    }

    .reasoning-toggle-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #ffffff;
    }

    .toggle-arrow {
      transition: transform 0.2s ease;
    }

    .reasoning-toggle-btn.expanded .toggle-arrow {
      transform: rotate(180deg);
    }

    .reasoning-body {
      margin-top: 10px;
    }

    .reasoning-pre {
      background: #0a0e17;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11.5px;
      line-height: 1.5;
      color: #cbd5e1;
      max-height: 240px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* Empty state */
    .empty-state {
      grid-column: 1 / -1;
      text-align: center;
      padding: 60px 20px;
      background: var(--bg-surface);
      border: 1px dashed var(--border-subtle);
      border-radius: var(--radius-md);
      color: var(--text-dim);
    }

    @media (max-width: 768px) {
      body { padding: 16px; }
      .header-banner { padding: 20px; }
      .scenario-grid { grid-template-columns: 1fr; }
      .main-title { font-size: 20px; }
    }
  </style>
</head>
<body>
  <div class="dashboard-container">
    <!-- Header Banner -->
    <header class="header-banner">
      <div class="header-title-row">
        <h1 class="main-title">
          FlytBase Cockpit — QA Testing System
          <span class="main-title-badge">Judge Dashboard</span>
        </h1>
        <div class="timestamp-badge">Updated: ${escapeHtml(generatedTime)}</div>
      </div>
      <p class="header-subtitle">
        Automated UI/UX, Semantic AI, Fault Injection &amp; Security Test Results • Single-file Interactive Companion
      </p>

      <!-- Live Summary Metrics Strip -->
      <div class="metrics-grid">
        <div class="metric-card">
          <span class="metric-number total">${totalScenarios}</span>
          <span class="metric-label">Total Scenarios</span>
        </div>
        <div class="metric-card finding">
          <span class="metric-number finding">${findingsCount}</span>
          <span class="metric-label">Findings (Degraded / Flaws)</span>
        </div>
        <div class="metric-card verified">
          <span class="metric-number verified">${passesCount}</span>
          <span class="metric-label">Verified Passing</span>
        </div>
        <div class="metric-card">
          <span class="metric-number rate">${passRate}%</span>
          <span class="metric-label">Pass Rate</span>
        </div>
      </div>

      <!-- Category Breakdown Strip -->
      <div class="category-breakdown-strip">
        ${categoryBreakdownChipsHtml}
      </div>
    </header>

    <!-- Filter & Search Controls -->
    <section class="controls-panel">
      <div class="search-row">
        <input type="text" id="searchInput" class="search-input" placeholder="Search by title, description, capability ID, or scenario..." oninput="handleFilterChange()" />
      </div>

      <!-- Status Filters -->
      <div class="filter-group-row">
        <span class="filter-label">Status:</span>
        <button class="filter-pill status-filter active" data-status="all" onclick="setStatusFilter('all', this)">All <span class="pill-count">${totalScenarios}</span></button>
        <button class="filter-pill status-filter" data-status="finding" onclick="setStatusFilter('finding', this)">Findings Only <span class="pill-count">${findingsCount}</span></button>
        <button class="filter-pill status-filter" data-status="verified" onclick="setStatusFilter('verified', this)">Passes Only <span class="pill-count">${passesCount}</span></button>
      </div>

      <!-- Category Filters -->
      <div class="filter-group-row">
        <span class="filter-label">Category:</span>
        <button class="filter-pill category-filter active" data-category="all" onclick="setCategoryFilter('all', this)">All Categories</button>
        ${categoryButtonsHtml}
      </div>
    </section>

    <!-- Results Count Bar -->
    <div class="results-count-bar">
      Showing <strong id="visibleCount">${totalScenarios}</strong> of ${totalScenarios} scenarios
    </div>

    <!-- Responsive Cards Grid -->
    <main class="scenario-grid" id="scenarioGrid">
      ${cardsHtml}
      <div id="emptyState" class="empty-state" style="display: none;">
        <h3>No matching scenarios found</h3>
        <p>Try resetting the search or category filters.</p>
      </div>
    </main>
  </div>

  <!-- Interactive Filtering & Toggle Logic -->
  <script>
    let activeStatus = 'all';
    let activeCategory = 'all';

    function setStatusFilter(status, el) {
      activeStatus = status;
      document.querySelectorAll('.status-filter').forEach(btn => {
        btn.classList.remove('active', 'active-finding', 'active-verified');
      });
      if (status === 'finding') {
        el.classList.add('active-finding');
      } else if (status === 'verified') {
        el.classList.add('active-verified');
      } else {
        el.classList.add('active');
      }
      applyFilters();
    }

    function setCategoryFilter(category, el) {
      activeCategory = category;
      document.querySelectorAll('.category-filter').forEach(btn => btn.classList.remove('active'));
      el.classList.add('active');
      applyFilters();
    }

    // Attach click handlers to rendered category pills
    document.querySelectorAll('.category-filter').forEach(btn => {
      btn.addEventListener('click', function() {
        setCategoryFilter(this.getAttribute('data-category'), this);
      });
    });

    function handleFilterChange() {
      applyFilters();
    }

    function applyFilters() {
      const search = (document.getElementById('searchInput').value || '').toLowerCase().trim();
      const cards = document.querySelectorAll('.scenario-card');
      let visible = 0;

      cards.forEach(card => {
        const cardStatus = card.getAttribute('data-status');
        const cardCategory = card.getAttribute('data-category');
        const cardText = card.textContent.toLowerCase();

        const matchesStatus = (activeStatus === 'all') || (cardStatus === activeStatus);
        const matchesCategory = (activeCategory === 'all') || (cardCategory === activeCategory);
        const matchesSearch = !search || cardText.includes(search);

        if (matchesStatus && matchesCategory && matchesSearch) {
          card.style.display = 'flex';
          visible++;
        } else {
          card.style.display = 'none';
        }
      });

      document.getElementById('visibleCount').textContent = visible;
      document.getElementById('emptyState').style.display = visible === 0 ? 'block' : 'none';
    }

    function toggleReasoning(btn) {
      const wrapper = btn.closest('.reasoning-wrapper');
      const body = wrapper.querySelector('.reasoning-body');
      const textSpan = btn.querySelector('.toggle-text');
      const isHidden = body.style.display === 'none';

      if (isHidden) {
        body.style.display = 'block';
        btn.classList.add('expanded');
        textSpan.textContent = 'Hide Detailed Reasoning';
      } else {
        body.style.display = 'none';
        btn.classList.remove('expanded');
        textSpan.textContent = 'View Detailed Reasoning & Evidence';
      }
    }
  </script>
</body>
</html>
`;
}

/**
 * Main dashboard generator entrypoint.
 */
export function generateDashboard(options?: {
  runsDir?: string;
  specPath?: string;
  outputPath?: string;
}): {
  scenariosCount: number;
  outputPath: string;
  fileSizeBytes: number;
} {
  const baseDir = getDirname();
  const runsDir = options?.runsDir || path.resolve(baseDir, '../../runs');
  const specPath = options?.specPath || path.resolve(baseDir, '../spec/capability-spec.json');
  const outputPath = options?.outputPath || path.resolve(runsDir, 'dashboard.html');

  const verdicts = scanVerdicts(runsDir);
  const specs = loadCapabilitySpecs(specPath);

  const htmlContent = buildDashboardHtml(verdicts, specs, runsDir);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, htmlContent, 'utf-8');

  const fileSizeBytes = fs.statSync(outputPath).size;

  return {
    scenariosCount: verdicts.length,
    outputPath,
    fileSizeBytes,
  };
}

/**
 * CLI execution when run directly via tsx
 */
export function main(): void {
  const result = generateDashboard();

  console.log('============================================================');
  console.log('FlytBase Cockpit QA System - Dashboard Generator');
  console.log('============================================================');
  console.log(`Scenarios compiled:    ${result.scenariosCount}`);
  console.log(`Dashboard generated:   ${result.outputPath}`);
  console.log(`File size:             ${(result.fileSizeBytes / 1024).toFixed(2)} KB`);
  console.log('============================================================');
  console.log('Open dashboard.html directly in any browser (no server needed).');
}

// Execute main if run as script
main();
