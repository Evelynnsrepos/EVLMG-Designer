import { chromium, type Browser } from 'playwright-core'

/**
 * Chrome or Chromium for the GPU tests (WebGL2 through SwiftShader, so no graphics card is needed).
 * MATERIAL_TEST_BROWSER can point at a browser; null when none is found.
 */
export async function launchTestBrowser(): Promise<Browser | null> {
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  const tries = [
    process.env.MATERIAL_TEST_BROWSER && { executablePath: process.env.MATERIAL_TEST_BROWSER },
    { executablePath: '/opt/pw-browsers/chromium' },
    { channel: 'chrome' },
    { channel: 'chromium' },
  ].filter(Boolean) as object[]
  for (const t of tries) {
    try {
      return await chromium.launch({ ...t, args })
    } catch {
      // try the next one
    }
  }
  return null
}
