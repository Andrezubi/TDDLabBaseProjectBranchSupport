import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function git(args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

export function optionalGit(args) {
  try {
    return git(args) || null;
  } catch {
    return null;
  }
}

export function parseGitHubRemote(remote) {
  const sshRemote = remote.match(/^git@github\.com:(.+)$/i);
  const url = new URL(sshRemote ? `https://github.com/${sshRemote[1]}` : remote);
  const supportedHost = url.hostname === 'github.com' || url.hostname === 'ssh.github.com';
  const parts = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '').split('/');
  const [, owner, name] = parts;
  if (!supportedHost || parts.length !== 3 || !/^[\w-]+$/.test(owner || '') ||
      !/^[\w.-]+$/.test(name || '') || !['https:', 'http:', 'ssh:'].includes(url.protocol)) {
    throw new Error('El remoto origin debe apuntar a un repositorio de GitHub.');
  }
  return { github_user: owner, name, link: `https://github.com/${owner}/${name}` };
}

export function currentBranch() {
  return optionalGit(['symbolic-ref', '--quiet', '--short', 'HEAD']);
}

const sourcePaths = ['.', ':!script/tdd_log.json', ':!script/commit-history.json'];

export function testSnapshot() {
  let clean = false;
  try {
    clean = git(['status', '--porcelain=v1', '--untracked-files=normal', '--', ...sourcePaths]) === '';
  } catch {
    // No Git snapshot is available for this execution.
  }
  return {
    branch: currentBranch(),
    sha: optionalGit(['rev-parse', '--verify', 'HEAD']),
    clean,
  };
}

function commitStats(sha, firstParent) {
  const args = firstParent
    ? ['diff', '--no-ext-diff', '--numstat', '-z', '--find-renames', firstParent, sha]
    : ['diff-tree', '--root', '--no-commit-id', '--numstat', '-r', '-z', '--find-renames', sha];
  const records = git([...args, '--', ...sourcePaths]).split('\0');
  const stats = { additions: 0, deletions: 0, changed_files: 0 };

  for (let i = 0; i < records.length; i++) {
    const record = records[i].match(/^(\d+|-)\t(\d+|-)\t(.*)$/s);
    if (record) {
      const [, added, deleted, path] = record;
      stats.additions += Number(added) || 0;
      stats.deletions += Number(deleted) || 0;
      stats.changed_files++;
      // A rename has an empty path in the stats record, followed by two paths.
      if (!path) {
        i += 2;
      }
    }
  }
  return stats;
}

export function commitData(ref) {
  const format = '%H%x00%P%x00%an%x00%ae%x00%cI%x00%B';
  const [sha, parents, author, authorEmail, date, message] =
    git(['show', '--no-patch', `--format=${format}`, '--end-of-options', ref]).split('\0');
  const parentShas = parents ? parents.split(' ') : [];
  return {
    sha,
    author,
    author_email: authorEmail || null,
    message: message || '(sin mensaje)',
    committed_at: date,
    parent_shas: parentShas,
    ...commitStats(sha, parentShas[0]),
  };
}
