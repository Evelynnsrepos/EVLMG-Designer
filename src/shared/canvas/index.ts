/**
 * Shared canvas engine (work package C1). See README.md in this folder for how
 * canvas components (Story Writer, Timeline, Brainstorm, Moodboard, Map) use it.
 */
export * from './types'
export * from './geometry'
export * from './scene'
export * from './tools'
export { CanvasEditor, useCanvasState, sceneBinding, type CanvasEditorProps, type CanvasState } from './CanvasEditor'
export { CanvasToolbar, type CanvasToolbarProps } from './CanvasToolbar'
export { BUILTIN_NODE_TYPES, CanvasImage, NOTE_COLORS, connectorPoints, measureTextHeight, placeholderPattern, preloadImage, useLoadedImage } from './nodeTypes'
export { useCanvasTheme, readCanvasTheme } from './theme'
export { localToWorld, worldToLocal, type NodeTransform } from './transform'
export { fitWithin, loadImageSize } from './imageSize'
