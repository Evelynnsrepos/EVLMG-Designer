import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { useSettings } from '@/core/state'
import { clauses, detectLangs, sentences } from './lang'
import { findIssues, longSentence } from './proof'
import { checkRules } from './rules'
import { setSpellBackend, soundDistance, suggestRanked, tokenizeParts } from './spell'

const fixed = (text: string, lang: 'en' | 'de') => {
  let out = text
  for (const h of checkRules(text, lang, new Set(), true).reverse()) out = out.slice(0, h.from) + h.fixes[0] + out.slice(h.to)
  return out
}

describe('writing hints', () => {
  it('fixes English words that are spelled right but wrong for the sentence', () => {
    expect(fixed('Their is to many goblins and they where here.', 'en')).toBe('There is too many goblins and they were here.')
    expect(fixed('I think your right, its going to be better then the old one.', 'en')).toBe("I think you're right, it's going to be better than the old one.")
    expect(fixed('He should of known that i loose every time.', 'en')).toBe('He should have known that I lose every time.')
    expect(fixed("She don't have a apple, and we was late.", 'en')).toBe("She doesn't have an apple, and we were late.")
    expect(fixed("He didn't went to the the castle.", 'en')).toBe("He didn't go to the castle.")
  })
  it('fixes German ones', () => {
    expect(fixed('Ich denke das der Boss zu stark ist.', 'de')).toBe('Ich denke, dass der Boss zu stark ist.')
    expect(fixed('Er ist seid gestern größer wie ich.', 'de')).toBe('Er ist seit gestern größer als ich.')
    expect(fixed('Seit ihr bereit?', 'de')).toBe('Seid ihr bereit?')
    expect(fixed('Du kannst mit das Schwert kämpfen weil es stark ist.', 'de')).toBe('Du kannst mit dem Schwert kämpfen, weil es stark ist.')
  })
  it('stays quiet on correct text', () => {
    for (const s of [
      'The witch lives in the forest, and their house is over there near the old bridge.',
      "It's time to go because its claws are too sharp, and then we need more gold than before.",
      'You know where the key is, and I hear the guards over here by the gate.',
      'An hour later a unicorn and a user with an umbrella walked through the door.',
      'Let it go, and make it work like the old one.',
    ])
      expect(checkRules(s, 'en', new Set(), true)).toEqual([])
    for (const s of [
      'Der Mann, den ich gesehen habe, sagt, dass das Haus, das dort steht, seit Jahren leer ist.',
      'Ich bin sicher, dass ihr bereit seid.',
      'Wen hast du gesehen?',
      'Das Buch, das ich gestern gelesen habe, war spannend, weil niemand damit gerechnet hat.',
    ])
      expect(checkRules(s, 'de', new Set(), true)).toEqual([])
  })
  it('leaves out hints that are turned off', () => {
    expect(checkRules('Their is a dog.', 'en', new Set(['their-there']))).toEqual([])
  })
})

describe('languages', () => {
  it('splits sentences but not at abbreviations', () => {
    expect(sentences('Das ist z.B. ein Test. Und noch einer... oder? Ja!').map((s) => s.text.trim())).toEqual(['Das ist z.B. ein Test.', 'Und noch einer... oder?', 'Ja!'])
  })
  it('finds the language of each clause', () => {
    const parts = clauses('Das Gameplay ist ziemlich cool, but the cooldown is too long').map((c) => c.text)
    expect(detectLangs(parts, ['en', 'de'], 'en').map((l) => l.lang)).toEqual(['de', 'en'])
    expect(detectLangs(['Ok'], ['en', 'de'], 'de')[0]).toEqual({ lang: 'de', sure: false })
  })
  it('skips links, file names and abbreviations', () => {
    expect(tokenizeParts('See https://example.com/page or deck.json, the NPC and a Boss-Fight').map((w) => w.word)).toEqual(['See', 'or', 'the', 'and', 'Boss', 'Fight'])
  })
})

