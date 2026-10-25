import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import type * as Y from 'yjs'
import { SCHEMA_VERSION } from '../model'
import {
  decodeJson,
  encodeBytes,
  encodeJson,
  hello,
  joinProof,
  MSG,
  PROTOCOL_VERSION,
  verifyJoinProof,
  type Closed,
  type Hello,
  type Invite,
  type Reject,
  type Welcome,
} from './protocol'
import type { CollabSession, Member } from './session'
import type { CollabTransport, ConnId, TransportEvent } from './transport'

/** What this device shows to others. */
export interface Profile {
  name: string
  color: string
}

/** One connected device. Used as the Yjs transaction origin for its changes. */
export interface Peer {
  readonly conn: ConnId
  readonly remoteId: string
  outgoing: boolean
  name: string
  color: string
  sentWelcome: boolean
  gotWelcome: boolean
  ready: boolean
  closed: boolean
  /** Awareness client ids this peer told us about. */
  clients: Set<number>
}

export interface JoinRequest {
  deviceId: string
  name: string
}

export type NetworkMode =
  | {
      kind: 'member'
      session: CollabSession
      onJoinRequest(request: JoinRequest): Promise<boolean>
      /** Work through an EVLMG Designer server at this address instead of with members directly. */
      server?: string
    }
  | { kind: 'join'; invite: Invite }

export interface NetworkEvents {
  /** The list of ready peers changed. */
  peers?(peers: Peer[]): void
  /** First full sync with someone finished (joining waits for this). */
  synced?(peer: Peer): void
  /** The other side refused us (or we refused them). */
  rejected?(reason: Reject, peer: Peer, byUs: boolean): void
  /** A peer said it is leaving, or (as host) ending the shared project. */
  closed?(message: Closed, peer: Peer): void
}

type Handler = (peer: Peer, payload: Uint8Array) => void

const RECONNECT_MS = 15_000

/**
 * Runs the collaboration protocol over a transport: handshake (version,
 * project, membership or invite + approval), Yjs sync and awareness.
 * Asset transfer plugs in with `on()`.
 */
export class CollabNetwork {
  readonly awareness: awarenessProtocol.Awareness
  selfId = ''
  /** View-only access on a server: never send changes (the server would refuse them anyway). */
  readOnly = false
  private readonly peers = new Map<ConnId, Peer>()
  private readonly outgoing = new Set<ConnId>()
  private readonly dialing = new Set<string>()
  private readonly handlers = new Map<number, Handler>()
  private reconnectTimer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private syncedOnce = false
  private readonly transport: CollabTransport
  private readonly doc: Y.Doc
  private readonly mode: NetworkMode
  private readonly events: NetworkEvents
  private profile: Profile

  constructor(transport: CollabTransport, doc: Y.Doc, mode: NetworkMode, profile: Profile, events: NetworkEvents = {}) {
    this.transport = transport
    this.doc = doc
    this.mode = mode
    this.profile = profile
    this.events = events
    this.awareness = new awarenessProtocol.Awareness(doc)
  }

  async start() {
    this.selfId = await this.transport.start((e) => this.onTransport(e))
    this.awareness.setLocalStateField('user', { id: this.selfId, ...this.profile })
    this.doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
    if (this.mode.kind === 'member') {
      this.reconnect()
      this.reconnectTimer = setInterval(() => this.reconnect(), RECONNECT_MS)
    } else {
      await this.dial(this.mode.invite.address)
    }
  }

