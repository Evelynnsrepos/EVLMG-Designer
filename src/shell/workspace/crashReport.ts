import { getFs, isTauri } from '@/core/fs'
import { gpuInfo } from '@/shared/gpu'

/** A tool crashed (0.31.1): the text for Copy report, the crash log and the GitHub issue. Nothing is sent by itself. */
export async function crashReport(tool: string, error: Error, componentStack = ''): Promise<string> {
  let version = 'browser'
  if (isTauri()) version = await import('@tauri-apps/api/app').then((m) => m.getVersion()).catch(() => 'unknown')
  let graphics = 'unknown'
  try {
    const g = gpuInfo()
    graphics = `${g.renderer}${g.software ? ' (software)' : ''}${g.webgl2 ? '' : ', no WebGL2'}`
  } catch {
    // a broken graphics stack must not stop the report
  }
  return [
    `Tool: ${tool}`,
    `App version: ${version}`,
    `System: ${navigator.userAgent}`,
    `Graphics: ${graphics}`,
    `Time: ${new Date().toISOString()}`,
    '',
    `Error: ${error.message}`,
    (error.stack ?? '').split('\n').slice(0, 15).join('\n'),
    componentStack.trim().split('\n').slice(0, 10).join('\n'),
  ].join('\n').trim()
}

/** Kept in the app data folder, newest last; trimmed to about the last 200 KB. */
const LOG_MAX = 200_000

export async function logCrash(report: string): Promise<void> {
  const fs = getFs()
  const path = await fs.join(await fs.appDataDir(), 'crash.log')
  const old = (await fs.exists(path)) ? await fs.readText(path).catch(() => '') : ''
  await fs.writeTextAtomic(path, `${old}\n----\n${report}\n`.slice(-LOG_MAX))
}

/** A new-issue page with the report filled in; the person reads it and decides whether to send it. */
export function issueUrl(repo: string, tool: string, report: string): string {
  const body = `What were you doing when it happened?\n\n\n\`\`\`\n${report.slice(0, 2000)}\n\`\`\``
  return `${repo}/issues/new?title=${encodeURIComponent(`${tool} crashed`)}&body=${encodeURIComponent(body)}`
}
