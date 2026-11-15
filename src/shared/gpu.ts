/** Which graphics card the webview draws with (0.24; moved out of the drawing test so the theme can use it). */
export interface GpuInfo {
  renderer: string
  /** The picture is drawn without the graphics card (llvmpipe and the like). */
  software: boolean
  webgl2: boolean
}

export function gpuInfo(): GpuInfo {
  const c = document.createElement('canvas')
  const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null
  if (!gl) return { renderer: 'No WebGL', software: true, webgl2: false }
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  let renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
  // WebKit (the Linux and Mac web engine) names every graphics card "Apple GPU" to hide which one it is.
  if (renderer === 'Apple GPU' && !/Mac|iPhone|iPad/.test(navigator.userAgent)) renderer = 'Graphics card (the web engine hides its name)'
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return { renderer, software: isSoftwareRenderer(renderer), webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext }
}

export const isSoftwareRenderer = (renderer: string) => /llvmpipe|softpipe|swiftshader|software|swrast/i.test(renderer)
