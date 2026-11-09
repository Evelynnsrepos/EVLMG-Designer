import { describe, expect, it } from 'vitest'
import { createLocDoc, exportCSV, importCSV, markTranslated, merge, needsUpdate, progress, slug } from './model'

describe('localization', () => {
  it('merges found texts without losing translations', () => {
    let d = createLocDoc()
    d = merge(d, [{ key: 'item.sword.name', context: 'Item', text: 'Sword' }]).doc
    d = { ...d, items: d.items.map((s) => ({ ...s, values: { ...s.values, de: 'Schwert' } })) }
    const r = merge(d, [
      { key: 'item.sword.name', context: 'Item', text: 'Sword' },
      { key: 'item.bow.name', context: 'Item', text: 'Bow' },
    ])
    expect(r.added).toBe(1)
    expect(r.updated).toBe(0)
    expect(r.doc.items[0].values.de).toBe('Schwert')
    expect(progress(r.doc)).toEqual({ en: 1, de: 0.5 })
    expect(slug("The Old King's Crown!")).toBe('the_old_kings_crown')
  })

  it('round-trips CSV and adds new languages', () => {
    const d = merge(createLocDoc(), [{ key: 'ui.start', context: 'Menu', text: 'Start' }]).doc
    const csv = exportCSV(d).replace('ui.start,Menu,Start,', 'ui.start,Menu,Start,Starten') + 'ui.quit,Menu,Quit,Beenden\r\n'
    const back = importCSV(d, csv.replace('key,context,en,de', 'key,context,en,de,fr'))
    expect(back.languages).toEqual(['en', 'de', 'fr'])
    expect(back.items.map((s) => [s.key, s.values.de])).toEqual([
      ['ui.start', 'Starten'],
      ['ui.quit', 'Beenden'],
    ])
  })
})

describe('localization keys stay with their text (0.28)', () => {
  const de = (d: ReturnType<typeof createLocDoc>, key: string, text: string) => ({ ...d, items: d.items.map((s) => (s.key === key ? markTranslated(d, { ...s, values: { ...s.values, de: text } }, ['de']) : s)) })

  it('a line inserted before another keeps every translation on its own line', () => {
    let d = merge(createLocDoc(), [
      { ref: 'dialogue:a:l1', key: 'dialogue.intro.line_1', context: '', text: 'Hello' },
      { ref: 'dialogue:a:l2', key: 'dialogue.intro.line_2', context: '', text: 'Bye' },
    ]).doc
    d = de(de(d, 'dialogue.intro.line_1', 'Hallo'), 'dialogue.intro.line_2', 'Tschüss')
    const r = merge(d, [
      { ref: 'dialogue:a:l0', key: 'dialogue.intro.line_1', context: '', text: 'Wait!' },
      { ref: 'dialogue:a:l1', key: 'dialogue.intro.line_2', context: '', text: 'Hello' },
      { ref: 'dialogue:a:l2', key: 'dialogue.intro.line_3', context: '', text: 'Bye' },
    ])
    const by = (ref: string) => r.doc.items.find((s) => s.ref === ref)!
    expect(by('dialogue:a:l1').values.de).toBe('Hallo')
    expect(by('dialogue:a:l2').values.de).toBe('Tschüss')
    expect(by('dialogue:a:l0').values.de).toBeUndefined()
    expect(by('dialogue:a:l0').key).toBe('dialogue.intro.line_1_2')
    expect(r.updated).toBe(0)
  })

  it('a rename keeps the key; a changed source marks the translation until it is checked', () => {
    let d = merge(createLocDoc(), [{ ref: 'item:x.name', key: 'item.sword.name', context: '', text: 'Sword' }]).doc
    d = de(d, 'item.sword.name', 'Schwert')
    d = merge(d, [{ ref: 'item:x.name', key: 'item.blade.name', context: '', text: 'Blade' }]).doc
    expect(d.items).toHaveLength(1)
    expect(d.items[0].key).toBe('item.sword.name')
    expect(needsUpdate(d, d.items[0], 'de')).toBe(true)
    d = { ...d, items: [markTranslated(d, d.items[0], ['de'])] }
    expect(needsUpdate(d, d.items[0], 'de')).toBe(false)
  })

  it('tables from before 0.28 follow the text first, then the key with a "needs update" mark', () => {
    const old = { languages: ['en', 'de'], items: [
      { id: '1', key: 'dialogue.intro.line_1', context: '', values: { en: 'Hello', de: 'Hallo' } },
      { id: '2', key: 'dialogue.intro.line_2', context: '', values: { en: 'See you', de: 'Bis bald' } },
    ] }
    const r = merge(old, [
      { ref: 'dialogue:a:l0', key: 'dialogue.intro.line_1', context: '', text: 'Wait!' },
      { ref: 'dialogue:a:l1', key: 'dialogue.intro.line_2', context: '', text: 'Hello' },
      { ref: 'dialogue:a:l2', key: 'dialogue.intro.line_3', context: '', text: 'Bye' },
    ])
    const by = (ref: string) => r.doc.items.find((s) => s.ref === ref)!
    expect(by('dialogue:a:l1').values.de).toBe('Hallo')
    expect(needsUpdate(r.doc, by('dialogue:a:l1'), 'de')).toBe(false)
    expect(by('dialogue:a:l0').values.de).toBeUndefined()
    expect(by('dialogue:a:l1').key).toBe('dialogue.intro.line_1')
    expect(by('dialogue:a:l2').values.de).toBeUndefined()
    // "See you" is gone from the dialogue; its row stays untouched instead of lending "Bis bald" to another line.
    expect(r.doc.items.find((s) => s.id === '2')).toMatchObject({ values: { en: 'See you', de: 'Bis bald' } })
  })

  it('an old row whose text changed in place keeps its translation with a mark', () => {
    const old = { languages: ['en', 'de'], items: [{ id: '1', key: 'quest.q.name', context: '', values: { en: 'Find', de: 'Finden' } }] }
    const r = merge(old, [{ ref: 'quest:q1.name', key: 'quest.q.name', context: '', text: 'Find it' }])
    expect(r.doc.items[0]).toMatchObject({ ref: 'quest:q1.name', values: { de: 'Finden' } })
    expect(needsUpdate(r.doc, r.doc.items[0], 'de')).toBe(true)
  })
})

describe('translator files', () => {
  it('writes XLIFF and PO with escaping and update marks', async () => {
    const { exportXLIFF, exportPO } = await import('./model')
    const d: import('./model').LocDoc = { languages: ['en', 'de'], items: [{ id: 'a', key: 'k1', context: 'Shop', values: { en: 'A <b> "x"', de: 'Ein' }, base: { de: 'old' } }, { id: 'b', key: 'k2', context: '', values: { en: 'Hi\nthere' } }] }
    const x = exportXLIFF(d, 'de')
    expect(x).toContain('<source>A &lt;b&gt; &quot;x&quot;</source>')
    expect(x).toContain('<target state="needs-translation">Ein</target>')
    expect(x).toContain('<target state="new"></target>')
    const p = exportPO(d, 'de')
    expect(p).toContain('#, fuzzy\nmsgctxt "k1"\nmsgid "A <b> \\"x\\""\nmsgstr "Ein"')
    expect(p).toContain('msgid "Hi\\nthere"')
  })
})
