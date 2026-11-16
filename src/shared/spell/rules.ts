import type { Lang } from './lang'

/**
 * Context rules for words that are spelled right but are the wrong word (their/there, das/dass),
 * plus small grammar slips. No model: each rule looks at the words next to it. Rules only fire on
 * a clear pattern, so a miss is more likely than a false alarm.
 */

export interface RuleHit {
  from: number
  to: number
  fixes: string[]
  /** One short line that tells the words apart. */
  why: string
  rule: string
}

interface Tok {
  w: string
  raw: string
  from: number
  to: number
  /** Punctuation or the end of the sentence follows. */
  end: boolean
  /** A comma (or ; : – bracket) stands right before this word. */
  comma: boolean
}

interface Ctx {
  t: Tok[]
  i: number
  w: string
  raw: string
  p?: string
  p2?: string
  n?: string
  n2?: string
  /** Raw next word (for capital letters). */
  N?: string
  end: boolean
  first: boolean
  comma: boolean
  /** The sentence is a question. */
  q: boolean
}

type Out = string | string[] | { fixes: string[]; back?: number; fwd?: number } | null | undefined | false
interface Rule {
  id: string
  lang: Lang
  on: Set<string>
  why: string
  test: (c: Ctx) => Out
}

const S = (s: string) => new Set(s.split(' '))
const has = (set: Set<string>, w?: string) => w !== undefined && set.has(w)
const isCap = (s?: string) => !!s && s[0] !== s[0].toLowerCase()

const rules: Rule[] = []
function rule(lang: Lang, id: string, on: string, why: string, test: (c: Ctx) => Out) {
  rules.push({ id, lang, on: S(on), why, test })
}

// ───────────────────────── English ─────────────────────────
const SUBJ = S('i you he she it we they')
const AUX = S("do does did don't doesn't didn't can can't cannot could couldn't will won't would wouldn't should shouldn't must might may shall let lets let's make makes made help helps see saw watch hear heard have had")
const MODAL = S("can can't cannot could couldn't will won't would wouldn't should shouldn't must might may gonna wanna don't didn't doesn't")
const BE = S("is are was were be been being am isn't aren't wasn't weren't will would has")
const DET = S('the a an this that these those my your his her its our their some any no every each')
const OBJ = S('me you him her it them us this that')
const VERBS = S('be have do go get make take see say know think want need like use find give tell work try call feel leave put keep let begin help talk turn start show hear play run move live believe bring happen write sit stand lose pay meet learn change lead watch follow stop create speak read spend grow open walk win teach offer remember consider appear buy serve die send build stay fall cut reach kill raise pass sell decide return explain hope develop carry break receive agree support hit produce eat cover catch draw choose wait fight add jump attack defend heal craft spawn load save click press pick drop unlock explore collect upgrade')
const NOUNS = S('name house home car friend friends way own life lives hands eyes head heads mother father parents kids children work job team game games world time turn weapons weapon armor health attack damage level stats inventory base army king leader body mind heart power skills skill abilities ability items item enemies enemy story character characters player players quest quests map idea ideas plan fault choice opinion phone computer sword shield magic mana gold money food face voice hair room door city town village country family dog cat horse ship story stories goal goals turn turns role roles place position speed strength side sides')
const ADJ = S('good bad great hard easy fine ok okay fun cool nice important possible impossible true false over done ready late early right wrong sure welcome awesome amazing okay broken')
const AFTER_ADJ = S('to that but and because when if for so')

const NO_INV = (c: Ctx) => {
  // "does he have", "let it go": a helper verb earlier in the same clause owns the verb form.
  for (let k = c.i - 2; k >= Math.max(0, c.i - 5) && !c.t[k + 1].comma; k--) if (AUX.has(c.t[k].w)) return false
  return !c.comma && !((c.p === 'you' || c.p === 'it') && has(S('of like with for to from about than and or by below above under behind beside near after before around inside in on at'), c.p2))
}

const W_THERE = 'their = belongs to them · there = a place, or "there is" · they\'re = they are'
rule('en', 'their-there', 'their', W_THERE, (c) => (has(BE, c.n) || has(S("will would has isn't aren't wasn't weren't"), c.n) ? 'there' : c.n === 'not' || c.n === 'gonna' || (c.n === 'going' && c.n2 === 'to') ? "they're" : null))
rule('en', 'there-their', 'there', W_THERE, (c) =>
  c.n === 'going' && c.n2 === 'to' ? "they're" : c.n === 'own' || (has(NOUNS, c.n) && !has(BE, c.p) && !has(AUX, c.p) && !has(S('if when whether'), c.p)) ? 'their' : null,
)
rule('en', 'theyre-their', "they're they’re", W_THERE, (c) => (c.n === 'own' || (has(NOUNS, c.n) && !c.n!.endsWith('s') && c.n !== 'home' && c.n !== 'work') ? 'their' : null))

