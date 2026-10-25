import type { Id } from '@/core/model'
import { normalizeSettings, type BrushDef, type BrushLibrary, type BrushSet, type BrushSettings } from './brushes'

/**
 * The default brush library: sets and brushes, all made from the built-in
 * shapes and grains. Ids are fixed so built-ins can be reset and new ones
 * reach existing users. (Nothing here runs at load time: brushes.ts imports
 * this file and the other way round.)
 */

type S = Partial<BrushSettings>
type Def = [id: string, name: string, settings: S]

// Starting points per family; each brush changes a few things.
const pencil: S = { shape: 'pencil', grain: 'paper', grainDepth: 0.6, hardness: 0.7, pressureSize: 0.4, pressureOpacity: 0.85, flow: 0.65, streamline: 0.15, spacing: 0.1 }
const ink: S = { hardness: 1, pressureSize: 0.85, streamline: 0.5, taperStart: 20, taperEnd: 30, spacing: 0.04 }
const paint: S = { flow: 0.6, hardness: 0.7, pressureSize: 0.45, pressureOpacity: 0.55, streamline: 0.2, spacing: 0.06 }
const wet: S = { ...paint, dilution: 0.35, charge: 0.7, pull: 0.45, attack: 0.7 }
const water: S = { shape: 'watercolor', flow: 0.35, hardness: 0.3, wetEdges: 0.6, pressureSize: 0.4, pressureOpacity: 0.7, opacity: 0.85, spacing: 0.08, grain: 'watercolor', grainDepth: 0.35, streamline: 0.15 }
const charcoal: S = { shape: 'charcoal', grain: 'charcoal', grainDepth: 0.75, flow: 0.8, hardness: 0.6, pressureSize: 0.35, pressureOpacity: 0.8, rotation: 'random', spacing: 0.08, streamline: 0.1 }
const air: S = { hardness: 0, pressureSize: 0.15, pressureOpacity: 0.9, streamline: 0.2, spacing: 0.06 }
const marker: S = { opacity: 0.7, hardness: 0.85, pressureSize: 0.15, streamline: 0.3, renderMode: 'uniform-glaze', spacing: 0.06 }
const letter: S = { hardness: 1, streamline: 0.6, stabilization: 0.2, spacing: 0.04 }
const texture: S = { rotation: 'random', randomize: true, spacing: 0.3, pressureSize: 0.3, pressureOpacity: 0.5 }
const comic: S = { hardness: 1, streamline: 0.55, spacing: 0.04 }
const nature: S = { rotation: 'random', randomize: true, sizeJitter: 0.5, scatter: 0.6, spacing: 0.4, pressureSize: 0.5, stampPreview: false }
const pixel: S = { shape: 'square', hardness: 1, pressureSize: 0, streamline: 0, spacing: 0.05, alphaThreshold: 0.5, shapeFiltering: 'none', rotation: 0 }
const blender: S = { dilution: 0, charge: 0, pull: 0.9, attack: 0.6, flow: 0.6, hardness: 0.4, pressureSize: 0.3, pressureOpacity: 0.7, spacing: 0.06 }

