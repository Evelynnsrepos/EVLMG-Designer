/**
 * Font families to offer in font menus (Draw text layers, the Writer, per-tool fonts): the browser's generic
 * families, the fonts bundled with the app, common system fonts that are really installed, and every local
 * font when the webview lets us list them.
 */

/** 0.22: fonts that ship with the app (`public/fonts/`, see `gameFonts.css`), so every computer has them. */
export const BUNDLED_FONTS = [
  'Lexend Deca', 'Almendra', 'Atkinson Hyperlegible Next', 'Bangers', 'Bebas Neue', 'Cinzel', 'Cinzel Decorative', 'Crimson Pro',
  'EB Garamond', 'Fredoka', 'Grenze Gotisch', 'IM Fell English', 'Luckiest Guy', 'MedievalSharp', 'OpenDyslexic', 'Oswald',
  'Pirata One', 'Press Start 2P', 'Uncial Antiqua',
]

export const GENERIC_FONTS = ['sans-serif', 'serif', 'monospace', 'cursive']

const COMMON_FONTS = [
  'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New',
  'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Ink Free', 'Lucida Console', 'Palatino Linotype', 'Segoe Print', 'Segoe Script',
  'Segoe UI', 'Sitka Text', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Yu Gothic', 'Meiryo', 'MS Gothic', 'Malgun Gothic',
  'Microsoft YaHei', 'Helvetica', 'Helvetica Neue', 'Avenir', 'Futura', 'Gill Sans', 'Menlo', 'Monaco', 'Optima', 'Baskerville', 'Didot',
  'American Typewriter', 'Chalkboard', 'Marker Felt', 'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono', 'Liberation Sans', 'Liberation Serif',
  'Liberation Mono', 'Noto Sans', 'Noto Serif', 'Noto Sans CJK JP', 'Ubuntu', 'Ubuntu Mono', 'Cantarell', 'Fira Sans', 'Roboto', 'Open Sans',
  'Source Sans Pro', 'Inter', 'Lato', 'Montserrat', 'Comfortaa', 'Droid Sans',
]

/** True when `family` is installed: text in it measures differently from every fallback. */
function installed(ctx: CanvasRenderingContext2D, family: string): boolean {
  const sample = 'mmmmmmmmmlli10WQ@'
  return ['monospace', 'serif', 'sans-serif'].some((fb) => {
    ctx.font = `40px ${fb}`
    const base = ctx.measureText(sample).width
    ctx.font = `40px "${family}", ${fb}`
    return ctx.measureText(sample).width !== base
  })
}

let systemCache: string[] | null = null

/** The bundled fonts, then common fonts that are installed on this computer. */
export function systemFonts(): string[] {
  if (systemCache) return systemCache
  const ctx = document.createElement('canvas').getContext('2d')
  systemCache = [...BUNDLED_FONTS, ...(ctx ? COMMON_FONTS.filter((f) => installed(ctx, f)) : [])]
  return systemCache
}

/** Every local font family, where the webview allows it (it may ask the user first). Empty when it can't. */
export async function allLocalFonts(): Promise<string[]> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
  if (!q) return []
  try {
    return [...new Set((await q()).map((f) => f.family))].sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'])

/** A family name as CSS: generic families as they are, others quoted. */
export const cssFamily = (f: string) => (GENERIC.has(f) || f.includes(',') || f.startsWith('"') ? f : `"${f.replace(/"/g, '')}"`)