const W_YOUR = "your = belongs to you · you're = you are"
rule('en', 'your-youre', 'your', W_YOUR, (c) =>
  has(S('a an the not so very really too gonna just always never still probably definitely'), c.n) || (c.n === 'going' && c.n2 === 'to') || (has(ADJ, c.n) && (c.t[c.i + 1].end || has(AFTER_ADJ, c.n2))) ? "you're" : null,
)
rule('en', 'youre-your', "you're you’re", W_YOUR, (c) => (has(S('own name house car turn inventory character mom dad mother father fault choice job life idea opinion phone computer game team health weapon sword'), c.n) ? 'your' : null))

const W_ITS = "its = belongs to it · it's = it is / it has"
rule('en', 'its-its', 'its', W_ITS, (c) =>
  has(S('a an the not been going gonna so very really too just always never still also only because ok okay kinda pretty my your his her our their that this what how why when where'), c.n) ||
  (has(ADJ, c.n) && (c.t[c.i + 1].end || has(AFTER_ADJ, c.n2))) ||
  (c.n === 'time' && c.n2 === 'to')
    ? "it's"
    : null,
)
rule('en', 'its-own', "it's it’s", W_ITS, (c) => (c.n === 'own' ? 'its' : null))

const W_THAN = 'than = compares (bigger than) · then = time (and then)'
const COMP = S('more less better worse rather other bigger smaller faster slower higher lower stronger weaker easier harder older younger longer shorter greater fewer larger cheaper earlier sooner')
rule('en', 'then-than', 'then', W_THAN, (c) => (has(COMP, c.p) || (has(S('more less'), c.p2) && !c.comma) ? 'than' : null))
rule('en', 'than-then', 'than', W_THAN, (c) => (c.first || (has(S('and but since until back by'), c.p) && !has(COMP, c.p2)) ? 'then' : null))

const W_TOO = 'too = more than enough, or also · to = direction, or before a verb · two = 2'
rule('en', 'to-too', 'to', W_TOO, (c) =>
  has(S('much many late early big small bad good hard easy long short far fast slow few little often soon high low strong weak hot cold old young expensive difficult'), c.n) && (c.t[c.i + 1].end || has(S('much many'), c.n) || has(AFTER_ADJ, c.n2))
    ? 'too'
    : c.p === 'me' && c.end && c.i === c.t.length - 1
      ? 'too'
      : null,
)
rule('en', 'too-to', 'too', W_TOO, (c) => (has(VERBS, c.n) && !has(S('like much many'), c.n) && !has(S('is was are were'), c.p) ? 'to' : null))

rule('en', 'of-have', 'of', '"could of" sounds like "could\'ve" = could have', (c) => (has(S("could would should must might couldn't wouldn't shouldn't"), c.p) ? 'have' : null))

const W_LOSE = 'lose = not win, or not have any more · loose = not tight'
rule('en', 'loose-lose', 'loose', W_LOSE, (c) => (has(MODAL, c.p) || has(S("to never you'll i'll we'll they'll"), c.p) ? 'lose' : null))
rule('en', 'loose-loses', 'loose', W_LOSE, (c) => (has(S('he she it'), c.p) && NO_INV(c) ? 'loses' : has(S('i you we they'), c.p) && (has(DET, c.n) || has(OBJ, c.n)) ? 'lose' : null))
rule('en', 'loosing', 'loosing', W_LOSE, () => 'losing')

const W_EFFECT = 'effect = the result (a thing) · affect = to change something (an action)'
rule('en', 'affect-effect', 'affect affects', W_EFFECT, (c) => (has(S('the an no any this that side status special sound visual same positive negative big huge small'), c.p) ? c.w.replace('a', 'e') : null))
rule('en', 'effect-affect', 'effect', W_EFFECT, (c) => (has(MODAL, c.p) || c.p === 'not' ? (has(DET, c.n) || has(OBJ, c.n) || has(S('how what'), c.n) ? 'affect' : null) : null))

const W_WHOSE = "whose = belongs to who · who's = who is"
rule('en', 'whose-whos', 'whose', W_WHOSE, (c) => (has(S('a the going been not there that this your in on at'), c.n) ? "who's" : null))

const W_WERE = "were = past of are · where = a place · we're = we are"
rule('en', 'where-were', 'where', W_WERE, (c) => (has(S('we they'), c.p) ? 'were' : null))
rule('en', 'were-where', 'were', W_WERE, (c) => (has(S('is are do does did can'), c.n) && !has(S('we you they there'), c.p) ? 'where' : c.first && (c.n === 'going' || c.n === 'gonna' || c.n === 'not') && !c.q ? "we're" : null))

const W_QUIET = 'quiet = no noise · quite = fairly, very'
rule('en', 'quite-quiet', 'quite', W_QUIET, (c) => (has(S('be is was keep stay very too so really'), c.p) && (c.end || has(S('and but place room night voice moment'), c.n)) ? 'quiet' : null))
rule('en', 'quiet-quite', 'quiet', W_QUIET, (c) => (has(S('a good bad hard easy difficult simple often sure nice well big some few similar different'), c.n) && !has(S('be keep stay very too so really the'), c.p) ? 'quite' : null))

