import fs from 'fs';
import path from 'path';
import { runFeatureAgentPipeline, type FeatureAgentPipelineOptions } from './runner';

export { runFeatureAgentPipeline, type FeatureAgentPipelineOptions };

/**
 * Parses the feature summary from CLI arguments or a file path.
 * Supports:
 *   npm run feature-test -- "text describing feature"
 *   npm run feature-test -- --file path/to/summary.txt
 */
function parseFeatureSummary(): string {
  const args = process.argv.slice(2);
  const fileFlagIndex = args.indexOf('--file');

  if (fileFlagIndex !== -1) {
    const filePath = args[fileFlagIndex + 1];
    if (!filePath) {
      console.error('Error: --file argument passed without a file path.');
      process.exit(1);
    }
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(resolvedPath)) {
      console.error(`Error: File not found at ${resolvedPath}`);
      process.exit(1);
    }
    return fs.readFileSync(resolvedPath, 'utf-8').trim();
  }

  // Filter out any flag arguments
  const textParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file') {
      i++; // skip next
      continue;
    }
    if (!arg.startsWith('--')) {
      textParts.push(arg);
    }
  }

  const combined = textParts.join(' ').trim();
  if (!combined) {
    console.error('Error: No feature summary provided.');
    console.error('Usage:');
    console.error('  npm run feature-test -- "Feature summary description"');
    console.error('  npm run feature-test -- --file path/to/summary.txt');
    process.exit(1);
  }

  return combined;
}

async function main() {
  const featureSummary = parseFeatureSummary();
  await runFeatureAgentPipeline(featureSummary);
}

// Only run automatically if executed directly via CLI
if (
  process.argv[1]?.endsWith('run.ts') ||
  process.argv[1]?.endsWith('run.js') ||
  process.argv[1]?.includes('feature-test-agent')
) {
  main().catch((err) => {
    console.error('[feature-test-agent] Fatal unhandled error:', err);
    process.exit(1);
  });
}
