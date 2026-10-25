import { Channel, invoke } from '@tauri-apps/api/core'
import { isTauri } from '../fs'
import { deviceIdForKey, fromBase64Url, type ServerCode } from './protocol'
import type { CollabTransport, ConnId, TransportEvent } from './transport'

/**
 * Connects to an EVLMG Designer Server (0.8) over a WebSocket.
 * The first text message is the key; the server answers `auth-ok` (or
 * `auth-error`), then protocol v1 runs unchanged in binary messages. Text
 * messages after that are control messages (the plugins the server offers).
 *
 * The desktop app connects from Rust (`src-tauri/src/server_link.rs`) so a
 * self-signed server can be pinned by its certificate fingerprint; `npm run dev`
 * uses the browser's WebSocket.
 */

export interface ServerWelcome {
  serverId: string
  serverName: string
  /** The app's project id once someone uploaded the project; null while it is empty. */
  projectId: string | null
  serverProjectId: string
  projectName: string
  role: 'view' | 'write'
  empty: boolean
}

export interface ServerPlugin {
  id: string
  name: string
  version: string
  description: string
  sha256: string
  size: number
}

/** Why the server refused the key: `bad-key` (unknown or revoked), `expired`, `closed` (project closed), `busy`. */
export class ServerAuthError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(serverErrorText(reason))
    this.reason = reason
  }
}

export function serverErrorText(reason: string): string {
  switch (reason) {
    case 'bad-key':
      return 'The server does not accept this connect code (any more). Ask its admin for a new one.'
    case 'expired':
      return 'Your connect code has expired. Ask the server’s admin for a new one.'
    case 'closed':
      return 'This project is closed on the server.'
    case 'busy':
      return 'This connect code is already in use on too many devices.'
    default:
      return 'The server refused the connection.'
  }
}

export interface ServerHooks {
  /** Before the `connected` event: the server accepted the key. */
  authenticated?(welcome: ServerWelcome): void
  authError?(error: ServerAuthError): void
}

interface Link {
  sendBinary(data: Uint8Array): Promise<void>
  sendText(text: string): Promise<void>
  close(): Promise<void>
}

interface LinkEvents {
  text(text: string): void
  binary(data: Uint8Array): void
  closed(reason?: string): void
}

const KIND_BINARY = 2
const KIND_CLOSED = 3
const KIND_TEXT = 4

async function openLink(code: ServerCode, events: LinkEvents): Promise<Link> {
  if (isTauri()) {
    const channel = new Channel<ArrayBuffer>()
    const decoder = new TextDecoder()
    channel.onmessage = (raw) => {
      const bytes = new Uint8Array(raw)
      if (bytes.length < 5) return
      const payload = bytes.subarray(5)
      if (bytes[0] === KIND_BINARY) events.binary(payload.slice())
      else if (bytes[0] === KIND_TEXT) events.text(decoder.decode(payload))
      else if (bytes[0] === KIND_CLOSED) events.closed(decoder.decode(payload) || undefined)
    }
    const conn = await invoke<number>('server_connect', { url: code.url, fingerprint: code.fingerprint, onEvent: channel })
    return {
      sendBinary: (data) => invoke('server_send', data, { headers: { 'x-conn': String(conn) } }),
      sendText: (text) => invoke('server_send_text', { conn, text }),
      close: () => invoke('server_close', { conn }),
    }
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(code.url)
    ws.binaryType = 'arraybuffer'
    let open = false
    ws.onopen = () => {
      open = true
      resolve({
        sendBinary: async (data) => ws.send(data as Uint8Array<ArrayBuffer>),
        sendText: async (text) => ws.send(text),
        close: async () => ws.close(),
      })
    }
    ws.onmessage = (e) => (typeof e.data === 'string' ? events.text(e.data) : events.binary(new Uint8Array(e.data as ArrayBuffer)))
    ws.onerror = () => {
      if (!open) reject(new Error('Could not reach the server.'))
    }
    ws.onclose = (e) => (open ? events.closed(e.reason || undefined) : reject(new Error('Could not reach the server.')))
  })
}