rule('en', 'of-off', 'of', 'off = away, not on · of = belongs to, made from', (c) =>
  has(S('turn turned turns switch switched take took cut fall fell log logged pay paid kick kicked drop dropped shut cool wear worn go goes went going'), c.p) && (c.end || has(S('the a my your his her its our their and when if after before'), c.n)) ? 'off' : null,
)

const W_KNOW = 'know = have it in your head · now = at this moment · no = not yes'
rule('en', 'no-know', 'no', W_KNOW, (c) => (has(S("i you we they don't didn't to dont"), c.p) && has(S('that what how why where when if it about this him her'), c.n) ? 'know' : null))
rule('en', 'now-know', 'now', W_KNOW, (c) => (has(S("don't didn't doesn't dont i you we they to"), c.p) && has(S('what how why if whether who where'), c.n) ? 'know' : null))
rule('en', 'know-now', 'know', W_KNOW, (c) => (has(S('right for until till by from'), c.p) && !has(S('that what how why if'), c.n) ? 'now' : null))

const W_HERE = 'here = this place · hear = with your ears'
rule('en', 'hear-here', 'hear', W_HERE, (c) => (has(S('over right in from around near come came stay live been is are was be get got up down back'), c.p) && (c.end || has(S('and but is are to for in with'), c.n)) ? 'here' : null))
rule('en', 'here-hear', 'here', W_HERE, (c) => (has(S("can can't cannot could couldn't didn't don't won't to"), c.p) && !(c.p === 'to' && has(S('from of'), c.n)) && has(S('you me him her them it the a that what about from of music voices sounds something anything nothing'), c.n) ? 'hear' : null))

rule('en', 'weather-whether', 'weather', 'whether = if · weather = rain, sun, wind', (c) =>
  c.n === 'or' || (has(S('know decide wonder see check sure ask asks asked tell determine determines unsure unclear matter question'), c.p) && (has(SUBJ, c.n) || has(DET, c.n) || c.n === 'to' || c.n === 'there')) ? 'whether' : null,
)

const W_ACCEPT = 'accept = say yes, take · except = but not'
rule('en', 'accept-except', 'accept', W_ACCEPT, (c) => (has(S('for when that if'), c.n) && !has(MODAL, c.p) && c.p !== 'to' ? 'except' : null))
rule('en', 'except-accept', 'except', W_ACCEPT, (c) => ((has(MODAL, c.p) || has(S('to please'), c.p)) && has(S('the a it that this my your his her our their him them me us'), c.n) ? 'accept' : null))

const W_PAST = 'past = by, beyond, or earlier time · passed = went by (an action)'
rule('en', 'passed-past', 'passed', W_PAST, (c) =>
  has(S('walk walked walks run ran runs go went goes going drive drove move moved moves sneak sneaked snuck get got fly flew rush rushed half'), c.p) || (c.p === 'the' && has(S('in from of'), c.p2)) ? 'past' : null,
)
rule('en', 'past-passed', 'past', W_PAST, (c) => (has(S("has have had he she i we they hasn't haven't just already never"), c.p) && has(S('the a away out on it through by my his her all'), c.n) && !has(S('walk walked go went run ran'), c.p2) ? 'passed' : null))

rule('en', 'lead-led', 'lead', 'led = past of lead (it led to…) · lead = now, or the metal', (c) => (has(S('has have had was were been being got'), c.p) ? 'led' : null))
rule('en', 'brake-break', 'brake', 'break = pause, or smash · brake = stops a car', (c) =>
  (has(S('a short quick lunch coffee'), c.p) && has(S('take took need needs needed have had taking a'), c.p2)) || ((has(MODAL, c.p) || c.p === 'to') && has(S('the a it down up out into in free through my your his her their things stuff everything rules'), c.n)) ? 'break' : null,
)
const W_ADVICE = 'advice = the tip (a thing) · advise = to give a tip (an action)'
rule('en', 'advice-advise', 'advice', W_ADVICE, (c) => (has(S('i would to we they'), c.p) && (has(OBJ, c.n) || has(S('against to that'), c.n)) ? 'advise' : null))
rule('en', 'advise-advice', 'advise', W_ADVICE, (c) => (has(S('an some my any good bad your his her their of for the'), c.p) ? 'advice' : null))
rule('en', 'peace-piece', 'peace', 'piece = a part · peace = no war', (c) => (c.n === 'of' && c.n2 !== 'mind' ? 'piece' : null))

rule('en', 'dose-does', 'dose', 'does = he/she/it does · dose = an amount of medicine', (c) =>
  c.n !== 'of' && (has(S('not it he she the this that a'), c.n) || has(S('what how why where when who it he she that this which'), c.p)) && !has(S('a the one each daily high low small large double'), c.p) ? 'does' : null,
)
const W_FROM = 'from = where it starts · form = a shape, or to make'
rule('en', 'form-from', 'form', W_FROM, (c) =>
  has(S('come comes came coming away far apart different differ differs made taken take takes took get gets got back is are was were start starts started starting drop drops dropped loot looted benefit protect escape escapes escaped learn learned removed remove hide steal stolen separate aside derived safe free move moves moved switch switched change changed range ranges ranging copied copy imported import loaded load'), c.p) &&
  (has(DET, c.n) || has(OBJ, c.n) || has(S('here there now'), c.n) || isCap(c.N))
    ? 'from'
    : has(DET, c.n) && has(S('shop store start beginning top bottom left right menu list inventory game enemy player boss chest castle village town city forest dungeon sky ground side back front inside outside other first last same north south east west'), c.n2) && !has(S('to will can would that which they we you i and'), c.p)
      ? 'from'
      : null,
)
rule('en', 'from-form', 'from', W_FROM, (c) => (has(S('a the this that its his her their final true human new second first another any some each'), c.p) && (c.end || has(S('of is was and has to that which for'), c.n)) ? 'form' : null))

