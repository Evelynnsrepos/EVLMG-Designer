import * as Y from 'yjs'
import { create } from 'zustand'
import { getFs, isTauri, safeFolderName } from '../fs'
import { ENTITY_TYPES, type Category, type Entity, type EntityType, type ProjectMeta } from '../model'
import {
  defaultProjectsDir,
  projectPaths,
  saveCategories,
  saveCollection,
  saveMeta,
  writeDocument,
} from '../project'
import {
  addProjectLifecycleHook,
  collabNames,
  flushAll,
  parseDocumentName,
  setCollabBinding,
  sharedMeta,
  useProjectStore,
  type SharedMeta,
} from '../state'
import { AssetSync } from './assetSync'
import { attachPresence } from './presence'
import { invalidate, readTop } from './bridge'
import { BrowserTransport } from './browserTransport'
import { CollabNetwork, type JoinRequest, type Peer, type Profile } from './network'
import { decodeInvite, decodeServerCode, encodeInvite, encodeServerCode, isServerCode, newSecret, type Invite, type Reject, type ServerCode } from './protocol'
import { CollabSession, type Member } from './session'
import { ServerAuthError, ServerTransport, type ServerPlugin, type ServerWelcome } from './serverTransport'
import { TauriTransport } from './tauriTransport'
import type { CollabTransport } from './transport'

/**
 * Starts and stops collaboration with the open project, and offers the
 * actions the UI needs: share, invite, join, stop sharing.
 */

export interface ConnectedPeer {
  id: string
  name: string
  color: string
}

interface CollabState {
  /** The open project is shared. */
  shared: boolean
  /** Networking is running for it. */
  online: boolean
  selfId: string
  peers: ConnectedPeer[]
  members: Member[]
  /** Last problem worth showing, in plain words. */
  error: string | null
  profile: Profile
  /** This device shared the project: only the host can remove people, and closing the project ends it for everyone. */
  isHost: boolean
  hostId: string
  /** The host ended the shared project; the shell asks whether to keep this computer's copy. */
  ended: { root: string; projectName: string; host: string } | null
  /** Working through an EDG server (0.8) instead of peer to peer. */
  server: { name: string; role: 'view' | 'write' } | null
  /** Plugins the server offers (the shell compares them with what is installed and asks). */
  serverPlugins: ServerPlugin[]
}

const PROFILE_KEY = 'egd.collab.profile'
const COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#e03131', '#0c8599', '#f08c00', '#c2255c']

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>
      if (typeof p.name === 'string' && typeof p.color === 'string') return { name: p.name, color: p.color }
    }
  } catch {
    // No storage (tests, private mode): use a fresh profile.
  }
  return { name: '', color: COLORS[Math.floor(Math.random() * COLORS.length)] }
}

export const useCollab = create<CollabState>()(() => ({
  shared: false,
  online: false,
  selfId: '',
  peers: [],
  members: [],
  error: null,
  profile: loadProfile(),
  isHost: false,
  hostId: '',
  ended: null,
  server: null,
  serverPlugins: [],
}))

function updateRoles(session: CollabSession, selfId = useCollab.getState().selfId) {
  const hostId = session.hostId ?? ''
  useCollab.setState({ hostId, isHost: !!selfId && hostId === selfId })
}

export const PROFILE_COLORS = COLORS

/** Your name and color as others see them. */
export function setProfile(profile: Profile) {
  useCollab.setState({ profile })
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {
    // Not saved, still used for this session.
  }
  active?.network.setProfile(profile)
}

// ---- transports ---------------------------------------------------------------

let makeTransport: () => CollabTransport = () => (isTauri() ? new TauriTransport() : new BrowserTransport())

/** Tests use an in-memory transport. */
export function setTransportFactory(factory: () => CollabTransport) {
  makeTransport = factory
}

// ---- asking the owner -----------------------------------------------------------

let askToJoin: (request: JoinRequest) => Promise<boolean> = async () => false

/** The shell shows a dialog: "Mia wants to join this project". */
export function setJoinRequestHandler(handler: (request: JoinRequest) => Promise<boolean>) {
  askToJoin = handler
}

// ---- the running session --------------------------------------------------------