const SETS: [setId: string, name: string, icon: string, brushes: Def[]][] = [
  [
    'sketching',
    'Sketching',
    'pencil',
    [
      ['hb-pencil', 'HB Pencil', { size: 5, opacity: 0.85, flow: 0.55, shape: 'chalk', hardness: 0.7, grain: 'paper', grainDepth: 0.55, pressureSize: 0.5, pressureOpacity: 0.8, streamline: 0.15, spacing: 0.12 }],
      ['6b-pencil', '6B Pencil', { size: 10, opacity: 0.95, flow: 0.7, shape: 'chalk', hardness: 0.6, grain: 'paper', grainDepth: 0.75, pressureSize: 0.5, pressureOpacity: 0.9, streamline: 0.1 }],
      ['sketch-pen', 'Sketch Pen', { size: 4, hardness: 1, pressureSize: 0.7, streamline: 0.35, taperStart: 20, taperEnd: 20, spacing: 0.06 }],
      ['2h-pencil', '2H Pencil', { ...pencil, size: 3.5, opacity: 0.6, flow: 0.5, grainDepth: 0.45 }],
      ['mechanical-pencil', 'Mechanical Pencil', { ...pencil, size: 3, hardness: 0.85, pressureSize: 0.15, opacity: 0.8 }],
      ['soft-graphite', 'Soft Graphite', { ...pencil, size: 14, grain: 'rough', grainDepth: 0.7, flow: 0.55, tiltSize: 0.6, tiltOpacity: 0.4 }],
      ['graphite-stick', 'Graphite Stick', { ...pencil, size: 26, shape: 'charcoal', grain: 'rough', roundness: 0.5, rotation: 'follow', tiltSize: 0.8, tiltOpacity: 0.5 }],
      ['colored-pencil', 'Colored Pencil', { ...pencil, size: 7, grain: 'paper', grainDepth: 0.8, flow: 0.75, brightJitter: 0.04, luminanceBlend: true }],
      ['shading-pencil', 'Shading Pencil', { ...pencil, size: 9, tiltSize: 1, tiltOpacity: 0.7, tiltRoundness: 0.6, azimuth: true, rotation: 0, grainDepth: 0.75 }],
      ['sketch-liner', 'Sketch Liner', { ...pencil, shape: 'round', size: 4, grain: 'none', hardness: 0.95, opacity: 0.55, pressureOpacity: 0.6, streamline: 0.25 }],
    ],
  ],
  [
    'inking',
    'Inking',
    'pen',
    [
      ['studio-pen', 'Studio Pen', { size: 10, hardness: 1, pressureSize: 0.9, streamline: 0.55, taperStart: 30, taperEnd: 40, spacing: 0.05 }],
      ['technical-pen', 'Technical Pen', { size: 6, hardness: 1, pressureSize: 0.15, streamline: 0.6, spacing: 0.05 }],
      ['dry-ink', 'Dry Ink', { size: 14, hardness: 0.95, shape: 'chalk', grain: 'paper', grainDepth: 0.45, pressureSize: 0.8, streamline: 0.4, taperEnd: 25, spacing: 0.06 }],
      ['fine-liner', 'Fine Liner', { ...ink, size: 3, pressureSize: 0.2, taperStart: 4, taperEnd: 4 }],
      ['gel-pen', 'Gel Pen', { ...ink, size: 5, pressureSize: 0.3, taperStart: 6, taperEnd: 8, alphaThreshold: 0.3 }],
      ['ballpoint', 'Ballpoint', { ...ink, size: 3, opacity: 0.85, pressureOpacity: 0.6, pressureSize: 0.2, grain: 'paper', grainDepth: 0.25, taperStart: 0, taperEnd: 0 }],
      ['felt-tip', 'Felt Tip', { ...ink, size: 7, hardness: 0.85, pressureSize: 0.25, taperStart: 0, taperEnd: 0, renderMode: 'uniform-glaze', opacity: 0.95 }],
      ['dip-pen', 'Dip Pen', { ...ink, size: 12, pressureSize: 1, taperStart: 50, taperEnd: 70, taperTip: 0.05, pressureCurve: [{ x: 0, y: 0 }, { x: 0.5, y: 0.3 }, { x: 1, y: 1 }] }],
      ['brush-ink', 'Brush Ink', { ...ink, size: 22, pressureSize: 1, roundness: 0.85, taperStart: 40, taperEnd: 80, tipAnimation: true }],
      ['ink-bleed', 'Ink Bleed', { ...ink, size: 14, shape: 'blob', hardness: 0.8, wetEdges: 0.35, burntEdges: 0.3, opacity: 0.95 }],
      ['fountain-pen', 'Fountain Pen', { ...ink, size: 10, roundness: 0.3, rotation: 40, pressureSize: 0.5, taperStart: 10, taperEnd: 15 }],
      ['thick-liner', 'Thick Liner', { ...ink, size: 28, pressureSize: 0.35, taperStart: 15, taperEnd: 25 }],
    ],
  ],
  [
    'calligraphy',
    'Lettering',
    'type',
    [
      ['chisel', 'Chisel', { size: 24, hardness: 1, roundness: 0.18, rotation: 35, pressureSize: 0.4, streamline: 0.5, spacing: 0.04 }],
      ['brush-pen', 'Brush Pen', { size: 18, hardness: 1, roundness: 0.6, pressureSize: 1, streamline: 0.5, taperStart: 30, taperEnd: 60, spacing: 0.04 }],
      ['monoline', 'Monoline', { ...letter, size: 12, pressureSize: 0 }],
      ['script-brush', 'Script Brush', { ...letter, size: 26, pressureSize: 1, pressureCurve: [{ x: 0, y: 0 }, { x: 0.4, y: 0.15 }, { x: 1, y: 1 }], taperStart: 20, taperEnd: 40 }],
      ['flat-nib', 'Flat Nib', { ...letter, size: 30, roundness: 0.12, rotation: 45, pressureSize: 0.2, shape: 'square' }],
      ['marker-lettering', 'Marker Lettering', { ...letter, ...marker, size: 22, roundness: 0.4, rotation: 30, shape: 'square', hardness: 0.95 }],
      ['chalk-lettering', 'Chalk Lettering', { ...letter, size: 18, shape: 'chalk', grain: 'rough', grainDepth: 0.8, hardness: 0.7, pressureSize: 0.5, rotation: 'random' }],
      ['ribbon', 'Ribbon', { ...letter, size: 34, roundness: 0.1, rotation: 0, azimuth: false, pressureSize: 0.3, hueJitter: 0, taperStart: 25, taperEnd: 25 }],
      ['pointed-pen', 'Pointed Pen', { ...letter, size: 16, pressureSize: 1, taperStart: 15, taperEnd: 30, taperTip: 0.02, pressureCurve: [{ x: 0, y: 0 }, { x: 0.6, y: 0.2 }, { x: 1, y: 1 }] }],
    ],
  ],
  [
    'painting',
    'Painting',
    'brush',
    [
      ['round-brush', 'Round Brush', { size: 40, flow: 0.45, hardness: 0.65, pressureSize: 0.5, pressureOpacity: 0.6, streamline: 0.25, spacing: 0.07 }],
      ['flat-brush', 'Flat Brush', { rotation: 'follow', size: 46, flow: 0.6, shape: 'bristle', hardness: 0.8, pressureSize: 0.4, pressureOpacity: 0.5, streamline: 0.25, spacing: 0.05 }],
      ['gouache', 'Gouache', { height: 0.2, rotation: 'follow', size: 50, flow: 0.8, shape: 'bristle', hardness: 0.7, grain: 'canvas', grainDepth: 0.4, pressureSize: 0.4, pressureOpacity: 0.3, spacing: 0.06 }],
      ['oil-paint', 'Oil Paint', { height: 0.45, rotation: 'follow', ...wet, size: 45, shape: 'bristle', grain: 'canvas', grainDepth: 0.3, grade: 0.3 }],
      ['acrylic', 'Acrylic', { height: 0.3, rotation: 'follow', ...paint, size: 40, shape: 'bristle', flow: 0.85, renderMode: 'intense-glaze', grain: 'canvas', grainDepth: 0.25 }],
      ['bristle-brush', 'Bristle Brush', { rotation: 'follow', ...paint, size: 55, shape: 'bristle', grainMode: 'moving', grain: 'linen', grainDepth: 0.4, grainMovement: 0.9 }],
      ['dry-brush', 'Dry Brush', { rotation: 'follow', ...paint, size: 50, shape: 'dry', flow: 0.8, grain: 'canvas', grainDepth: 0.6, pressureOpacity: 0.7 }],
      ['palette-knife', 'Palette Knife', { ...wet, size: 60, shape: 'square', roundness: 0.25, hardness: 0.95, pull: 0.7, dilution: 0, charge: 0.8, attack: 0.9, pressureSize: 0.2 }],
      ['wet-round', 'Wet Round', { ...wet, size: 36, hardness: 0.5, dilution: 0.45, pull: 0.55, wetBlur: 0.3 }],
      ['tempera', 'Tempera', { ...paint, size: 30, flow: 0.9, renderMode: 'uniform-glaze', shape: 'oval', rotation: 'follow', grain: 'paper', grainDepth: 0.3 }],
      ['impasto', 'Impasto', { height: 0.8, rotation: 'follow', ...wet, size: 50, shape: 'bristle', pull: 0.3, dilution: 0, charge: 0.9, grade: 0.5, burntEdges: 0.25 }],
      ['color-mix', 'Color Mix', { rotation: 'follow', ...paint, size: 40, hueJitter: 0.06, brightJitter: 0.1, satJitter: 0.1, shape: 'bristle' }],
    ],
  ],
  [
    'watercolor',
    'Watercolor',
    'droplet',
    [
      ['wet-wash', 'Wet Wash', { ...water, size: 90, dilution: 0.6, pull: 0.3, charge: 0.6, wetBlur: 0.4, renderMode: 'uniform-glaze' }],
      ['watercolor-round', 'Watercolor Round', { ...water, size: 40 }],
      ['flat-wash', 'Flat Wash', { ...water, size: 80, roundness: 0.3, shape: 'oval', renderMode: 'uniform-glaze', flow: 0.5 }],
      ['color-bleed', 'Color Bleed', { ...water, size: 60, dilution: 0.5, pull: 0.6, wetBlur: 0.6, charge: 0.5, hueJitter: 0.03 }],
      ['granulation', 'Granulation', { ...water, size: 70, grain: 'sand', grainDepth: 0.6, grainBlend: 'multiply' }],
      ['dry-watercolor', 'Dry Watercolor', { rotation: 'follow', ...water, size: 50, shape: 'dry', grain: 'rough', grainDepth: 0.6, wetEdges: 0.3 }],
      ['salt-texture', 'Salt Texture', { ...water, ...texture, size: 90, shape: 'speckle', wetEdges: 0, flow: 0.4, grain: 'none' }],
      ['watercolor-splatter', 'Watercolor Splatter', { ...water, ...texture, size: 120, shape: 'splatter', spacing: 0.8, scatter: 0.8, sizeJitter: 0.6, wetEdges: 0.3 }],
    ],
  ],
  [
    'charcoal',
    'Charcoal & Pastel',
    'flame',
    [
      ['vine-charcoal', 'Vine Charcoal', { ...charcoal, size: 16, opacity: 0.8, flow: 0.6 }],
      ['compressed-charcoal', 'Compressed Charcoal', { ...charcoal, size: 24, flow: 0.95, grainDepth: 0.55 }],
      ['charcoal-block', 'Charcoal Block', { ...charcoal, size: 60, shape: 'square', hardness: 0.6, roundness: 0.35, rotation: 'follow', tiltSize: 0.5 }],
      ['soft-pastel', 'Soft Pastel', { ...charcoal, size: 34, shape: 'chalk', grain: 'rough', grainDepth: 0.8, flow: 0.7, luminanceBlend: true }],
      ['oil-pastel', 'Oil Pastel', { ...charcoal, size: 26, grain: 'paper', grainDepth: 0.5, flow: 0.95, renderMode: 'intense-glaze', pull: 0.15, charge: 0.95 }],
      ['conte', 'Conte Crayon', { ...charcoal, size: 14, shape: 'square', roundness: 0.5, rotation: 'follow', grain: 'paper' }],
      ['smudgy-charcoal', 'Smudgy Charcoal', { ...charcoal, size: 30, pull: 0.5, charge: 0.7, wetBlur: 0.4 }],
      ['chalk-pastel', 'Chalk Pastel', { ...charcoal, size: 22, shape: 'chalk', grain: 'concrete', grainDepth: 0.7, brightJitter: 0.05 }],
    ],
  ],
  [
    'airbrushing',
    'Airbrushing',
    'spray',
    [
      ['soft-airbrush', 'Soft Airbrush', { size: 140, flow: 0.06, hardness: 0, pressureSize: 0.1, pressureOpacity: 0.9, streamline: 0.2, spacing: 0.06 }],
      ['medium-airbrush', 'Medium Airbrush', { size: 70, flow: 0.12, hardness: 0.4, pressureSize: 0.2, pressureOpacity: 0.9, spacing: 0.06 }],
      ['hard-airbrush', 'Hard Airbrush', { size: 50, flow: 0.25, hardness: 0.9, pressureSize: 0.2, pressureOpacity: 0.7, spacing: 0.06 }],
      ['super-soft', 'Super Soft', { ...air, size: 300, flow: 0.03 }],
      ['spray-fade', 'Spray Fade', { ...air, size: 90, flow: 0.1, falloff: 0.8 }],
      ['flat-airbrush', 'Flat Airbrush', { ...air, size: 80, flow: 0.15, renderMode: 'uniform-glaze', hardness: 0.2 }],
      ['mist', 'Mist', { ...air, size: 160, flow: 0.08, grain: 'clouds', grainDepth: 0.7, grainScale: 1.5 }],
    ],
  ],
  [
    'markers',
    'Markers',
    'highlighter',
    [
      ['marker', 'Marker', { size: 28, opacity: 0.65, hardness: 0.85, pressureSize: 0.2, streamline: 0.3 }],
      ['highlighter', 'Highlighter', { size: 30, opacity: 0.45, shape: 'square', hardness: 1, roundness: 0.35, rotation: 0, pressureSize: 0, streamline: 0.5 }],
      ['alcohol-marker', 'Alcohol Marker', { ...marker, size: 24, opacity: 0.55, wetEdges: 0.2, luminanceBlend: true }],
      ['broad-marker', 'Broad Marker', { ...marker, size: 44, shape: 'square', roundness: 0.5, rotation: 0 }],
      ['brush-marker', 'Brush Marker', { ...marker, size: 20, pressureSize: 0.9, taperStart: 20, taperEnd: 30 }],
      ['chisel-marker', 'Chisel Marker', { ...marker, size: 30, shape: 'square', roundness: 0.25, rotation: 45 }],
      ['paint-marker', 'Paint Marker', { ...marker, size: 16, opacity: 1, renderMode: 'heavy-glaze' }],
    ],
  ],
  [
    'textures',
    'Textures',
    'grid',
    [
      ['spray', 'Spray Paint', { size: 60, flow: 0.35, shape: 'splatter', hardness: 1, count: 3, scatter: 0.6, spacing: 0.25, spacingJitter: 0.5, sizeJitter: 0.5, rotation: 'random', pressureSize: 0.3, pressureOpacity: 0.6 }],
      ['chalk', 'Chalk', { size: 30, flow: 0.8, shape: 'chalk', hardness: 0.6, grain: 'noise', grainDepth: 0.8, pressureSize: 0.4, pressureOpacity: 0.6, rotation: 'random' }],
      ['stipple', 'Stipple', { size: 40, flow: 1, shape: 'round', hardness: 1, count: 4, scatter: 1, spacing: 0.9, spacingJitter: 1, sizeJitter: 0.9, pressureSize: 0.3, pressureOpacity: 0 }],
      ['sponge', 'Sponge', { ...texture, size: 70, shape: 'sponge', flow: 0.7 }],
      ['noise-brush', 'Noise', { ...texture, size: 80, grain: 'noise', grainDepth: 1, flow: 0.5, hardness: 0.5, rotation: 'follow', randomize: false }],
      ['concrete', 'Concrete', { ...texture, size: 100, grain: 'concrete', grainDepth: 0.9, hardness: 0.3, flow: 0.5 }],
      ['grit', 'Grit', { ...texture, size: 60, shape: 'speckle', count: 2, scatter: 0.5, flow: 0.8 }],
      ['linen-texture', 'Linen', { ...texture, size: 100, grain: 'linen', grainDepth: 0.9, hardness: 0.2, flow: 0.4, randomize: false }],
      ['wood-grain', 'Wood Grain', { ...texture, size: 100, grain: 'wood', grainDepth: 0.8, grainScale: 2, hardness: 0.3, flow: 0.5, randomize: false }],
      ['sand', 'Sand', { ...texture, size: 90, grain: 'sand', grainDepth: 0.9, hardness: 0.2, flow: 0.45 }],
      ['rough-paper-texture', 'Rough Paper', { ...texture, size: 110, grain: 'rough', grainDepth: 0.9, hardness: 0.2, flow: 0.5 }],
    ],
  ],
  [
    'comics',
    'Comics',
    'book',
    [
      ['comic-inker', 'Comic Inker', { ...comic, size: 12, pressureSize: 0.95, taperStart: 25, taperEnd: 40 }],
      ['feather-brush', 'Feather Brush', { ...comic, size: 20, pressureSize: 1, roundness: 0.8, taperStart: 30, taperEnd: 90, taperTip: 0.02, tipAnimation: true }],
      ['halftone', 'Halftone', { ...comic, size: 80, grain: 'halftone', grainDepth: 1, hardness: 0.6, alphaThreshold: 0.4, pressureSize: 0.2 }],
      ['screen-lines', 'Screen Lines', { ...comic, size: 80, grain: 'lines', grainDepth: 1, hardness: 0.6, alphaThreshold: 0.4, pressureSize: 0.2 }],
      ['crosshatch-tone', 'Crosshatch Tone', { ...comic, size: 80, grain: 'crosshatch', grainDepth: 1, hardness: 0.6, alphaThreshold: 0.4, pressureSize: 0.2 }],
      ['speed-lines', 'Speed Lines', { ...comic, size: 8, pressureSize: 0.5, taperStart: 80, taperEnd: 80, taperTip: 0, streamline: 0.8 }],
      ['panel-liner', 'Panel Liner', { ...comic, size: 6, pressureSize: 0, streamline: 0.9 }],
      ['spot-black', 'Spot Black', { ...comic, size: 60, pressureSize: 0.2 }],
      ['gritty-ink', 'Gritty Ink', { ...comic, size: 14, shape: 'chalk', grain: 'rough', grainDepth: 0.5, pressureSize: 0.8, taperEnd: 30 }],
    ],
  ],
  [
    'elements',
    'Elements',
    'leaf',
    [
      ['clouds', 'Clouds', { ...nature, size: 200, shape: 'cloud', flow: 0.35, spacing: 0.25, scatter: 0.4, pressureOpacity: 0.6 }],
      ['foliage', 'Foliage', { ...nature, size: 60, shape: 'leaf', count: 3, scatter: 0.9, hueJitter: 0.05, brightJitter: 0.15, satJitter: 0.1 }],
      ['grass', 'Grass', { ...nature, size: 70, shape: 'grass', rotation: 0, randomize: false, rotationJitter: 0.05, spacing: 0.25, scatter: 0.3, brightJitter: 0.12, hueJitter: 0.03 }],
      ['leaves', 'Falling Leaves', { ...nature, size: 40, shape: 'leaf', spacing: 1.4, scatter: 1.5, sizeJitter: 0.7, hueJitter: 0.08, brightJitter: 0.15 }],
      ['snow', 'Snow', { ...nature, size: 50, shape: 'snow', spacing: 0.8, scatter: 1.2, flow: 0.8 }],
      ['stars', 'Stars', { ...nature, size: 30, shape: 'star', spacing: 1.6, scatter: 1.8, sizeJitter: 0.8, count: 2, brightJitter: 0.2 }],
      ['rain', 'Rain', { ...nature, size: 50, shape: 'hatch', rotation: 20, randomize: false, roundness: 0.6, spacing: 0.7, scatter: 1.2, flow: 0.5, opacity: 0.7 }],
      ['fur', 'Fur', { ...nature, size: 50, shape: 'fur', rotation: 'follow', randomize: false, spacing: 0.15, scatter: 0.2, flow: 0.6, brightJitter: 0.06 }],
      ['bark', 'Bark', { ...nature, size: 70, shape: 'dry', rotation: 90, randomize: false, grain: 'wood', grainDepth: 0.6, spacing: 0.2, scatter: 0.2, flow: 0.7 }],
      ['bubbles', 'Bubbles', { ...nature, size: 40, shape: 'ring', spacing: 1.3, scatter: 1.6, sizeJitter: 0.8, flow: 0.8 }],
      ['hearts', 'Hearts', { ...nature, size: 34, shape: 'heart', rotation: 'random', rotationJitter: 0.1, spacing: 1.5, scatter: 1.4, hueJitter: 0.04 }],
    ],
  ],
  [
    'blending',
    'Blending',
    'blend',
    [
      ['soft-blender', 'Soft Blender', { ...blender, size: 60, hardness: 0.1 }],
      ['bristle-blender', 'Bristle Blender', { rotation: 'follow', ...blender, size: 50, shape: 'bristle', pull: 0.8 }],
      ['water-brush', 'Water Brush', { ...blender, size: 50, pull: 0.6, wetBlur: 0.7, dilution: 0.5 }],
      ['thick-paint', 'Thick Paint', { ...paint, height: 1, size: 40, shape: 'bristle', rotation: 'follow', flow: 0.95, pressureOpacity: 0.2, grain: 'canvas', grainDepth: 0.2 }],
      ['soft-blur', 'Soft Blur', { ...blender, size: 70, hardness: 0.05, smudgeMode: 'blur', wetBlur: 0.5, opacity: 0.8, pressureOpacity: 0.8 }],
      ['detail-blur', 'Detail Blur', { ...blender, size: 24, hardness: 0.3, smudgeMode: 'blur', wetBlur: 0.25, opacity: 0.7 }],
      ['knife-blender', 'Knife Blender', { ...blender, size: 50, shape: 'square', roundness: 0.25, pull: 0.95, attack: 0.9 }],
    ],
  ],
  [
    'pixel',
    'Pixel Art',
    'square',
    [
      ['pixel-pen', 'Pixel Pen', { ...pixel, size: 1 }],
      ['pixel-square', 'Pixel Square', { ...pixel, size: 4 }],
      ['pixel-round', 'Pixel Round', { ...pixel, shape: 'round', size: 6 }],
      ['dither', 'Dither', { ...pixel, size: 16, grain: 'halftone', grainDepth: 1, grainScale: 0.5, grainFiltering: 'none' }],
    ],
  ],
  [
    'erasers',
    'Erasers',
    'eraser',
    [
      ['hard-eraser', 'Hard Eraser', { size: 40, hardness: 0.95, pressureSize: 0.3 }],
      ['soft-eraser', 'Soft Eraser', { size: 90, hardness: 0, flow: 0.3, pressureSize: 0.2, pressureOpacity: 0.6 }],
      ['textured-eraser', 'Textured Eraser', { size: 40, shape: 'chalk', grain: 'paper', grainDepth: 0.7, hardness: 0.7, pressureSize: 0.4, pressureOpacity: 0.6 }],
      ['pixel-eraser', 'Pixel Eraser', { ...pixel, size: 3 }],
      ['kneaded-eraser', 'Kneaded Eraser', { size: 30, shape: 'blob', hardness: 0.5, flow: 0.4, pressureOpacity: 0.8, rotation: 'random' }],
    ],
  ],
]