const W_BUY = 'buy = pay for · by = next to, or who did it · bye = goodbye'
rule('en', 'by-buy', 'by', W_BUY, (c) => ((has(MODAL, c.p) || has(S("to lets let's"), c.p)) && has(S('a an some more it them new items potions weapons upgrades stuff things food one this that these those the'), c.n) && c.n2 !== 'way' ? 'buy' : null))
rule('en', 'buy-by', 'buy', W_BUY, (c) => ((c.n === 'the' && c.n2 === 'way') || has(S('made written created done designed killed hit attacked owned used followed caused defeated drawn built'), c.p) ? 'by' : null))

rule('en', 'new-knew', 'new', 'knew = past of know · new = not old', (c) => (has(S('i he she we they already never always'), c.p) && has(S('that it what how why he she they i about the him her this where when you exactly nothing everything something'), c.n) ? 'knew' : null))
rule('en', 'right-write', 'right', 'write = put words down · right = correct, or not left', (c) =>
  (has(MODAL, c.p) || has(S('to i we they'), c.p)) && has(S('a an it this that down about code text books stories story letters my your more something anything everything some'), c.n) ? 'write' : null,
)
rule('en', 'witch-which', 'witch', 'which = what one · witch = does magic', (c) =>
  has(S('in on at for of to from with by about'), c.p) || (c.comma && has(S('is are was were means makes has can will i we you they he she it'), c.n)) ? 'which' : null,
)
rule('en', 'weak-week', 'weak', 'week = 7 days · weak = not strong', (c) =>
  has(S('a one two three this last next every per each few'), c.p) && (c.end || has(S('ago later after before of i we he she they is was long from in on at to'), c.n)) ? 'week' : null,
)
rule('en', 'wood-would', 'wood', 'would = I would like… · wood = from trees', (c) =>
  (has(SUBJ, c.p) || has(S('that which who there what this'), c.p)) && has(S('be have like love not never also say make do go need want take get give rather mean work help look seem become cause allow let probably really just still always only'), c.n) ? 'would' : null,
)
rule('en', 'one-won', 'one', 'won = past of win · one = 1', (c) =>
  has(S('i we they he she who have has had team player players'), c.p) && (has(S('against again easily'), c.n) || (c.n === 'the' && has(S('game match fight battle race war round tournament prize lottery cup championship duel bet'), c.n2))) ? 'won' : null,
)
rule('en', 'sea-see', 'sea', 'see = with your eyes · sea = the ocean', (c) => ((has(MODAL, c.p) || has(S("to i you we they lets let's"), c.p)) && has(S('the a it that this what how if you him her them me us my your why where who his'), c.n) ? 'see' : null))
const W_THROUGH = 'through = in one side and out the other · threw = past of throw'
rule('en', 'threw-through', 'threw', W_THROUGH, (c) => (has(S('go goes went going walk walks walked run ran pass passed get got look looked move moved travel traveled come came fall fell break broke way halfway'), c.p) ? 'through' : null))
rule('en', 'through-threw', 'through', W_THROUGH, (c) => (has(S('i he she they we'), c.p) && has(S('a an the it his her my their them him me'), c.n) ? 'threw' : null))
const W_ALOUD = 'allowed = may do it · aloud = with your voice'
rule('en', 'aloud-allowed', 'aloud', W_ALOUD, (c) => (has(S("not is are was were be isn't aren't wasn't weren't am being been"), c.p) && (c.end || has(S('to in on here there'), c.n)) ? 'allowed' : null))
rule('en', 'allowed-aloud', 'allowed', W_ALOUD, (c) => (has(S('read reads reading say said think thinking thought speak spoke laugh laughed cry cried wonder wondered out'), c.p) ? 'aloud' : null))

const VOWEL_NOUNS = S('apple item enemy example ability attack object idea option effect upgrade area island action event animation icon image element entity ally army arrow axe egg eye elf orc ogre animal hour error issue answer update inventory input output interface engine editor entry exit opening ending order owner artist author artifact armor amulet ore orb aura altar archer assassin angel opponent obstacle')
rule('en', 'an-and', 'an', 'and = plus · an = one (an apple)', (c) => (has(S('the then we they he she you my your his her our their also not'), c.n) ? 'and' : null))
rule('en', 'and-an', 'and', 'an = one (an apple) · and = plus', (c) => (has(S('is was has had as be with like into get got need needs use uses find found have'), c.p) && has(VOWEL_NOUNS, c.n) ? 'an' : null))
rule('en', 'a-an', 'a an', 'an before a vowel sound (an apple) · a before the rest (a dog)', (c) => {
  if (!c.N || c.N.length < 2 || c.N === c.N.toUpperCase() || c.end || (c.raw === 'A' && !c.first)) return null
  const n = c.n!
  const vowel = /^[aeio]/.test(n) ? !/^(one|once|eu|uni|use|usu|ubi)/.test(n) : /^(un(?!i)|um|up|ul|ug|hour|honest|honor|honour|heir)/.test(n)
  if (c.w === 'a' && vowel) return 'an'
  if (c.w === 'an' && !vowel && !/^[aeiou]/.test(n) && !/^h/.test(n)) return 'a'
  return null
})

