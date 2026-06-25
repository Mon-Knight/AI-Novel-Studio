import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const PROJECT_ROOT = process.argv[2] || 'f:/ai-novel-studio';
const SKILL_DIR = process.argv[3] || 'C:/Users/17735/.cline/skills/understand';

const batchesPath = join(PROJECT_ROOT, '.understand-anything', 'intermediate', 'batches.json');
const batchesData = JSON.parse(readFileSync(batchesPath, 'utf8'));
const batches = batchesData.batches;

console.log(`Processing ${batches.length} batches...`);

let totalFiles = 0;
let successBatches = 0;
let failedBatches = [];

for (const batch of batches) {
  const batchIdx = batch.batchIndex;
  const inputPath = join(PROJECT_ROOT, '.understand-anything', 'tmp', `ua-file-analyzer-input-${batchIdx}.json`);
  const outputPath = join(PROJECT_ROOT, '.understand-anything', 'tmp', `ua-file-extract-results-${batchIdx}.json`);

  // Skip if already processed
  if (existsSync(outputPath)) {
    try {
      const existing = JSON.parse(readFileSync(outputPath, 'utf8'));
      if (existing.scriptCompleted) {
        totalFiles += (existing.filesAnalyzed || batch.files.length);
        successBatches++;
        continue;
      }
    } catch(e) {}
  }

  // Write input - use batch.files (not batch.batchFiles)
  const input = {
    projectRoot: PROJECT_ROOT,
    batchFiles: batch.files,
    batchImportData: batch.batchImportData || {}
  };
  writeFileSync(inputPath, JSON.stringify(input));

  // Run extract-structure
  try {
    const cmd = `node "${join(SKILL_DIR, 'extract-structure.mjs')}" "${inputPath}" "${outputPath}"`;
    execSync(cmd, { stdio: 'pipe', timeout: 120000 });
    const result = JSON.parse(readFileSync(outputPath, 'utf8'));
    if (result.scriptCompleted) {
      totalFiles += (result.filesAnalyzed || batch.files.length);
      successBatches++;
    } else {
      failedBatches.push(batchIdx);
    }
  } catch(e) {
    console.error(`Batch ${batchIdx} failed: ${e.message.substring(0,200)}`);
    failedBatches.push(batchIdx);
  }
}

console.log(`Done. Processed ${successBatches}/${batches.length} batches (${totalFiles} files). Failed: ${failedBatches.join(',') || 'none'}`);