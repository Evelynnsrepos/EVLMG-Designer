/**
 * GitHub for Git saving (0.20): one repository per project, made by the app.
 *
 * There is no separate login: the app asks the computer's own git for the GitHub login it already
 * uses to push (GitHub CLI's "gh auth login" on Linux and Mac, Git for Windows' sign-in window on
 * Windows). The token is only kept in memory and only sent to api.github.com.
 */

export interface GitHubRepo {
  name: string
  cloneUrl: string
  updatedAt: string
}

/** Asks git for the GitHub login (`git credential fill`); '' when there is none. */
export type CredentialAsker = () => Promise<string>

/** Every project repository's name starts with this, so "Import from GitHub" can list them. */
export const REPO_PREFIX = 'egd-'

/** "My Game: Part 2" -> "egd-my-game-part-2". GitHub allows letters, digits, '.', '-' and '_'. */
export function repoNameFor(projectName: string): string {
  const slug = projectName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 90)
  return REPO_PREFIX + (slug || 'project')
}

let askCredential: CredentialAsker = async () => ''
/** Set by gitsync.ts (it owns the git runner); tests swap in their own. */
export const setCredentialAsker = (next: CredentialAsker) => void (askCredential = next)

let token = ''
let apiFetch: typeof fetch = (...args) => fetch(...args)
/** For tests: answer GitHub API calls some other way. */
export const setGitHubFetch = (next: typeof fetch) => void ((apiFetch = next), (token = ''))

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  token ||= await askCredential()
  if (!token) throw new Error('Git is not logged in to GitHub on this computer yet. Follow step 3 of the setup, then try again.')
  const r = await apiFetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (r.status === 401) token = ''
  if (!r.ok) throw Object.assign(new Error(`GitHub said ${r.status}: ${((await r.json().catch(() => ({}))) as { message?: string }).message ?? r.statusText}`), { status: r.status })
  return (await r.json()) as T
}

/** The GitHub user name the computer's git is logged in as. */
export async function gitHubLogin(): Promise<string> {
  return (await api<{ login: string }>('/user')).login
}

const PUBLIC = 'That GitHub repository is public, so anyone could read this project. Git saving only uses private repositories: make it private on GitHub (Settings, Danger Zone, Change visibility) and try again.'

/** A private repository for a project; an existing private one with that name is used as it is (e.g. made on another computer). */
export async function createProjectRepo(projectName: string): Promise<GitHubRepo> {
  const name = repoNameFor(projectName)
  type Raw = { name: string; clone_url: string; updated_at: string; private: boolean }
  const shape = (r: Raw): GitHubRepo => ({ name: r.name, cloneUrl: r.clone_url, updatedAt: r.updated_at })
  try {
    return shape(await api<Raw>('/user/repos', { method: 'POST', body: JSON.stringify({ name, private: true, description: `Evelopment Games Designer project: ${projectName}` }) }))
  } catch (e) {
    if ((e as { status?: number }).status !== 422) throw e
    const existing = await api<Raw>(`/repos/${await gitHubLogin()}/${name}`)
    if (!existing.private) throw new Error(PUBLIC)
    return shape(existing)
  }
}

/** The person's project repositories (names starting with egd-), newest first. */
export async function listProjectRepos(): Promise<GitHubRepo[]> {
  const out: GitHubRepo[] = []
  for (let page = 1; page < 20; page++) {
    const batch = await api<{ name: string; clone_url: string; updated_at: string }[]>(`/user/repos?affiliation=owner&sort=updated&per_page=100&page=${page}`)
    out.push(...batch.filter((r) => r.name.startsWith(REPO_PREFIX)).map((r) => ({ name: r.name, cloneUrl: r.clone_url, updatedAt: r.updated_at })))
    if (batch.length < 100) break
  }
  return out
}

/**
 * Git saving only uses private repositories: a typed-in github.com address must not be public.
 * Other hosts (and GitHub addresses we can't look up without a login) can't be checked here.
 */
export async function checkPrivate(url: string): Promise<void> {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim())
  if (!m) return
  const repo = await api<{ private: boolean }>(`/repos/${m[1]}/${m[2]}`).catch(() => null)
  if (repo && !repo.private) throw new Error(PUBLIC)
}
