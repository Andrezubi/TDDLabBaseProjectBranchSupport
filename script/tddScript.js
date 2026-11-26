import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import process from 'node:process';
import { spawn } from 'cross-spawn';
import { configuredApiUrl, sendTestExecution } from './branchSupport.js';
import { projectRoot, testSnapshot } from './branchSupportGit.js';
import { getLastTestId } from './id_execution_tests_commit.js';

const statuses = {
  passed: 'passed',
  failed: 'failed',
  pending: 'skipped',
  skipped: 'skipped',
  todo: 'skipped',
  disabled: 'skipped',
};

function runJest(reportPath) {
  const args = [...process.argv.slice(2), '--json', `--outputFile=${reportPath}`];
  return new Promise((resolve) => {
    const child = spawn('jest', args, { cwd: projectRoot, stdio: 'inherit' });
    child.on('error', (error) => resolve({ code: 1, error: error.message }));
    child.on('close', (code, signal) => resolve({ code: code ?? 1, error: signal }));
  });
}

function resultsFromReport(report, runnerError) {
  if (!report) {
    return [{ test_name: 'Jest', status: 'error', error_message: runnerError || 'Jest no generó un reporte.' }];
  }
  return report.testResults.flatMap((suite) => {
    const file = relative(projectRoot, suite.name);
    if (!suite.assertionResults.length && suite.status === 'failed') {
      return [{
        test_name: file.slice(0, 500),
        file_path: file,
        status: 'error',
        error_message: suite.message || null,
      }];
    }
    return suite.assertionResults.map((test) => ({
      test_name: test.title.slice(0, 500),
      test_full_name: test.fullName,
      file_path: file,
      status: statuses[test.status] || 'error',
      duration_ms: test.duration ?? null,
      error_message: test.failureMessages?.join('\n') || null,
    }));
  });
}

function coverageFromReport(coverageMap) {
  if (!coverageMap) {
    return {};
  }
  let coveredLines = 0;
  let totalLines = 0;
  let coveredBranches = 0;
  let totalBranches = 0;

  for (const file of Object.values(coverageMap)) {
    const lines = new Map();
    for (const [id, statement] of Object.entries(file.statementMap)) {
      const line = statement.start.line;
      lines.set(line, Boolean(lines.get(line) || file.s[id]));
    }
    totalLines += lines.size;
    coveredLines += [...lines.values()].filter(Boolean).length;
    for (const counts of Object.values(file.b)) {
      totalBranches += counts.length;
      coveredBranches += counts.filter(Boolean).length;
    }
  }

  return {
    coverage: totalLines ? Math.round(10000 * coveredLines / totalLines) / 100 : null,
    covered_lines: coveredLines,
    total_lines: totalLines,
    covered_branches: coveredBranches,
    total_branches: totalBranches,
  };
}

function testExecution(report, run, startedAt, duration) {
  const results = resultsFromReport(report, run.error);
  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  const errors = results.length - passed - failed - skipped;
  return {
    source: process.env.CI === 'true' ? 'ci' : 'local',
    executed_at: new Date(report?.startTime ?? startedAt).toISOString(),
    duration_ms: duration,
    total_tests: results.length,
    passed_tests: passed,
    failed_tests: failed,
    skipped_tests: skipped,
    error_tests: errors,
    conclusion: errors ? 'error' : (run.code === 0 ? 'success' : 'failure'),
    results,
    ...coverageFromReport(report?.coverageMap),
  };
}

function appendLegacyLog(report) {
  const file = join(projectRoot, 'script', 'tdd_log.json');
  const testId = getLastTestId(file);
  const log = JSON.parse(readFileSync(file, 'utf8'));
  log.push({
    numPassedTests: report.numPassedTests,
    failedTests: report.numFailedTests,
    numTotalTests: report.numTotalTests,
    timestamp: report.startTime,
    success: report.success,
    testId,
  });
  writeFileSync(file, JSON.stringify(log, null, 2));
}

const apiUrl = configuredApiUrl();
const before = apiUrl ? testSnapshot() : null;
const startedAt = Date.now();
const directory = mkdtempSync(join(tmpdir(), 'tddlab-jest-'));
const reportPath = join(directory, 'report.json');

try {
  const run = await runJest(reportPath);
  process.exitCode = run.code;
  const duration = Date.now() - startedAt;
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (error) {
    globalThis.console.warn(`[TDDLab] No se pudo leer el reporte de Jest: ${error.code || error.name}.`);
  }
  if (apiUrl) {
    const execution = await sendTestExecution(apiUrl, before, testExecution(report, run, startedAt, duration));
    globalThis.console.log(`[TDDLab] Ejecución registrada: ${execution.id}.`);
  } else if (report) {
    appendLegacyLog(report);
  }
} catch (error) {
  globalThis.console.error(`[TDDLab] ${error.message}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