interface Active {
  session: CollabSession
  network: CollabNetwork
  assets: AssetSync
  unsubscribe: () => void
  /** Set when working through a server. */
  server: ServerTransport | null
}
let active: Active | null = null

export function activeSession(): CollabSession | null {
  return active?.session ?? null
}

/** Awareness of the running session, for presence (cursors, who is where). */
export function activeAwareness() {
  return active?.network.awareness ?? null
}

/**
 * Live rich text for a document field of the open shared project, or null
 * when the project is not shared. See `CollabSession.richText`.
 */
export function sharedRichText(name: string, seedKey: string, seed: (fragment: Y.XmlFragment) => void) {
  const a = active
  if (!a) return null
  return { fragment: a.session.richText(name, seedKey, seed), awareness: a.network.awareness }
}

async function goOnline(session: CollabSession, code: ServerCode | null = null) {
  const server = code
    ? new ServerTransport(code, {
        authenticated: (w) => onServerWelcome(w),
        authError: (e) => onServerRefused(session, code, e),
      })
    : null
  const network = new CollabNetwork(
    server ?? makeTransport(),
    session.doc,
    { kind: 'member', session, onJoinRequest: (r) => askToJoin(r), server: code?.url },
    useCollab.getState().profile,
    {
      peers: (peers) => {
        useCollab.setState({ peers: peers.map(describe) })
        active?.assets.scanSoon()
      },
      rejected: (reason, peer, byUs) => {
        if (!byUs) useCollab.setState({ error: rejectMessage(reason, peer) })
      },
      closed: (message, peer) => {
        // Only the host can end the project for everyone (on a server: its admin).
        const fromHost = server ? true : peer.remoteId === session.hostId
        if (message.reason !== 'host-closed' || !fromHost || useCollab.getState().isHost) return
        const projectName = useProjectStore.getState().meta?.name ?? ''
        const host = peer.name || session.members.find((m) => m.id === peer.remoteId)?.name || 'The host'
        void goOffline().then(() => useCollab.setState({ ended: { root: session.root, projectName, host } }))
      },
    },
  )
  const assets = new AssetSync(network, session.doc, session.root)
  const unsubscribe = session.onChange((names) => {
    if (!names.has('members') && !names.has('share')) return
    useCollab.setState({ members: session.members })
    updateRoles(session)
    network.dropNonMembers()
  })
  active = { session, network, assets, unsubscribe, server }
  useCollab.setState({ shared: true, members: session.members, error: null, server: code && { name: code.serverName, role: 'write' } })
  try {
    await network.start()
    attachPresence(network.awareness)
    useCollab.setState({ online: true, selfId: network.selfId })
    updateRoles(session, network.selfId)
  } catch (error) {
    console.error('Collaboration could not start', error)
    useCollab.setState({ online: false, error: 'Could not start the connection. Your changes are saved and will sync later.' })
  }
}

async function goOffline() {
  const a = active
  active = null
  setCollabBinding(null)
  useCollab.setState({ shared: false, online: false, peers: [], members: [], error: null, isHost: false, hostId: '', server: null, serverPlugins: [] })
  attachPresence(null)
  if (!a) return
  a.unsubscribe()
  a.assets.stop()
  await a.network.stop()
  await a.session.close()
}

function describe(p: Peer): ConnectedPeer {
  return { id: p.remoteId, name: p.name || 'Someone', color: p.color }
}

let installed = false

/** Called once at startup: shared projects go online when they open. */
export function installCollaboration() {
  if (installed) return
  installed = true
  addProjectLifecycleHook({
    async opened(root) {
      if (!(await CollabSession.isShared(root))) return
      const session = await CollabSession.load(root)
      const restored = await projectPaths.collabRestored(root)
      if (await getFs().exists(restored)) {
        const { meta, entities, categories } = useProjectStore.getState()
        if (meta) await session.replaceWithFiles({ meta, entities, categories })
        await getFs().remove(restored)
      }
      setCollabBinding(session)
      session.pullAll()
      void goOnline(session, await readServerCode(root))
    },
    async closing() {
      // The host closing the project ends it for everyone who is connected.
      if (useCollab.getState().isHost) await active?.network.sayGoodbye('host-closed')
      await goOffline()
    },
  })
}

