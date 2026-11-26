import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createBranchSupportApi } from './branchSupportApi.js';
import { commitData, currentBranch, optionalGit, parseGitHubRemote, projectRoot, testSnapshot } from './branchSupportGit.js';

export function configuredApiUrl() {
  return process.env.TDDLAB_API_URL?.trim() || optionalGit(['config', '--local', '--get', 'tddlab.apiUrl']);
}

function readProject() {
  const remote = optionalGit(['config', '--local', '--get', 'remote.origin.url']);
  if (!remote) {
    throw new Error('Configura el remoto origin de GitHub para registrar el proyecto.');
  }
  return parseGitHubRemote(remote);
}

async function writeCommit(api, projectId, sha, branch, branchId) {
  const tip = branch && optionalGit(['rev-parse', '--verify', `refs/heads/${branch}`]);
  return api.commit(projectId, {
    ...commitData(sha),
    branch_id: branchId,
    update_branch_head: sha === tip,
  });
}

export async function sendTestExecution(apiUrl, before, execution) {
  const after = testSnapshot();
  // A run with source changes is evidence for a branch without a committed SHA.
  const sha = before.clean && after.clean && before.branch === after.branch && before.sha === after.sha
    ? before.sha
    : null;
  const event = { branch: before.branch, commit_sha: sha, execution };
  try {
    event.project = readProject();
    const api = createBranchSupportApi(apiUrl);
    const project = await api.ensureProject(event.project);
    const branch = before.branch ? await api.ensureBranch(project.id, before.branch) : null;
    if (sha) {
      await writeCommit(api, project.id, sha, before.branch, branch?.id);
    }
    return await api.execution(project.id, { ...execution, branch_id: branch?.id, commit_sha: sha });
  } catch (error) {
    // A timed-out POST may have succeeded. Preserve the report without replaying it blindly.
    const directory = optionalGit(['rev-parse', '--path-format=absolute', '--git-path', 'tddlab/unsent-tests']);
    if (directory) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const file = join(directory, `${randomUUID()}.json`);
      writeFileSync(file, JSON.stringify(event, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      throw new Error(`${error.message} Reporte guardado en ${file}.`, { cause: error });
    }
    throw error;
  }
}

function installBranchHook() {
  if (process.env.HUSKY === '0' ||
      optionalGit(['config', '--local', '--get', 'core.hooksPath']) !== '.husky/_') {
    return;
  }
  // Husky 9 generates standard hooks but omits reference-transaction.
  const hooks = join(projectRoot, '.husky', '_');
  const target = join(hooks, 'reference-transaction');
  copyFileSync(join(hooks, 'post-commit'), target);
  chmodSync(target, 0o755);
}

async function run([operation = 'project', name, startingSha]) {
  if (!['install', 'project', 'branch', 'commit'].includes(operation)) {
    throw new Error('Usa project, branch o commit.');
  }
  if (operation === 'install') {
    installBranchHook();
  }
  const url = configuredApiUrl();
  if (!url) {
    if (operation === 'project') {
      throw new Error('Configura tddlab.apiUrl o TDDLAB_API_URL.');
    }
    return;
  }
  if (operation === 'install' && !optionalGit(['config', '--local', '--get', 'remote.origin.url'])) {
    return;
  }
  const api = createBranchSupportApi(url);
  const data = readProject();
  const project = await api.ensureProject(data);

  if (operation === 'branch') {
    const nameToRegister = name || currentBranch();
    if (!nameToRegister) {
      throw new Error('Indica una rama local para registrar.');
    }
    const fork = startingSha && nameToRegister !== currentBranch()
      ? async () => (await api.commit(project.id, commitData(startingSha))).sha
      : null;
    const branch = await api.ensureBranch(project.id, nameToRegister, fork);
    globalThis.console.log(`[TDDLab] Rama registrada: ${branch.name}.`);
  } else if (operation === 'commit') {
    const sha = optionalGit(['rev-parse', '--verify', '--end-of-options', name || 'HEAD']);
    if (!sha) {
      throw new Error('No se encontró el commit para registrar.');
    }
    const nameOfBranch = currentBranch();
    const branch = nameOfBranch ? await api.ensureBranch(project.id, nameOfBranch) : null;
    await writeCommit(api, project.id, sha, nameOfBranch, branch?.id);
    globalThis.console.log(`[TDDLab] Commit registrado: ${sha.slice(0, 8)}.`);
  } else {
    globalThis.console.log(`[TDDLab] Proyecto registrado: ${project.name}.`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  await run(args).catch((error) => {
    globalThis.console.error(`[TDDLab] ${error.message}`);
    if (args[0] !== 'install') {
      process.exitCode = 1;
    }
  });
}