rule('en', 'i-cap', "i i'm i'll i've i'd", 'The word "I" is always a capital letter', (c) => (c.raw[0] === 'i' && !(c.t[c.i + 1]?.w.length === 1 && c.end) ? 'I' + c.raw.slice(1) : null))
rule('en', 'apostrophe', 'cant wont ill lets', 'Short forms need an apostrophe', (c) => {
  if (c.w === 'cant' || c.w === 'wont') return has(SUBJ, c.p) || has(VERBS, c.n) ? (c.w === 'cant' ? "can't" : "won't") : null
  if (c.w === 'ill') return has(VERBS, c.n) && !has(S('is was feel felt very so am are be get got'), c.p) ? "I'll" : null
  return has(VERBS, c.n) && (c.first || has(S('so and but ok now then'), c.p)) ? "let's" : null
})

const W_AGREE = 'The verb has to match who does it: I am · you are · he/she/it is · we/they are'
const THIRD: Record<string, string> = { "don't": "doesn't", have: 'has', are: 'is', were: 'was', go: 'goes', do: 'does', want: 'wants', need: 'needs', know: 'knows', think: 'thinks', say: 'says', make: 'makes', take: 'takes', get: 'gets', see: 'sees', come: 'comes' }
rule('en', 'agree-3rd', Object.keys(THIRD).join(' '), W_AGREE, (c) => (has(S('he she it'), c.p) && NO_INV(c) ? THIRD[c.w] : null))
const PLURAL: Record<string, string> = { is: 'are', was: 'were', has: 'have', does: 'do', "doesn't": "don't", goes: 'go', wants: 'want', needs: 'need' }
rule('en', 'agree-plural', Object.keys(PLURAL).join(' '), W_AGREE, (c) => {
  if (!NO_INV(c)) return null
  if (has(S('we they'), c.p) || (c.p === 'you' && c.w !== 'was')) return PLURAL[c.w]
  if (c.p === 'you' && c.w === 'was') return 'were'
  if (c.p === 'i' && c.w !== 'was') return c.w === 'is' ? 'am' : PLURAL[c.w]
  return null
})
const BASE: Record<string, string> = { went: 'go', came: 'come', took: 'take', gave: 'give', knew: 'know', thought: 'think', told: 'tell', said: 'say', made: 'make', got: 'get', ate: 'eat', ran: 'run', wrote: 'write', spoke: 'speak', broke: 'break', chose: 'choose', fell: 'fall', flew: 'fly', grew: 'grow', drew: 'draw', threw: 'throw', began: 'begin', drank: 'drink', sang: 'sing', swam: 'swim', forgot: 'forget', became: 'become', bought: 'buy', brought: 'bring', caught: 'catch', taught: 'teach', fought: 'fight', kept: 'keep', slept: 'sleep', heard: 'hear', sold: 'sell', sent: 'send', spent: 'spend', built: 'build', paid: 'pay', met: 'meet', understood: 'understand', stood: 'stand', won: 'win', wore: 'wear', woke: 'wake', did: 'do', had: 'have', was: 'be', were: 'be' }
rule('en', 'did-base', Object.keys(BASE).join(' '), 'After did, can, will… the verb stays in its basic form: "didn\'t go", not "didn\'t went"', (c) =>
  has(S("did didn't doesn't don't does can't couldn't won't wouldn't shouldn't"), c.p) ? BASE[c.w] : null,
)
rule('en', 'more-er', 'better worse bigger smaller easier harder faster slower stronger weaker', '"better" already means "more good": one of the two is enough', (c) => (c.p === 'more' ? { fixes: [c.raw], back: 1 } : null))
rule('en', 'much-many', 'much', 'many = things you can count · much = the rest (much water)', (c) => (has(S('people things times enemies players items games levels problems options ideas questions friends hours days years words mistakes errors bugs features'), c.n) ? 'many' : null))
rule('en', 'used-to', 'use suppose', 'It is "used to" and "supposed to", with a d', (c) => (c.n === 'to' && (c.w === 'use' ? has(SUBJ, c.p) || c.p === 'there' : has(BE, c.p) || c.p === 'not') && has(VERBS, c.n2) ? c.w + 'd' : null))

