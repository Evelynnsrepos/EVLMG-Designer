import { newId, type Id } from '@/core/model'
import type { Scene } from '@/shared/canvas'
import { seedNewCard, type Card, type CardDoc, type CardNode } from './model'

/** Texts shared by the Card Designer's panels. */
export const TEXT = {
  front: 'Front',
  back: 'Back',
  layers: 'Layers panel',
  addText: 'Text (T): click on the card to type. {Name} shows the card’s value for the field Name.',
  addPicture: 'Picture field: an empty frame that shows each card’s own picture (set it under Fields)',
  addImage: 'Import an image (the same on every card)',
  fixed: 'Fixed colour',
  noSelection: 'Select something on the card to style it. Only the active layer can be selected; Alt+click picks an item on another layer.',
  sheetHint: 'Row 1 holds the field names. Columns named Copies and Variant set those. A field without a column (like a fixed HP) takes its value from the first card of This list.',
  exportHint: 'Print at "actual size" (100 %), not "fit to page". For double-sided printing, flip on the long edge.',
  ttsHint: 'Ready deck: save it in Tabletop Simulator\'s Saved Objects folder (the dialog starts there) and it shows up under Objects > Saved Objects. It works on this computer only; for online games use the ZIP and upload the sheets. ZIP: sheets for Objects > Components > Custom Deck, each file name says the grid and number of cards.',
}

export type Side = 'front' | 'back'
export type Update = (recipe: (x: CardDoc) => CardDoc, options?: { undoable?: boolean }) => void
export type OnScene = (recipe: (s: Scene<CardNode>) => Scene<CardNode>) => void

export const sideScene = (d: CardDoc, side: Side) => (side === 'front' ? d.front : d.back)

/** Own icons by name for `:name:` in text. */
export const ownIcons = (d: CardDoc) => new Map((d.icons ?? []).map((i) => [i.name, i.src]))

export function cardLabel(d: CardDoc, c: Card): string {
  const first = d.fields.find((f) => f.kind === 'text')
  return (first && c.values[first.id]) || 'Card'
}

/** Adds an empty card named "Card N", laid out like card `fromId` (the open one), and returns its id. */
export function addCard(d: CardDoc, update: Update, fromId?: Id | null): Id {
  const id = newId()
  const name = d.fields.find((f) => f.kind === 'text')
  const from = fromId ?? d.cards[0]?.id
  update((x) => seedNewCard({ ...x, cards: [...x.cards, { id, copies: 1, values: name ? { [name.id]: `Card ${x.cards.length + 1}` } : {} }] }, id, from))
  return id
}

/** Every node of a design, both sides and every card's own items (for fonts, pictures and foil). */
export const allNodes = (d: CardDoc): CardNode[] => [
  ...d.front.nodes,
  ...d.back.nodes,
  ...Object.values(d.overrides ?? {}).flatMap((o) => Object.values(o.nodes ?? {}).flat()),
]
