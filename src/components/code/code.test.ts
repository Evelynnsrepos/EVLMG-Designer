import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree, getIndentation, indentUnit } from '@codemirror/language'
import { describe, expect, it } from 'vitest'
import { buildExport, type ExportInput } from '@/shell/engineExport/build'
import { Combo, COMBO_MS, comboTitle } from './combo'
import { completionsAt, designDataFrom, didYouMean, findProblems, refAt } from './designData'
import { gdscript } from './gdscript'
import { fileUri, isTextFile, outputLinks, relPath } from './model'

const input = {
  projectName: 'T',
  entities: { item: [{ id: 'u1', name: 'Fire Sword', description: 'Hot.', image: null, categories: {}, stats: { ATK: 12 } }], character: [], town: [], enemy: [] },
  categories: [],
  quests: [],
  dialogues: [],
  strings: { languages: ['en', 'de'], items: [{ key: 'MENU_START', values: { en: 'Start', de: 'Los' } }] },
  flags: [],
  tools: [{ type: 'skill-tree', documents: [{ id: 'd1', title: 'Warrior', data: {} }] }],
} as unknown as ExportInput
const data = designDataFrom(buildExport(input, 'godot'), input.strings)

describe('design data in code', () => {
  it('reads the ids the export writes', () => {
    expect(data.kinds.items).toEqual([{ id: 'fire_sword', name: 'Fire Sword', detail: 'Hot. · ATK 12', tool: 'item-list', documentId: null }])
    expect(data.tools['skill-tree'][0]).toMatchObject({ id: 'warrior', documentId: 'd1' })
  })
  it('completes lists, ids, tools and translation keys', () => {
    expect(completionsAt('var s = Egd.find("it', data)).toMatchObject({ from: 18, options: expect.arrayContaining([{ label: 'items', detail: 'list' }]) })
    expect(completionsAt('Egd.find("items", "fi', data)).toEqual({ from: 19, options: [{ label: 'fire_sword', detail: 'Fire Sword' }] })
    expect(completionsAt('Egd.tool("skill-tree", "', data)?.options).toEqual([{ label: 'warrior', detail: 'Warrior' }])
    expect(completionsAt('label.text = tr("ME', data)?.options).toEqual([{ label: 'MENU_START', detail: 'Start' }])
    expect(completionsAt('print("items', data)).toBeNull()
  })
  it('underlines ids the project does not have, with a fix', () => {
    const text = 'var a = Egd.find("items", "fire_sword")\nvar b = Egd.find("items", "fire_swrd")\nvar c = Egd.find("itms", "x")\nvar d = Egd.tool("skill-tree")'
    const problems = findProblems(text, data)
    expect(problems.map((p) => [text.slice(p.from, p.to), p.fix])).toEqual([
      ['fire_swrd', 'fire_sword'],
      ['itms', 'items'],
    ])
    expect(didYouMean('zzzzzz', ['items'])).toBeNull()
  })
  it('finds the entry under the cursor', () => {
    const line = 'Egd.find("items", "fire_sword")'
    expect(refAt(line, 22, data)).toMatchObject({ title: 'Fire Sword', from: 19, to: 29 })
    expect(refAt(line, 12, data)).toBeNull()
    expect(refAt('tr("MENU_START")', 6, data)?.detail).toBe('en: Start\nde: Los')
  })
})

describe('paths and output', () => {
  it('makes file URIs on Linux and Windows', () => {
    expect(fileUri('/home/me/my game')).toBe('file:///home/me/my%20game')
    expect(fileUri('C:\\Games\\rpg')).toBe('file:///C:/Games/rpg')
    expect(relPath('/home/me/game', 'file:///home/me/game/src/player.gd')).toBe('src/player.gd')
    expect(relPath('C:\\Games\\rpg', 'file:///c:/Games/rpg/a.gd')).toBe('a.gd')
    expect(relPath('/home/me/game', 'file:///usr/share/x.gd')).toBeNull()
    expect(relPath('/home/me/game', 'res://ui/menu.gd')).toBe('ui/menu.gd')
  })
  it('finds the code lines in engine output', () => {
    expect(outputLinks('   at: _ready (res://src/player.gd:12)')).toEqual([{ path: 'src/player.gd', line: 12, from: 15, to: 37 }])
    expect(outputLinks('hello')).toEqual([])
  })
  it('knows which files are text', () => {
    expect(isTextFile('player.gd')).toBe(true)
    expect(isTextFile('icon.png')).toBe(false)
  })
})

describe('GDScript', () => {
  const state = (doc: string) => EditorState.create({ doc, extensions: [gdscript, indentUnit.of('\t'), EditorState.tabSize.of(4)] })
  it('indents one step after a line ending in a colon', () => {
    const s = state('func _ready() -> void:  # start\n\tif hp > 0:\n\t\tpass\nvar x = {"a": 1}\n')
    ensureSyntaxTree(s, s.doc.length, 1000)
    const end = (n: number) => s.doc.line(n).to
    expect(getIndentation(s, end(1))).toBe(4)
    expect(getIndentation(s, end(2))).toBe(8)
    expect(getIndentation(s, end(3))).toBe(8)
    expect(getIndentation(s, end(4))).toBe(0)
  })
  it('keeps going after a multi-line string', () => {
    const s = state('var t = """one\n# not a comment\n"""\nfunc a():\n')
    const tree = ensureSyntaxTree(s, s.doc.length, 1000)!
    expect(tree.resolveInner(s.doc.line(2).from + 2).name).toBe('string')
    expect(tree.resolveInner(s.doc.line(4).from + 1).name).toBe('keyword')
  })
})

describe('Combo mode', () => {
  it('counts keys, names the steps and starts again after a pause', () => {
    const c = new Combo()
    let flashes = 0
    for (let i = 0; i < 50; i++) flashes += Number(c.hit(i * 10))
    expect([c.count, flashes, comboTitle(c.count)]).toEqual([50, 1, 'Nice'])
    expect(c.alive(490 + COMBO_MS)).toBe(true)
    expect(c.alive(491 + COMBO_MS)).toBe(false)
    c.hit(10_000)
    expect(c.count).toBe(1)
  })
})