// ---- actions for the UI ------------------------------------------------------------

/** Share the open project (if it is not yet) and return an invite code. */
export async function shareProject(): Promise<string> {
  if (!active) {
    const { root, meta, entities, categories } = useProjectStore.getState()
    if (!root || !meta) throw new Error('No project is open')
    // Everything on disk is copied into the shared state, so write pending edits first.
    await flushAll(root)
    const session = await CollabSession.create(root, { meta, entities, categories }, { projectId: meta.id, secret: newSecret() }, null)
    setCollabBinding(session)
    await goOnline(session)
    const { selfId, profile } = useCollab.getState()
    if (selfId) {
      session.setShareInfo({ ...session.shareInfo!, hostId: selfId })
      session.setMembers([{ id: selfId, name: profile.name, color: profile.color, joinedAt: new Date().toISOString() }])
      updateRoles(session, selfId)
    }
  }
  return inviteCode()
}

/** An invite code for the shared project, made from this device's address. */
export async function inviteCode(): Promise<string> {
  const a = active
  if (!a) throw new Error('This project is not shared')
  if (a.server) throw new Error('New people get a connect code from the server’s admin page.')
  const info = a.session.shareInfo!
  const meta = useProjectStore.getState().meta
  const address = await a.network.address()
  return encodeInvite({ projectId: info.projectId, projectName: meta?.name ?? '', address, secret: info.secret })
}

/** Make a new invite code; codes given out before stop working. */
export async function newInviteCode(): Promise<string> {
  const a = active
  if (!a) throw new Error('This project is not shared')
  a.session.setShareInfo({ ...a.session.shareInfo!, secret: newSecret() })
  return inviteCode()
}

/** Remove a device: it can no longer connect (it keeps its own copy). Only the host can, and never the host. */
export function removeMember(id: string) {
  const a = active
  if (!a || !useCollab.getState().isHost || id === a.session.hostId) return
  a.session.setMembers(a.session.members.filter((m) => m.id !== id))
  a.network.dropDevice(id)
}

/**
 * Stop sharing on this computer; the project stays here as a normal project.
 * The host ends the shared project for everyone; anyone else leaves it.
 */
export async function stopSharingHere() {
  const a = active
  const root = a?.session.root
  if (a) {
    if (useCollab.getState().isHost) await a.network.sayGoodbye('host-closed')
    else {
      // Leave for good: off the member list, so nobody keeps trying to reach this computer.
      const self = useCollab.getState().selfId
      a.session.setMembers(a.session.members.filter((m) => m.id !== self))
      await a.network.sayGoodbye('left')
    }
  }
  await goOffline()
  if (root) await forgetSharing(root)
}

/** Turn a formerly shared project folder into a normal one (after the host ended it, or after leaving). */
export async function forgetSharing(root: string) {
  const dir = await projectPaths.collabDir(root)
  if (await getFs().exists(dir)) await getFs().remove(dir)
  useCollab.setState({ ended: null })
}

/** Dismiss the "host ended the project" question without deciding (e.g. the dialog closed). */
export function clearEnded() {
  useCollab.setState({ ended: null })
}

// ---- joining -------------------------------------------------------------------------

export interface JoinHandle {
  /** Resolves with the new project's folder once everything arrived. */
  done: Promise<string>
  cancel(): void
}

/** An invite code (peer to peer) or a server connect code. */
export function parseInvite(code: string): Invite | null {
  if (isServerCode(code)) {
    const c = decodeServerCode(code)
    return c && { projectId: '', projectName: c.projectName, address: c.url, secret: '' }
  }
  return decodeInvite(code)
}

/**
 * Join a shared project from an invite code. Waits until the owner allows it
 * and the project arrived, writes it into a new folder under `parentDir` and
 * returns that folder (open it with `useProjectStore.getState().open`).
 */
