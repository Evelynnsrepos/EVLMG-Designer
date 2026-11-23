import { describe, expect, it } from 'vitest'
import { gpuIssueUrl } from './GpuCard'

describe('gpuIssueUrl', () => {
  it('fills a new GitHub issue with the graphics details', () => {
    const url = gpuIssueUrl('llvmpipe', false, '0.35.0', 'auto')
    expect(url).toContain('/issues/new?title=Graphics%20card%20not%20used&body=')
    const body = decodeURIComponent(url.split('body=')[1])
    expect(body).toContain('Graphics: llvmpipe, no WebGL2')
    expect(body).toContain('Graphics mode: auto')
  })
})
