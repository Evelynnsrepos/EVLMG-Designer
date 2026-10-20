import { describe, expect, it } from 'vitest'
import { parseGitConfig, publicReadUrl } from './gitsync'

describe('publicReadUrl', () => {
  it('turns SSH addresses into HTTPS and drops logins', () => {
    expect(publicReadUrl('git@gitlab.com:me/game.git')).toBe('https://gitlab.com/me/game.git')
    expect(publicReadUrl('ssh://git@gitea.home:2222/me/game.git')).toBe('https://gitea.home/me/game.git')
    expect(publicReadUrl('https://me:token@codeberg.org/me/game.git')).toBe('https://codeberg.org/me/game.git')
  })
  it('keeps the port and scheme of web addresses', () => {
    expect(publicReadUrl('http://192.168.1.5:3000/me/game.git')).toBe('http://192.168.1.5:3000/me/game.git')
  })
  it('counts folders on this computer as private', () => {
    expect(publicReadUrl('/home/me/backup.git')).toBeNull()
    expect(publicReadUrl('C:\\repos\\game.git')).toBeNull()
    expect(publicReadUrl('file:///home/me/backup.git')).toBeNull()
  })
})

describe('parseGitConfig', () => {
  it('keeps only key=value lines', () => {
    expect(parseGitConfig(['http.sslVerify=false', '  http.proxy=http://p:8080 ', 'push --force', '', 'nokey=1', 'url.https://x/.insteadOf=git://x/'])).toEqual([
      'http.sslVerify=false',
      'http.proxy=http://p:8080',
      'url.https://x/.insteadOf=git://x/',
    ])
  })
})
