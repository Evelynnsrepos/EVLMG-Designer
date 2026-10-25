import { SCHEMA_VERSION } from '../model'

/**
 * Wire format between two devices: one type byte, then the payload.
 * Bump PROTOCOL_VERSION on incompatible changes; peers with a different
 * version (or project schema) refuse to sync instead of corrupting data.
 */
export const PROTOCOL_VERSION = 1

export const MSG = {
  /** JSON Hello, both sides send it first. */
  hello: 0,
  /** JSON Welcome: the other side accepted us. */
  welcome: 1,
  /** JSON Reject, followed by disconnect. */
  reject: 2,
  /** y-protocols sync message. */
  sync: 3,
  /** y-protocols awareness update (who is here, cursors). */
  awareness: 4,
  /** JSON AssetRequest. */
  assetRequest: 5,
  /** u32 header length, JSON AssetChunk header, then bytes. */
  assetChunk: 6,
  /** JSON Closed: the sender is leaving the shared project (or, as host, ending it). */
  closed: 7,
} as const

export interface Closed {
  /** `host-closed`: the host closed the project or stopped sharing, everyone is disconnected. `left`: the sender left for good. */
  reason: 'host-closed' | 'left'
}

export interface Hello {
  protocol: number
  schema: number
  projectId: string
  /** Must equal the id the transport authenticated. */
  deviceId: string
  name: string
  color: string
  /** Set when asking to join with an invite: HMAC proving the invite secret is known. */
  joinProof?: string
}

export type RejectReason = 'version' | 'project' | 'not-member' | 'denied' | 'bad-invite' | 'duplicate'

export interface Reject {
  reason: RejectReason
  /** The newer side's protocol/schema, for "please update". */
  protocol?: number
  schema?: number
}

export interface Welcome {
  projectId: string
  projectName: string
}

export interface AssetRequest {
  path: string
}

export interface AssetChunk {
  path: string
  offset: number
  total: number
  /** Set when the other device does not have the file. */
  missing?: boolean
}

export const hello = (h: Omit<Hello, 'protocol' | 'schema'>): Hello => ({ protocol: PROTOCOL_VERSION, schema: SCHEMA_VERSION, ...h })

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeJson(type: number, value: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(value))
  const out = new Uint8Array(body.length + 1)
  out[0] = type
  out.set(body, 1)
  return out
}

export function encodeBytes(type: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 1)
  out[0] = type
  out.set(body, 1)
  return out
}

export function decodeJson<T>(payload: Uint8Array): T {
  return JSON.parse(decoder.decode(payload)) as T
}

export function encodeAssetChunk(header: AssetChunk, bytes: Uint8Array): Uint8Array {
  const head = encoder.encode(JSON.stringify(header))
  const out = new Uint8Array(1 + 4 + head.length + bytes.length)
  out[0] = MSG.assetChunk
  new DataView(out.buffer).setUint32(1, head.length)
  out.set(head, 5)
  out.set(bytes, 5 + head.length)
  return out
}

export function decodeAssetChunk(payload: Uint8Array): { header: AssetChunk; bytes: Uint8Array } {
  const len = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0)
  const header = JSON.parse(decoder.decode(payload.subarray(4, 4 + len))) as AssetChunk
  return { header, bytes: payload.subarray(4 + len) }
}

// ---- invites ---------------------------------------------------------------

export interface Invite {
  projectId: string
  projectName: string
  /** Address of the device that made the invite. */
  address: string
  secret: string
}

const INVITE_PREFIX = 'EGD1-'

export function encodeInvite(invite: Invite): string {
  const json = JSON.stringify({ p: invite.projectId, n: invite.projectName, a: invite.address, s: invite.secret })
  return INVITE_PREFIX + toBase64Url(encoder.encode(json))
}

/** Accepts the code with or without the egd://join/ link prefix and stray spaces. */
export function decodeInvite(code: string): Invite | null {
  let text = code.trim().replace(/\s+/g, '')
  const link = text.indexOf('join/')
  if (text.startsWith('egd://') && link >= 0) text = decodeURIComponent(text.slice(link + 5))
  if (!text.startsWith(INVITE_PREFIX)) return null
  try {
    const raw = JSON.parse(decoder.decode(fromBase64Url(text.slice(INVITE_PREFIX.length)))) as Record<string, unknown>
    const { p, n, a, s } = raw
    if (typeof p !== 'string' || typeof n !== 'string' || typeof a !== 'string' || typeof s !== 'string') return null
    return { projectId: p, projectName: n, address: a, secret: s }
  } catch {
    return null
  }
}

export function newSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

/** Proves knowledge of the invite secret without sending it, bound to both devices. */
export async function joinProof(secret: string, projectId: string, joinerId: string, hostId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', fromBase64Url(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`egd-join|${projectId}|${joinerId}|${hostId}`) as BufferSource)
  return toBase64Url(new Uint8Array(sig))
}

export async function verifyJoinProof(proof: string, secret: string, projectId: string, joinerId: string, hostId: string) {
  const expected = await joinProof(secret, projectId, joinerId, hostId)
  if (expected.length !== proof.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ proof.charCodeAt(i)
  return diff === 0
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ---- server connect codes (EVLMG Designer Server, 0.8) ------------------

/** What a server's connect code holds. The key is personal: it never goes into the shared project. */
export interface ServerCode {
  /** WebSocket address, e.g. `wss://games.example.com/sync`. */
  url: string
  /** SHA-256 of the server's own certificate (self-signed servers), lowercase hex. */
  fingerprint: string | null
  /** The project on the server. */
  serverProjectId: string
  projectName: string
  serverName: string
  key: string
}

const SERVER_PREFIX = 'EGS1-'

export function isServerCode(code: string): boolean {
  return code.trim().startsWith(SERVER_PREFIX)
}

export function decodeServerCode(code: string): ServerCode | null {
  const text = code.trim().replace(/\s+/g, '')
  if (!text.startsWith(SERVER_PREFIX)) return null
  try {
    const raw = JSON.parse(decoder.decode(fromBase64Url(text.slice(SERVER_PREFIX.length)))) as Record<string, unknown>
    const { u, f, p, n, s, k } = raw
    if (typeof u !== 'string' || !/^wss?:\/\//.test(u) || typeof p !== 'string' || typeof k !== 'string' || !k.startsWith('egd-key-')) return null
    if (f !== null && f !== undefined && (typeof f !== 'string' || !/^[0-9a-f]{64}$/.test(f))) return null
    return { url: u, fingerprint: (f as string | null | undefined) ?? null, serverProjectId: p, projectName: String(n ?? ''), serverName: String(s ?? ''), key: k }
  } catch {
    return null
  }
}

export function encodeServerCode(c: ServerCode): string {
  const json = JSON.stringify({ u: c.url, f: c.fingerprint, p: c.serverProjectId, n: c.projectName, s: c.serverName, k: c.key })
  return SERVER_PREFIX + toBase64Url(encoder.encode(json))
}

/** The device id for a key, the same as the server computes: `k-` + the first 32 hex digits of its SHA-256. */
export async function deviceIdForKey(key: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(key) as BufferSource))
  return 'k-' + [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Asset paths peers may ask for: `assets/<images|audio>/<uuid>.<ext>`, nothing else. */
export const ASSET_PATH = /^assets\/(images|audio)\/[0-9a-fA-F-]{36}\.[a-z0-9]{1,5}$/