export function joinProject(code: string, parentDir?: string, onWaiting?: () => void): JoinHandle {
  const serverCode = isServerCode(code) ? decodeServerCode(code) : null
  const invite = parseInvite(code)
  if (!invite) return { done: Promise.reject(new Error('That is not a valid invite code.')), cancel() {} }
  const doc = new Y.Doc()
  doc.on('afterTransaction', invalidate)
  let cancelled = false
  let network: CollabNetwork | null = null
  let settle: { resolve: (root: string) => void; reject: (e: Error) => void } | null = null

  const done = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject }
    const transport = serverCode
      ? new ServerTransport(serverCode, {
          authenticated: (w) => {
            // The server tells us the project's id; an empty project has nothing to join yet.
            if (!w.projectId || w.empty) reject(new Error(EMPTY_SERVER_PROJECT))
            else invite.projectId = w.projectId
          },
        })
      : makeTransport()
    network = new CollabNetwork(transport, doc, { kind: 'join', invite }, useCollab.getState().profile, {
      peers: () => onWaiting?.(),
      rejected: (reason, peer, byUs) => reject(new Error(rejectMessage(reason, peer, byUs))),
      synced: () => {
        if (cancelled) return
        void writeJoinedProject(doc, invite, parentDir)
          .then(async (root) => {
            if (serverCode) await writeServerCode(root, serverCode)
            return root
          })
          .then(resolve, reject)
      },
    })
    network.start().catch((error) => {
      console.error(error)
      if (serverCode) reject(error instanceof ServerAuthError ? error : new Error('Could not reach the server. Check your internet connection or ask its admin.'))
      else reject(new Error('Could not reach the person who invited you. Check that they have the project open.'))
    })
  })
  const finished = done.finally(() => network?.stop())
  finished.catch(() => {})
  return {
    done: finished,
    cancel() {
      cancelled = true
      settle?.reject(new Error('Cancelled'))
    },
  }
}

async function writeJoinedProject(doc: Y.Doc, invite: Invite, parentDir?: string): Promise<string> {
  const shared = readTop(doc, collabNames.meta) as SharedMeta | undefined
  if (!shared) throw new Error('The project did not arrive completely. Please try again.')
  const fs = getFs()
  const parent = parentDir ?? (await defaultProjectsDir())
  await fs.mkdir(parent)
  const base = safeFolderName(shared.name || invite.projectName)
  let root = await fs.join(parent, base)
  for (let n = 2; await fs.exists(root); n++) root = await fs.join(parent, `${base} (${n})`)

  await fs.mkdir(root)
  await fs.mkdir(await projectPaths.entitiesDir(root))
  await fs.mkdir(await projectPaths.imagesDir(root))
  await fs.mkdir(await projectPaths.audioDir(root))
  const meta: ProjectMeta = { ...shared, layout: null, sidebarCollapsed: false }
  await saveMeta(root, meta)
  for (const type of ENTITY_TYPES) {
    await saveCollection(root, type as EntityType, ((readTop(doc, collabNames.entities(type)) as Entity[]) ?? []) as never)
  }
  await saveCategories(root, (readTop(doc, collabNames.categories) as Category[]) ?? [])
  for (const name of doc.share.keys()) {
    const parsed = parseDocumentName(name)
    const value = parsed && readTop(doc, name)
    if (parsed && value !== undefined) await writeDocument(root, parsed.type, parsed.id, value)
  }
  const session = new CollabSession(root, doc)
  await session.saveNow()
  return root
}

export function rejectMessage(reason: Reject, peer?: Peer, byUs = false): string {
  const who = peer?.name || 'The other person'
  switch (reason.reason) {
    case 'version':
      return byUs
        ? `${who} uses a different version of the app. Both of you need the same version to work together.`
        : `${who} uses a different version of the app. Please both update to the latest version.`
    case 'project':
      return 'That invite is for a different project.'
    case 'not-member':
      return `${who} does not have you in this project any more. Ask for a new invite code.`
    case 'denied':
      return `${who} did not let you in.`
    case 'bad-invite':
      return 'This invite code is no longer valid. Ask for a new one.'
    case 'duplicate':
      return 'Already connected.'
  }
}

/** For tests: the shared meta of the open project. */
export function sharedMetaOfOpenProject(): SharedMeta | null {
  const meta = useProjectStore.getState().meta
  return meta ? sharedMeta(meta) : null
}

// ---- working through a server (0.8) -------------------------------------------------