  async stop() {
    if (this.stopped) return
    this.stopped = true
    if (this.reconnectTimer) clearInterval(this.reconnectTimer)
    this.doc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'local')
    this.awareness.destroy()
    await this.transport.stop().catch(() => {})
    this.peers.clear()
  }

  /** Tell everyone connected that we leave (or end the project), and give the message a moment to arrive. */
  async sayGoodbye(reason: Closed['reason']) {
    const peers = this.readyPeers()
    for (const peer of peers) this.send(peer, encodeJson(MSG.closed, { reason } satisfies Closed))
    if (peers.length) await new Promise((r) => setTimeout(r, 400))
  }

  setProfile(profile: Profile) {
    this.profile = profile
    this.awareness.setLocalStateField('user', { id: this.selfId, ...profile })
  }

  address() {
    return this.transport.address()
  }

  readyPeers(): Peer[] {
    return [...this.peers.values()].filter((p) => p.ready && !p.closed)
  }

  on(type: number, handler: Handler) {
    this.handlers.set(type, handler)
  }

  send(peer: Peer, data: Uint8Array) {
    if (peer.closed) return
    this.transport.send(peer.conn, data).catch(() => this.drop(peer))
  }

  /** Dial a device (an invite address or a member id). */
  async dial(address: string) {
    if (this.dialing.has(address)) return
    this.dialing.add(address)
    try {
      const conn = await this.transport.connect(address)
      this.outgoing.add(conn)
      const peer = this.peers.get(conn)
      if (peer) peer.outgoing = true
    } finally {
      this.dialing.delete(address)
    }
  }

  /** Dial every known member we are not connected to. */
  reconnect() {
    if (this.mode.kind !== 'member' || this.stopped) return
    if (this.mode.server) {
      if (this.peers.size === 0) this.dial(this.mode.server).catch(() => {})
      return
    }
    const connected = new Set([...this.peers.values()].map((p) => p.remoteId))
    for (const m of this.mode.session.members) {
      if (m.id !== this.selfId && !connected.has(m.id)) this.dial(m.id).catch(() => {})
    }
  }

  /** Disconnect a device (e.g. removed from the project). */
  dropDevice(id: string) {
    for (const peer of [...this.peers.values()]) if (peer.remoteId === id) this.drop(peer)
  }

  /** After the member list changed: disconnect devices that are no longer in it. */
  dropNonMembers() {
    if (this.mode.kind !== 'member' || this.mode.server) return
    const members = new Set(this.mode.session.members.map((m) => m.id))
    for (const peer of this.readyPeers()) if (!members.has(peer.remoteId)) this.drop(peer)
  }

  // ---- transport events -----------------------------------------------------

  private onTransport(e: TransportEvent) {
    if (this.stopped) return
    if (e.type === 'connected') {
      const peer: Peer = {
        conn: e.conn,
        remoteId: e.remoteId,
        outgoing: this.outgoing.has(e.conn),
        name: '',
        color: '',
        sentWelcome: false,
        gotWelcome: false,
        ready: false,
        closed: false,
        clients: new Set(),
      }
      this.peers.set(e.conn, peer)
      void this.sendHello(peer)
    } else if (e.type === 'closed') {
      const peer = this.peers.get(e.conn)
      if (peer) this.forget(peer)
    } else {
      const peer = this.peers.get(e.conn)
      if (peer && e.data.length > 0) this.onMessage(peer, e.data[0], e.data.subarray(1))
    }
  }

  private async sendHello(peer: Peer) {
    const base = { deviceId: this.selfId, name: this.profile.name, color: this.profile.color }
    if (this.mode.kind === 'member') {
      const info = this.mode.session.shareInfo
      if (!info) return
      this.send(peer, encodeJson(MSG.hello, hello({ ...base, projectId: info.projectId })))
    } else {
      const { invite } = this.mode
      // A server checks the key instead; there is no invite secret.
      const proof = invite.secret ? await joinProof(invite.secret, invite.projectId, this.selfId, peer.remoteId) : undefined
      this.send(peer, encodeJson(MSG.hello, hello({ ...base, projectId: invite.projectId, joinProof: proof })))
    }
  }

  private onMessage(peer: Peer, type: number, payload: Uint8Array) {
    try {
      switch (type) {
        case MSG.hello:
          void this.onHello(peer, decodeJson<Hello>(payload))
          return
        case MSG.welcome:
          decodeJson<Welcome>(payload)
          peer.gotWelcome = true
          this.maybeReady(peer)
          return
        case MSG.reject:
          this.events.rejected?.(decodeJson<Reject>(payload), peer, false)
          this.drop(peer)
          return
        case MSG.sync:
          if (peer.ready) this.onSync(peer, payload)
          return
        case MSG.awareness:
          if (peer.ready) awarenessProtocol.applyAwarenessUpdate(this.awareness, payload, peer)
          return
        case MSG.closed:
          if (peer.ready) this.events.closed?.(decodeJson<Closed>(payload), peer)
          this.drop(peer)
          return
        default:
          if (peer.ready) this.handlers.get(type)?.(peer, payload)
      }
    } catch (error) {
      console.error('Bad message from peer', error)
      this.drop(peer)
    }
  }

  private async onHello(peer: Peer, h: Hello) {
    peer.name = String(h.name ?? '').slice(0, 60)
    peer.color = String(h.color ?? '')
    const reject = (reason: Reject['reason']) => {
      const r: Reject = { reason, protocol: PROTOCOL_VERSION, schema: SCHEMA_VERSION }
      this.send(peer, encodeJson(MSG.reject, r))
      this.events.rejected?.({ reason, protocol: h.protocol, schema: h.schema }, peer, true)
      setTimeout(() => this.drop(peer), 500)
    }
    if (h.protocol !== PROTOCOL_VERSION || h.schema !== SCHEMA_VERSION) return reject('version')
    if (h.deviceId !== peer.remoteId) return reject('not-member')

    if (this.mode.kind === 'join') {
      if (h.projectId !== this.mode.invite.projectId) return reject('project')
    } else {
      const { session } = this.mode
      const info = session.shareInfo
      if (!info || h.projectId !== info.projectId) return reject('project')
      // Through a server, the only peer is the server, which the transport authenticated (key and certificate).
      if (!this.mode.server && !session.members.some((m) => m.id === h.deviceId)) {
        if (!h.joinProof) return reject('not-member')
        if (!(await verifyJoinProof(h.joinProof, info.secret, info.projectId, h.deviceId, this.selfId))) return reject('bad-invite')
        const allowed = await this.mode.onJoinRequest({ deviceId: h.deviceId, name: peer.name || 'Someone' })
        if (peer.closed) return
        if (!allowed) return reject('denied')
        const member: Member = { id: h.deviceId, name: peer.name || 'Someone', color: peer.color, joinedAt: new Date().toISOString() }
        session.setMembers([...session.members.filter((m) => m.id !== member.id), member])
      }
    }
    const projectName =
      this.mode.kind === 'join' ? this.mode.invite.projectName : String((this.mode.session.read('meta') as { name?: string })?.name ?? '')
    const projectId = h.projectId
    this.send(peer, encodeJson(MSG.welcome, { projectId, projectName } satisfies Welcome))
    peer.sentWelcome = true
    this.maybeReady(peer)
  }

  private maybeReady(peer: Peer) {
    if (peer.ready || !peer.sentWelcome || !peer.gotWelcome || peer.closed) return
    const twin = this.readyPeers().find((p) => p.remoteId === peer.remoteId)
    if (twin) {
      // Both devices dialed each other at once: keep the link dialed by the smaller id.
      const dialer = (p: Peer) => (p.outgoing ? this.selfId : p.remoteId)
      const preferred = this.selfId < peer.remoteId ? this.selfId : peer.remoteId
      const loser = dialer(peer) === preferred && dialer(twin) !== preferred ? twin : peer
      if (loser === peer) {
        this.drop(peer)
        return
      }
      this.drop(twin)
    }
    peer.ready = true
    const encoder = encoding.createEncoder()
    syncProtocol.writeSyncStep1(encoder, this.doc)
    this.send(peer, encodeBytes(MSG.sync, encoding.toUint8Array(encoder)))
    const states = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()])
    this.send(peer, encodeBytes(MSG.awareness, states))
    this.events.peers?.(this.readyPeers())
  }

  private onSync(peer: Peer, payload: Uint8Array) {
    const decoder = decoding.createDecoder(payload)
    const encoder = encoding.createEncoder()
    const kind = syncProtocol.readSyncMessage(decoder, encoder, this.doc, peer)
    if (encoding.length(encoder) > 0 && !this.readOnly) this.send(peer, encodeBytes(MSG.sync, encoding.toUint8Array(encoder)))
    if (kind === syncProtocol.messageYjsSyncStep2) {
      if (!this.syncedOnce) this.syncedOnce = true
      this.events.synced?.(peer)
    }
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (this.readOnly) return
    const encoder = encoding.createEncoder()
    syncProtocol.writeUpdate(encoder, update)
    const message = encodeBytes(MSG.sync, encoding.toUint8Array(encoder))
    for (const peer of this.readyPeers()) if (peer !== origin) this.send(peer, message)
  }

  private readonly onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    const changed = [...added, ...updated, ...removed]
    if (origin && typeof origin === 'object' && 'clients' in origin) {
      const from = origin as Peer
      for (const c of [...added, ...updated]) from.clients.add(c)
      for (const c of removed) from.clients.delete(c)
    }
    const message = encodeBytes(MSG.awareness, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
    for (const peer of this.readyPeers()) if (peer !== origin) this.send(peer, message)
  }

  private drop(peer: Peer) {
    if (peer.closed) return
    this.transport.disconnect(peer.conn).catch(() => {})
    this.forget(peer)
  }

  private forget(peer: Peer) {
    if (peer.closed) return
    const wasReady = peer.ready
    peer.closed = true
    peer.ready = false
    this.peers.delete(peer.conn)
    this.outgoing.delete(peer.conn)
    if (peer.clients.size) awarenessProtocol.removeAwarenessStates(this.awareness, [...peer.clients], 'peer-left')
    if (wasReady) this.events.peers?.(this.readyPeers())
  }
}
