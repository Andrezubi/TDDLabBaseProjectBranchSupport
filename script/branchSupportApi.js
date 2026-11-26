import { URL } from 'node:url';
import { parseGitHubRemote } from './branchSupportGit.js';

const prefix = '/api/branchSupport';

function baseUrl(value) {
  const url = new URL(value);
  const pathname = url.pathname.replace(/\/+$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || (pathname && pathname !== prefix)) {
    throw new Error('Usa una URL HTTP(S) del servidor de TDDLab o de /api/branchSupport.');
  }
  return url.origin + prefix;
}

function comparableLink(link) {
  try {
    return parseGitHubRemote(link).link.toLowerCase();
  } catch {
    return null;
  }
}

export function createBranchSupportApi(url) {
  const base = baseUrl(url);

  async function request(method, route, body) {
    const response = await globalThis.fetch(base + route, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      throw new Error(`La API respondió HTTP ${response.status} a ${method} ${route.split('?')[0]}.`);
    }
    return response.json();
  }

  async function findOrCreate(find, create) {
    const existing = await find();
    if (existing) {
      return existing;
    }
    try {
      return await create();
    } catch (error) {
      // Another client may have created the resource after the GET.
      const result = await find().catch(() => null);
      if (result) {
        return result;
      }
      throw error;
    }
  }

  return {
    ensureProject(project) {
      const link = comparableLink(project.link);
      const owner = project.github_user.toLowerCase();
      const find = async () => {
        for (const username of new Set([owner, project.github_user])) {
          const projects = await request('GET', `/projects?github_user=${encodeURIComponent(username)}`);
          const match = projects.find((item) => comparableLink(item.link) === link);
          if (match) {
            return match;
          }
        }
        return null;
      };
      return findOrCreate(find, () => request('POST', '/projects', { ...project, link, github_user: owner }));
    },
    ensureBranch(projectId, name, startingCommit) {
      const route = `/projects/${projectId}/branches`;
      return findOrCreate(
        async () => (await request('GET', route)).find((branch) => branch.name === name),
        async () => {
          const sha = startingCommit ? await startingCommit() : null;
          return request('POST', route, { name, head_commit_sha: sha, fork_commit_sha: sha });
        },
      );
    },
    commit(projectId, data) {
      return request('POST', `/projects/${projectId}/commits`, data);
    },
    execution(projectId, data) {
      return request('POST', `/projects/${projectId}/test-executions`, data);
    },
  };
}
