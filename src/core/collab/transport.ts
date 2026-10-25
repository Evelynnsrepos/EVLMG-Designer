/**
 * The only thing the collaboration protocol needs from the network: open
 * authenticated connections to other devices and move bytes. iroh (desktop),
 * BroadcastChannel (browser dev mode) and an in-memory hub (tests) implement
 * it, and `serverTransport.ts` connects to an EVLMG Designer server.
 */
export type ConnId = number

export type TransportEvent =
  | { type: 'connected'; conn: ConnId; remoteId: string }
  | { type: 'message'; conn: ConnId; data: Uint8Array }
  | { type: 'closed'; conn: ConnId; reason?: string }

export interface CollabTransport {
  readonly kind: 'iroh' | 'browser' | 'memory' | 'server'
  /** Start listening. Returns this device's id, which other devices dial. */
  start(onEvent: (event: TransportEvent) => void): Promise<string>
  /** Full address to put in an invite (may be just the id). */
  address(): Promise<string>
  /** Dial a device by address or id. A `connected` event follows on both sides. */
  connect(address: string): Promise<ConnId>
  send(conn: ConnId, data: Uint8Array): Promise<void>
  disconnect(conn: ConnId): Promise<void>
  stop(): Promise<void>
}

/** The device id inside an address (iroh address JSON or a bare id). */
export function idOfAddress(address: string): string {
  const trimmed = address.trim()
  if (!trimmed.startsWith('{')) return trimmed
  try {
    const parsed = JSON.parse(trimmed) as { id?: unknown }
    return typeof parsed.id === 'string' ? parsed.id : trimmed
  } catch {
    return trimmed
  }
}