export class ServerTransport implements CollabTransport {
  readonly kind = 'server' as const
  readonly code: ServerCode
  /** What the server said when it accepted the key (last connection). */
  welcome: ServerWelcome | null = null
  private readonly hooks: ServerHooks
  private onEvent: ((e: TransportEvent) => void) | null = null
  private readonly links = new Map<ConnId, Link>()
  private readonly waiters: { type: string; resolve: (m: Record<string, unknown>) => void }[] = []
  private nextConn = 1

  constructor(code: ServerCode, hooks: ServerHooks = {}) {
    this.code = code
    this.hooks = hooks
  }

  async start(onEvent: (e: TransportEvent) => void) {
    this.onEvent = onEvent
    return deviceIdForKey(this.code.key)
  }

  /** Invites are made on the server's admin page, not in the app. */
  async address() {
    return this.code.url
  }

  async connect(): Promise<ConnId> {
    const conn = this.nextConn++
    let authed = false
    let settle!: { resolve: (c: ConnId) => void; reject: (e: Error) => void }
    const result = new Promise<ConnId>((resolve, reject) => (settle = { resolve, reject }))
    const link = await openLink(this.code, {
      text: (text) => {
        let m: Record<string, unknown>
        try {
          m = JSON.parse(text) as Record<string, unknown>
        } catch {
          return
        }
        if (authed) return this.onControl(m)
        if (m.type === 'auth-ok') {
          authed = true
          this.welcome = m as unknown as ServerWelcome
          this.links.set(conn, link)
          this.hooks.authenticated?.(this.welcome)
          this.onEvent?.({ type: 'connected', conn, remoteId: this.welcome.serverId })
          settle.resolve(conn)
        } else {
          const error = new ServerAuthError(String(m.reason ?? ''))
          this.hooks.authError?.(error)
          settle.reject(error)
        }
      },
      binary: (data) => {
        if (authed) this.onEvent?.({ type: 'message', conn, data })
      },
      closed: (reason) => {
        if (this.links.delete(conn)) this.onEvent?.({ type: 'closed', conn, reason })
        if (!authed) settle.reject(new Error('The server closed the connection.'))
      },
    })
    await link.sendText(JSON.stringify({ type: 'auth', key: this.code.key }))
    return result
  }

  async send(conn: ConnId, data: Uint8Array) {
    const link = this.links.get(conn)
    if (!link) throw new Error('not connected')
    await link.sendBinary(data)
  }

  async disconnect(conn: ConnId) {
    const link = this.links.get(conn)
    if (!link) return
    this.links.delete(conn)
    await link.close()
    this.onEvent?.({ type: 'closed', conn })
  }

  async stop() {
    for (const conn of [...this.links.keys()]) await this.disconnect(conn)
    this.onEvent = null
  }

  // ---- plugins the server offers ------------------------------------------------

  /** The plugins installed on the server. */
  async plugins(): Promise<ServerPlugin[]> {
    const reply = await this.control({ type: 'plugins' })
    return (reply.plugins as ServerPlugin[] | undefined) ?? []
  }

  /** One plugin's zip; checked against the fingerprint the list announced. */
  async pluginZip(plugin: ServerPlugin): Promise<Uint8Array> {
    const reply = await this.control({ type: 'plugin', id: plugin.id })
    if (reply.missing || typeof reply.zip !== 'string') throw new Error(`The server no longer has ${plugin.name}.`)
    const bytes = fromBase64Url(reply.zip.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
    const hex = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('')
    if (hex !== plugin.sha256) throw new Error(`${plugin.name} changed on the server while downloading. Try again.`)
    return bytes
  }

  private control(message: { type: string; [k: string]: unknown }): Promise<Record<string, unknown>> {
    const link = [...this.links.values()][0]
    if (!link) return Promise.reject(new Error('Not connected to the server.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The server did not answer.')), 30_000)
      this.waiters.push({
        type: message.type,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m)
        },
      })
      link.sendText(JSON.stringify(message)).catch(reject)
    })
  }

  private onControl(m: Record<string, unknown>) {
    const i = this.waiters.findIndex((w) => w.type === m.type)
    if (i >= 0) this.waiters.splice(i, 1)[0].resolve(m)
  }
}
