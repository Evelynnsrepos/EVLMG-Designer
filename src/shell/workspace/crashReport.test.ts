import { describe, expect, it } from 'vitest'
import { issueUrl } from './crashReport'

describe('crash report', () => {
  it('fills a GitHub new-issue page and keeps the link short enough for the browser', () => {
    const url = issueUrl('https://github.com/x/y', 'Draw', 'Error: boom\n' + 'at a\n'.repeat(5000))
    expect(url.startsWith('https://github.com/x/y/issues/new?title=Draw%20crashed&body=')).toBe(true)
    expect(decodeURIComponent(url)).toContain('Error: boom')
    expect(url.length).toBeLessThan(8000)
  })
})
