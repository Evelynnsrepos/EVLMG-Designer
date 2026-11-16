import { describe, expect, it } from 'vitest'
import { addFollower, connectNodes, createDefaultStory, createNodeAfter, patchStoryNode, readingOrder, setChoiceText, storyProblems, storyStarts, storyStats, tidyLayout, toTwee, type StoryItem } from './model'
import type { Scene } from '@/shared/canvas'

const H = () => 100
function story() {
  let s: Scene<StoryItem> = createDefaultStory().scene
  const layer = s.layers[0].id
  const a = createNodeAfter(s, null, layer, { x: 0, y: 0 })
  s = patchStoryNode(a.scene, a.node.id, { title: 'Gate', body: 'At night.' })
  const b = addFollower(s, a.node.id, H)!
  s = patchStoryNode(b.scene, b.node.id, { title: 'Sneak' })
  const c = addFollower(s, a.node.id, H)!
  s = patchStoryNode(c.scene, c.node.id, { title: 'Knock', role: 'end' })
  return { s, a: a.node.id, b: b.node.id, c: c.node.id, layer }
}

describe('story writer overhaul', () => {
  it('quick add stacks a second follower under the first as a new choice', () => {
    const { s, b, c } = story()
    const nb = s.nodes.find((n) => n.id === b)!
    const nc = s.nodes.find((n) => n.id === c)!
    expect(nc.x).toBe(nb.x)
    expect(nc.y).toBeGreaterThanOrEqual(nb.y + 100)
    expect(storyStats(s)).toMatchObject({ nodes: 3, choices: 1, endings: 1, words: 5 })
  })

  it('finds the start, reading order and problems', () => {
    const { s, a, b, c, layer } = story()
    expect(storyStarts(s).map((n) => n.id)).toEqual([a])
    expect(readingOrder(s).map((n) => n.id)).toEqual([a, b, c])
    // b stops without being an ending; a lone extra node is unreachable once the story has a marked start
    let s2 = patchStoryNode(s, a, { role: 'start' })
    s2 = createNodeAfter(s2, null, layer, { x: 900, y: 900 }).scene
    const kinds = storyProblems(s2).map((p) => p.kind)
    expect(kinds).toContain('dead-end')
    expect(kinds).toContain('unreachable')
    expect(kinds).toContain('untitled')
  })

  it('tidy puts each step in its own column without overlaps', () => {
    const { s, a, b, c } = story()
    const moved = s.nodes.map((n) => (n.id === c ? { ...n, x: -500, y: 3 } : n))
    const t = tidyLayout({ ...s, nodes: moved }, H)
    const get = (id: string) => t.nodes.find((n) => n.id === id)!
    expect(get(b).x).toBeGreaterThan(get(a).x)
    expect(get(c).x).toBe(get(b).x)
    expect(Math.abs(get(c).y - get(b).y)).toBeGreaterThanOrEqual(100)
  })

  it('exports Twine passages with choice text and an ending tag', () => {
    const { s, a, b, c } = story()
    let s2 = connectNodes(s, b, c)
    const arrow = s2.nodes.find((n) => n.kind === 'connector' && n.fromId === a && n.toId === b)!
    s2 = setChoiceText(s2, arrow.id, 'Climb the wall')
    const twee = toTwee(s2, 'Moon')
    expect(twee).toContain(':: StoryTitle\nMoon')
    expect(twee).toContain('"start": "Gate"')
    expect(twee).toContain('[[Climb the wall->Sneak]]')
    expect(twee).toContain('[[Knock]]')
    expect(twee).toMatch(/:: Knock \[ending\]/)
  })
})