/** Built-in brush ids that shipped in v0.5, before Sketch Pro (for adding the new ones to existing libraries). */
export const V05_BUILTIN_IDS: readonly Id[] = [
  'hb-pencil', '6b-pencil', 'sketch-pen', 'studio-pen', 'technical-pen', 'dry-ink', 'chisel', 'brush-pen', 'round-brush', 'flat-brush', 'gouache',
  'soft-airbrush', 'medium-airbrush', 'hard-airbrush', 'marker', 'highlighter', 'spray', 'chalk', 'stipple', 'hard-eraser', 'soft-eraser',
]

export function defaultLibrary(): BrushLibrary {
  const brushes: BrushDef[] = []
  const sets: BrushSet[] = []
  for (const [setId, name, icon, defs] of SETS) {
    sets.push({ id: setId, name, brushIds: defs.map((d) => d[0]), builtIn: true, icon })
    for (const [id, bname, s] of defs) brushes.push({ ...normalizeSettings(s), id, name: bname, builtIn: true, author: 'Eve.Lopment Games' })
  }
  return { sets, brushes, recent: [], pinned: [] }
}

/** Settings of a built-in brush as shipped (for Reset). */
export function builtInBrush(id: Id): BrushDef | undefined {
  return defaultLibrary().brushes.find((b) => b.id === id)
}