// ───────────────────────── German ─────────────────────────
const D_THINK = S('denke denkt denken glaube glaubt glauben weiß weiss wissen finde findet finden hoffe hofft hoffen sage sagt sagte sagen meine meint meinte meinen sicher klar wichtig bedeutet heißt dachte wusste glaubte merke merkt merkte sehe sieht sah zeigt schön gut schade toll möglich sein bemerkt erklärt verstehe versteht fühlt spürt will möchte wollen erwartet vergessen vergisst gesagt gedacht geglaubt gehofft gewusst gemerkt gesehen erzählt gemeint gehört gelesen geschrieben versprochen behauptet so ohne anstatt außer dadurch dafür darauf daran davon')
const D_ART = S('ich du er sie es wir ihr man der die das ein eine dieser diese dieses mein dein sein unser alle viele nichts jemand niemand kein keine')
const W_DASS = 'das = der/die/das (das Haus) · dass = leitet einen Nebensatz ein (ich denke, dass…). Tipp: passt "dieses" oder "welches"? Dann "das".'
rule('de', 'das-dass', 'das', W_DASS, (c) => {
  if (!c.comma && has(S('und aber oder sondern nur auch'), c.p) && has(S('ich du er wir man es'), c.n)) return 'dass'
  if (!has(D_THINK, c.p) || !has(D_ART, c.n) || c.n === 'das') return null
  if (c.p === 'so') return ['sodass']
  return c.comma || has(S('ohne anstatt außer'), c.p) ? 'dass' : { fixes: [`${c.t[c.i - 1].raw}, dass`], back: 1 }
})
rule('de', 'dass-das', 'dass', W_DASS, (c) =>
  has(S('ist war sind waren kann wird heißt bedeutet macht geht hat soll muss wäre gibt stimmt funktioniert passt klingt sieht'), c.n) || (has(S('in für durch über um an gegen unter hinter neben vor zwischen'), c.p) && isCap(c.N)) ? 'das' : null,
)
const W_SEIT = 'seit = Zeit (seit gestern) · seid = ihr seid (von "sein")'
rule('de', 'seit-seid', 'seit', W_SEIT, (c) => (c.p === 'ihr' && !has(S('gestern heute langem kurzem einem einer zwei drei vielen jahren tagen wochen dem der wann'), c.n) ? 'seid' : c.first && c.n === 'ihr' && c.q ? 'seid' : null))
rule('de', 'seid-seit', 'seid', W_SEIT, (c) => (has(S('gestern heute langem kurzem einem einer zwei drei vier fünf vielen jahren tagen wochen monaten stunden dem der wann damals immer jeher'), c.n) && c.p !== 'ihr' ? 'seit' : null))
rule('de', 'wider-wieder', 'wider', 'wieder = noch einmal · wider = gegen', (c) => (has(S('da mal einmal zurück kommen sehen holen'), c.n) ? 'wieder' : null))
const W_WAHR = 'war = Vergangenheit von "ist" · wahr = stimmt, echt'
rule('de', 'war-wahr', 'war', W_WAHR, (c) => (c.p === 'nicht' && c.end ? 'wahr' : has(S('ist bleibt wird'), c.p) && c.end ? 'wahr' : null))
rule('de', 'wahr-war', 'wahr', W_WAHR, (c) => (has(S('ich er sie es das der die da hier dort dann gestern früher wer was'), c.p) && has(S('ich ein eine der die das sehr nicht schon noch in im auf mal einmal immer ja so'), c.n) ? 'war' : null))
const W_FIEL = 'viel = eine Menge · fiel = Vergangenheit von "fallen"'
rule('de', 'viel-fiel', 'viel', W_FIEL, (c) => (has(S('hin um runter herunter hinunter herab vom ins'), c.n) && has(S('er sie es der die das'), c.p) ? 'fiel' : has(S('mir ihm ihr uns'), c.p) && has(S('auf ein'), c.n) ? 'fiel' : null))
rule('de', 'fiel-viel', 'fiel', W_FIEL, (c) => (has(S('so sehr zu wie ganz ziemlich'), c.p) || has(S('spaß glück erfolg mehr besser zeit geld größer schaden'), c.n) ? 'viel' : null))
const D_PREP = S('in auf für über durch gegen ohne um an unter hinter neben vor mit')
rule('de', 'denn-den', 'denn', 'den = der/die/das (den Hund) · denn = weil', (c) => (has(D_PREP, c.p) ? 'den' : null))
const W_WENN = 'wenn = falls, sobald · wen = welche Person? (Wen siehst du?)'
rule('de', 'wen-wenn', 'wen', W_WENN, (c) => (!c.q && (c.first || has(S('und aber oder nur auch selbst außer immer falls'), c.p)) && has(S('ich du er sie es wir ihr man der die das ein eine dein mein sein jemand alle alles nichts dann nicht also schon möglich'), c.n) ? 'wenn' : null))
rule('de', 'wenn-wen', 'wenn', W_WENN, (c) => (has(S('für an auf gegen über'), c.p) || (c.q && c.first && has(S('hast hat habt haben siehst sieht meinst meint soll willst will kennst kennt magst liebt liebst rufst suchst'), c.n)) ? 'wen' : null))
const W_MANN = 'man = irgendwer, alle (man kann…) · Mann = männliche Person'
const D_MODAL = S('kann muss soll darf sollte könnte braucht hat sieht merkt bekommt kriegt wird will findet nennt sagt')
rule('de', 'man-mann', 'man', W_MANN, (c) => (has(S('ein einen einem eines kein dieser jeder alter junger guter böser starker toter mein dein'), c.p) ? 'Mann' : null))
rule('de', 'mann-man', 'mann', W_MANN, (c) => ((c.first || has(S('wenn dass wie was wo weil ob kann muss soll darf und aber oder dann so hier da damit falls'), c.p)) && has(D_MODAL, c.n) ? (c.first ? 'Man' : 'man') : null))
rule('de', 'isst-ist', 'isst', 'ist = von "sein" · isst = von "essen"', (c) => (has(S('wichtig möglich klar egal schwer leicht einfach schön groß klein neu alt richtig falsch fertig cool toll super okay ok schlecht besser stark schwach tot kaputt weg vorbei dabei der die das'), c.n) ? 'ist' : null))
const W_IHM = 'ihm / ihn = eine Person (gib ihm, ich sehe ihn) · im / in = ein Ort (im Haus, in der Stadt)'
rule('de', 'im-ihm', 'im', W_IHM, (c) => (has(S('gib gibt gab sag sagt sagte hilf hilft half zeig zeigt zeigte folgt folge gehört glaubt glaube dankt schenkt bringt bring erzählt vertraut vertraue antwortet von bei zu mit'), c.p) && (c.end || !isCap(c.N)) ? 'ihm' : has(S('leid egal gefällt gehört hilft passt weh wehtut'), c.n) ? 'ihm' : null))
rule('de', 'ihm-im', 'ihm', W_IHM, (c) => (has(S('haus spiel wald dorf level kampf raum inventar menü jahr moment game vergleich gegensatz notfall prinzip grunde allgemeinen laufe rahmen bereich hintergrund vordergrund falle sinne'), c.n) && isCap(c.N) ? 'im' : null))
rule('de', 'ihn-in', 'ihn', W_IHM, (c) => (has(S('der dem einem einer diesem dieser meinem meiner seinem seiner'), c.n) ? 'in' : null))
rule('de', 'in-ihn', 'in', W_IHM, (c) => (c.end && c.i === c.t.length - 1 && c.i > 1 && !has(S('check log'), c.p) ? 'ihn' : null))
const W_TOD = 'der Tod = das Sterben (Nomen, groß, mit d) · tot = nicht mehr lebendig (mit t)'
rule('de', 'tot-tod', 'tot', W_TOD, (c) => (has(S('den dem zum vom seinen seinem ihren ihrem meinen deinen einen keinen eigenen sicheren schnellen'), c.p) ? 'Tod' : null))
rule('de', 'tod-tot', 'tod', W_TOD, (c) => (has(S('ist war sind waren bin bist seid wäre bleibt schon fast nicht sofort gleich längst bereits halb'), c.p) && (c.end || has(S('und oder aber ist war sein bin'), c.n)) ? 'tot' : null))
const W_STADT = 'die Stadt = Ort mit vielen Häusern · statt = anstelle von'
rule('de', 'statt-stadt', 'statt', W_STADT, (c) => (c.raw === 'statt' && has(S('die der einer eine diese dieser jede jeder zur unsere meine ganze große kleine alte neue nächste erste letzte'), c.p) && c.n !== 'dessen' ? 'Stadt' : null))
rule('de', 'stadt-statt', 'stadt', W_STADT, (c) => ((c.first || has(S('und aber oder sondern dass er sie es ich wir kann'), c.p)) && has(S('zu dessen einer eines einem des'), c.n) ? (c.n === 'dessen' ? { fixes: ['stattdessen'], fwd: 1 } : 'statt') : null))
rule('de', 'wie-als', 'wie', 'Beim Vergleichen: größer als · so groß wie', (c) => (has(S('größer kleiner besser schlechter mehr weniger schneller langsamer stärker schwächer höher niedriger älter jünger länger kürzer schwerer leichter schöner teurer billiger wichtiger öfter lieber eher'), c.p) ? 'als' : null))
rule('de', 'dativ', 'die das', 'Nach mit, bei, von, aus, nach, seit, zu kommt der Dativ: dem · der · den', (c) => (has(S('mit bei von aus nach seit zu'), c.p) && isCap(c.N) && !/sten$/.test(c.n2 ?? '') ? (c.w === 'das' ? 'dem' : ['der', 'den']) : null))
rule('de', 'akkusativ', 'dem der', 'Nach für, ohne, durch, gegen kommt der Akkusativ: den · die · das', (c) => (has(S('für ohne durch gegen'), c.p) && isCap(c.N) ? (c.w === 'dem' ? ['den', 'das'] : ['die', 'den']) : null))
rule('de', 'komma', 'dass weil obwohl falls bevor nachdem sodass ob', 'Vor dass, weil, obwohl, ob, falls, bevor, nachdem steht ein Komma', (c) =>
  !c.first && !c.comma && c.p && !has(S('und oder aber sondern auch nur selbst außer als immer so ohne anstatt statt besonders allem erst gerade schon denn kurz lange direkt je also doch na ja vielleicht eben wie genau einfach beispiel'), c.p) ? { fixes: [`${c.t[c.i - 1].raw}, ${c.raw}`], back: 1 } : null,
)
const W_D_AGREE = 'Das Verb passt zur Person: ich bin/habe · du bist/hast · er/sie/es ist/hat · wir sind/haben'
const D_FORMS: Record<string, Record<string, string>> = {
  ich: { bist: 'bin', ist: 'bin', sind: 'bin', seid: 'bin', hast: 'habe', hat: 'habe', habt: 'habe' },
  du: { bin: 'bist', ist: 'bist', sind: 'bist', seid: 'bist', habe: 'hast', hat: 'hast', haben: 'hast' },
  er: { bin: 'ist', bist: 'ist', sind: 'ist', seid: 'ist', habe: 'hat', hast: 'hat', haben: 'hat', habt: 'hat' },
  wir: { bin: 'sind', bist: 'sind', ist: 'sind', seid: 'sind', habe: 'haben', hast: 'haben', hat: 'haben', habt: 'haben' },
}
D_FORMS.es = D_FORMS.man = D_FORMS.er
rule('de', 'de-agree', 'bin bist ist sind seid habe hast hat haben habt', W_D_AGREE, (c) => (c.p && !has(S('wie als und oder'), c.p2) ? D_FORMS[c.p]?.[c.w] : null))