describe('with dictionaries', () => {
  const en = new Set('i the is a an word which when can make like to player it finds opener and cool but too long there their no way out castle color level spawn boss item'.split(' '))
  const de = new Set('wich wird kann wen das ist ziemlich der die Hund Boss Kampf Aufstieg Spieler hat und'.split(' '))
  const sugg: Record<string, string[]> = { castel: ['caste', 'castle', 'Castel'], hund: ['hound', 'hand', 'Hund'], wird: ['weird', 'word'] }
  beforeAll(() => {
    useSettings.setState({ spellCheck: true, spellLanguages: ['en', 'de'], aiHelper: false, personalWords: [], spellRulesOff: [] })
    setSpellBackend({
      check: async (lang, words) => words.map((w) => (lang === 'en' ? en : de).has(w) || (lang === 'en' ? en : de).has(w.toLowerCase())),
      suggest: async (lang, word) => (lang === 'en' ? (sugg[word] ?? []).filter((s) => s !== 'Hund') : (sugg[word] ?? []).filter((s) => s === 'Hund')),
    })
  })
  afterAll(() => setSpellBackend(null))
  const marks = async (text: string) => (await findIssues([text]))[0].map((x) => `${text.slice(x.from, x.to)}→${x.fixes?.[0] ?? '?'}`)

  it('catches a German word that slipped into an English sentence', async () => {
    expect(await marks('The player finds it, wich is cool.')).toEqual(['wich→which'])
    expect(await marks('I wird like to make the item.')).toEqual(['wird→word'])
  })
  it('accepts mixed sentences, borrowed words and British spelling', async () => {
    expect(await marks('Das ist ziemlich cool, but the level is too long.')).toEqual([])
    expect(await marks('Der Spieler hat das Gameplay und die Colour.')).toEqual([])
    expect(await marks('Der Bosskampf und der Levelaufstieg.')).toEqual([])
  })
  it('treats a German noun typed small as a calm hint, not a misspelling', async () => {
    const hits = (await findIssues(['Der hund hat das.']))[0]
    expect(hits.map((x) => [x.rule, x.fix])).toEqual([['noun-capital', 'Hund']])
  })
  it('marks misspelled words and ranks the word that sounds alike first', async () => {
    expect(await marks('The castel is cool.')).toEqual(['castel→?'])
    expect((await suggestRanked('castel', 'en'))[0].word).toBe('castle')
    expect((await suggestRanked('hund', 'de'))[0].word).toBe('Hund')
    expect((await suggestRanked('villeicht', 'de'))[0].word).toBe('vielleicht')
    expect(soundDistance('fone', 'phone')).toBeLessThan(soundDistance('fone', 'done') + 1)
  })
})

describe('sound-alike suggestions', () => {
  it('finds everyday words the dictionary does not guess', async () => {
    useSettings.setState({ spellCheck: true, spellLanguages: ['en', 'de'] })
    setSpellBackend({ check: async (_l, words) => words.map((w) => ['and', 'then'].includes(w)), suggest: async () => [] })
    expect((await suggestRanked('buisness', 'en'))[0].word).toBe('business')
    expect((await suggestRanked('kitchin', 'en'))[0].word).toBe('kitchen')
    expect((await suggestRanked('tommorow', 'en'))[0].word).toBe('tomorrow')
    expect((await suggestRanked('andthen', 'en'))[0].word).toBe('and then')
    setSpellBackend(null)
  })

  it('lets the words around and learned fixes decide', async () => {
    useSettings.setState({ spellCheck: true, spellLanguages: ['en', 'de'], learnedFixes: {} })
    setSpellBackend({ check: async (_l, words) => words.map(() => false), suggest: async () => ['peace', 'piece'] })
    expect((await suggestRanked('peice', 'en', { prev: 'a', next: 'of' }))[0].word).toBe('piece')
    expect((await suggestRanked('peice', 'en', { prev: 'world', next: 'and' }))[0].word).toBe('peace')
    useSettings.setState({ learnedFixes: { kitchin: 'kitten' } })
    expect((await suggestRanked('kitchin', 'en'))[0].word).toBe('kitten')
    useSettings.setState({ learnedFixes: {} })
    setSpellBackend(null)
  })
})

describe('long sentences', () => {
  it('offers a full stop at a joining word in the second half', () => {
    const half = 'the little grey cat walked over the old stone bridge to the market in the early morning light with a basket'
    const hit = longSentence(`${half} today and then ${half}`, 'en')!
    expect(longSentence(`${half} and ${half}`, 'en')).toBeNull()
    expect(hit.fix).toBe("today. Then")
    expect(longSentence(half, 'en')).toBeNull()
  })
})
