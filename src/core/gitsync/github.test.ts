import { describe, expect, it } from 'vitest'
import { checkPrivate, createProjectRepo, setCredentialAsker, setGitHubFetch } from './github'

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('git saving only uses private repositories', () => {
  setCredentialAsker(async () => 'token')

  it('makes new repositories private', async () => {
    let sent: { private?: boolean } = {}
    setGitHubFetch((async (_: string, init?: RequestInit) => ((sent = JSON.parse(String(init?.body))), reply(201, { name: 'egd-x', clone_url: 'u', updated_at: '', private: true }))) as typeof fetch)
    await createProjectRepo('X')
    expect(sent.private).toBe(true)
  })

  it('refuses an existing public repository with the same name', async () => {
    setGitHubFetch((async (url: string) =>
      url.endsWith('/user/repos') ? reply(422, { message: 'name already exists' }) : url.endsWith('/user') ? reply(200, { login: 'me' }) : reply(200, { name: 'egd-x', clone_url: 'u', updated_at: '', private: false })) as typeof fetch)
    await expect(createProjectRepo('X')).rejects.toThrow(/public/)
  })

  it('refuses a typed-in public GitHub address, allows private ones and other hosts', async () => {
    setGitHubFetch((async (url: string) => reply(200, { private: !url.includes('open') })) as typeof fetch)
    await expect(checkPrivate('https://github.com/me/open-game.git')).rejects.toThrow(/public/)
    await expect(checkPrivate('git@github.com:me/secret.git')).resolves.toBeUndefined()
    await expect(checkPrivate('https://codeberg.org/me/open.git')).resolves.toBeUndefined()
  })
})