// ───────────────────────── both ─────────────────────────
const DOUBLE_OK = S('had that die der das sie is so very ha no bye bla na ja')
const UI_DOUBLE = { en: 'The same word twice', de: 'Zweimal das gleiche Wort' }
const UI_CAP = { en: 'A sentence starts with a capital letter', de: 'Ein Satz beginnt mit einem großen Buchstaben' }

const RULE_WORD = /[\p{L}\p{M}][\p{L}\p{M}'’]*/gu

/** The rule hits in one sentence. `prose` = the paragraph has full sentences, so capital letters at the start are checked. */
export function checkRules(sentence: string, lang: Lang, off: ReadonlySet<string> = new Set(), prose = false): RuleHit[] {
  const t: Tok[] = [...sentence.matchAll(RULE_WORD)].map((m) => ({ raw: m[0], w: m[0].toLowerCase().replace(/’/g, "'"), from: m.index, to: m.index + m[0].length, end: false, comma: false }))
  t.forEach((tok, i) => {
    const gap = sentence.slice(tok.to, t[i + 1]?.from ?? sentence.length)
    tok.end = i === t.length - 1 || /[^\s]/.test(gap)
    if (t[i + 1]) t[i + 1].comma = /[,;:–—(]/.test(gap)
  })
  const q = /\?\s*$/.test(sentence)
  const hits: RuleHit[] = []
  let busyTo = -1
  const push = (i: number, id: string, why: string, out: Out) => {
    if (!out || off.has(id)) return false
    const o = typeof out === 'string' ? { fixes: [out] } : Array.isArray(out) ? { fixes: out } : out
    const a = t[i - (o.back ?? 0)]
    const b = t[i + (o.fwd ?? 0)]
    if (a.from < busyTo) return false
    const was = sentence.slice(a.from, b.to)
    // Keep a capital letter the writer typed ("Their is" → "There is").
    const fixes = o.fixes.map((f) => (isCap(was) && !isCap(f) && was !== 'I' ? f[0].toUpperCase() + f.slice(1) : f)).filter((f) => f !== was)
    if (!fixes.length) return false
    hits.push({ from: a.from, to: b.to, fixes, why, rule: id })
    busyTo = b.to
    return true
  }
  t.forEach((tok, i) => {
    if (i > 0 && tok.w === t[i - 1].w && !t[i - 1].end && tok.w.length > 1 && !DOUBLE_OK.has(tok.w) && push(i, 'double', UI_DOUBLE[lang], { fixes: [t[i - 1].raw], back: 1 })) return
    const c: Ctx = { t, i, w: tok.w, raw: tok.raw, p: t[i - 1]?.w, p2: t[i - 2]?.w, n: t[i + 1]?.w, n2: t[i + 2]?.w, N: t[i + 1]?.raw, end: tok.end, first: i === 0, comma: tok.comma, q }
    // Words on the other side of punctuation are not neighbours.
    if (tok.end) c.n = c.n2 = c.N = undefined
    else if (t[i + 1].end) c.n2 = undefined
    if (i > 0 && t[i - 1].end && !tok.comma) c.p = c.p2 = undefined
    for (const r of rules) if (r.lang === lang && r.on.has(tok.w) && push(i, r.id, r.why, r.test(c))) return
    if (i === 0 && prose && tok.raw.length > 1 && /^\p{Ll}+$/u.test(tok.raw) && /^\s*$/.test(sentence.slice(0, tok.from))) push(i, 'cap-start', UI_CAP[lang], tok.raw[0].toUpperCase() + tok.raw.slice(1))
  })
  return hits
}

/** Every rule id with one example line, for Settings. */
export const RULE_IDS = [...new Set(rules.map((r) => r.id)), 'double', 'cap-start']