const EMPTY_SERVER_PROJECT =
  'This project on the server is still empty. Someone who can edit has to move a project there first (Work together → Move to a server).'

/** The connect code is personal (it holds the key), so it is kept next to the project, never in the shared state. */
async function serverCodePath(root: string) {
  return getFs().join(await projectPaths.collabDir(root), 'server.json')
}

async function readServerCode(root: string): Promise<ServerCode | null> {
  const fs = getFs()
  const path = await serverCodePath(root)
  if (!(await fs.exists(path))) return null
  try {
    return decodeServerCode((JSON.parse(await fs.readText(path)) as { code: string }).code)
  } catch {
    return null
  }
}

async function writeServerCode(root: string, code: ServerCode) {
  const fs = getFs()
  await fs.mkdir(await projectPaths.collabDir(root))
  await fs.writeTextAtomic(await serverCodePath(root), JSON.stringify({ code: encodeServerCode(code) }))
}

function onServerWelcome(w: ServerWelcome) {
  const a = active
  if (!a?.server) return
  a.network.readOnly = w.role === 'view'
  useCollab.setState({ server: { name: w.serverName, role: w.role }, error: null })
  void a.server
    .plugins()
    .then((serverPlugins) => active === a && useCollab.setState({ serverPlugins }))
    .catch(() => {})
}

/** The server no longer accepts the key (revoked, expired) or closed the project. */
function onServerRefused(session: CollabSession, code: ServerCode, error: ServerAuthError) {
  const a = active
  if (!a || a.session !== session) return
  if (error.reason === 'closed') {
    const projectName = useProjectStore.getState().meta?.name ?? ''
    void goOffline().then(() => useCollab.setState({ ended: { root: session.root, projectName, host: code.serverName || 'The server' } }))
    return
  }
  // Stop retrying: a refused key does not come back.
  void a.network.stop()
  useCollab.setState({ online: false, error: error.message })
}

/** Connect once to read what the server says about a code (role, empty project, ids). */
async function probeServer(code: ServerCode): Promise<ServerWelcome> {
  const transport = new ServerTransport(code)
  await transport.start(() => {})
  try {
    await transport.connect()
    return transport.welcome!
  } finally {
    await transport.stop()
  }
}

/**
 * Move the open project to a server: it is uploaded into an empty server project, and from then on this
 * computer syncs through the server. A project shared peer to peer stops being shared that way: if this
 * computer is the host, teammates are told the project closed here and get connect codes from the server's admin.
 */
export async function moveToServer(codeText: string) {
  const code = decodeServerCode(codeText)
  if (!code) throw new Error('That is not a server connect code. It starts with EGS1-.')
  const { root, meta, entities, categories } = useProjectStore.getState()
  if (!root || !meta) throw new Error('No project is open')
  const welcome = await probeServer(code)
  if (welcome.role !== 'write') throw new Error('This connect code can only view. Moving a project needs a code that can edit.')
  const projectId = active?.session.shareInfo?.projectId ?? meta.id
  if (!welcome.empty && welcome.projectId !== projectId)
    throw new Error('This project on the server already holds a different project. To open it, use Join project on the start screen.')

  let session: CollabSession
  if (active) {
    const a = active
    await a.network.sayGoodbye(useCollab.getState().isHost ? 'host-closed' : 'left')
    active = null
    a.unsubscribe()
    a.assets.stop()
    attachPresence(null)
    await a.network.stop()
    session = a.session
  } else {
    await flushAll(root)
    session = await CollabSession.create(root, { meta, entities, categories }, { projectId, secret: newSecret() }, null)
    setCollabBinding(session)
  }
  // The server is the host now: only its admin removes people or closes the project.
  session.setShareInfo({ ...session.shareInfo!, hostId: welcome.serverId })
  session.setMembers([])
  await session.saveNow()
  await writeServerCode(root, code)
  await goOnline(session, code)
}

/** Download a plugin the server offers (the shell checks it and shows the plugin warning before installing). */
export async function downloadServerPlugin(plugin: ServerPlugin): Promise<Uint8Array> {
  if (!active?.server) throw new Error('Not connected to a server.')
  return active.server.pluginZip(plugin)
}
