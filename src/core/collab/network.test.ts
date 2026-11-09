import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryFs, setFs } from '../fs'
import { setCollabBinding, useProjectStore } from '../state'
import { invalidate, readTop, writeTop } from './bridge'
import { MemoryHub, MemoryTransport } from './memoryTransport'
import { CollabNetwork, type JoinRequest } from './network'
import { decodeInvite, encodeInvite, newSecret, type Reject } from './protocol'
import { CollabSession } from './session'

async function until(check: () => boolean, ms = 2000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const profile = (name: string) => ({ name, color: '#123456' })

describe('collab network', () => {
  let hub: MemoryHub
  const networks: CollabNetwork[] = []

  beforeEach(() => {
    setFs(new MemoryFs())
    hub = new MemoryHub()
  })
  afterEach(async () => {
    for (const n of networks.splice(0)) await n.stop()
    setCollabBinding(null)
    await useProjectStore.getState().close()
  })

  async function host(approve: (r: JoinRequest) => boolean = () => true) {
    await useProjectStore.getState().create({ name: 'Game', description: '', components: ['item-list'] })
    const { root, meta, entities, categories } = useProjectStore.getState()
    const secret = newSecret()
    const session = await CollabSession.create(
      root!,
      { meta: meta!, entities, categories },
      { projectId: meta!.id, secret },
      { id: 'host', name: 'Host', color: '#f00', joinedAt: '' },
    )
    setCollabBinding(session)
    const requests: JoinRequest[] = []
    const net = new CollabNetwork(new MemoryTransport(hub, 'host'), session.doc, {
      kind: 'member',
      session,
      onJoinRequest: async (r) => {
        requests.push(r)
        return approve(r)
      },
    }, profile('Host'))
    networks.push(net)
    await net.start()
    const invite = encodeInvite({ projectId: meta!.id, projectName: meta!.name, address: await net.address(), secret })
    return { session, net, invite, requests }
  }

  async function joiner(code: string, id = 'guest') {
    const doc = new Y.Doc()
    doc.on('afterTransaction', invalidate)
    const invite = decodeInvite(code)!
    const state = { synced: false, rejected: null as Reject | null }
    const net = new CollabNetwork(new MemoryTransport(hub, id), doc, { kind: 'join', invite }, profile('Guest'), {
      synced: () => (state.synced = true),
      rejected: (r, _p, byUs) => {
        if (!byUs) state.rejected = r
      },
    })
    networks.push(net)
    await net.start()
    return { doc, net, state }
  }

  it('lets an invited device join after approval and syncs both ways', async () => {
    const { session, invite, requests } = await host()
    useProjectStore.getState().addEntity('item', 'Sword')
    const guest = await joiner(invite)
    await until(() => guest.state.synced)

    expect(requests).toEqual([{ deviceId: 'guest', name: 'Guest' }])
    expect((readTop(guest.doc, 'entities:item') as { name: string }[]).map((e) => e.name)).toEqual(['Sword'])
    expect(session.members.map((m) => m.id).sort()).toEqual(['guest', 'host'])

    // Guest edits arrive in the host's store.
    guest.doc.transact(() => {
      const list = readTop(guest.doc, 'entities:item') as { id: string; name: string }[]
      writeTop(guest.doc, 'entities:item', list, [...list, { ...list[0], id: 'shield', name: 'Shield' }])
    })
    await until(() => useProjectStore.getState().entities.item.length === 2)

    // Host edits arrive at the guest.
    useProjectStore.getState().addEntity('item', 'Bow')
    await until(() => (readTop(guest.doc, 'entities:item') as unknown[]).length === 3)
  })

  it('refuses a device when the host says no', async () => {
    const { invite, session } = await host(() => false)
    const guest = await joiner(invite)
    await until(() => guest.state.rejected !== null)
    expect(guest.state.rejected!.reason).toBe('denied')
    expect(guest.state.synced).toBe(false)
    expect(session.members.map((m) => m.id)).toEqual(['host'])
  })

  it('refuses an invite with the wrong secret without asking', async () => {
    const { invite, requests } = await host()
    const forged = encodeInvite({ ...decodeInvite(invite)!, secret: newSecret() })
    const guest = await joiner(forged)
    await until(() => guest.state.rejected !== null)
    expect(guest.state.rejected!.reason).toBe('bad-invite')
    expect(requests).toEqual([])
  })

  it('stops old invites working after a new invite code', async () => {
    const { invite, session } = await host()
    session.setShareInfo({ ...session.shareInfo!, secret: newSecret() })
    const guest = await joiner(invite)
    await until(() => guest.state.rejected !== null)
    expect(guest.state.rejected!.reason).toBe('bad-invite')
  })

  it('reconnects members automatically and merges offline edits', async () => {
    const { session, invite } = await host()
    const guest = await joiner(invite)
    await until(() => guest.state.synced)
    await guest.net.stop()

    // Both edit while apart.
    useProjectStore.getState().addEntity('town', 'Ironhold')
    guest.doc.transact(() => writeTop(guest.doc, 'entities:enemy', readTop(guest.doc, 'entities:enemy'), [{ id: 'e1', name: 'Slime' }]))

    // The guest comes back as a member (it now has its own session).
    const guestSession = new CollabSession('/elsewhere', guest.doc)
    const back = new CollabNetwork(new MemoryTransport(hub, 'guest'), guest.doc, { kind: 'member', session: guestSession, onJoinRequest: async () => false }, profile('Guest'))
    networks.push(back)
    await back.start()
    await until(() => useProjectStore.getState().entities.enemy.length === 1)
    await until(() => ((readTop(guest.doc, 'entities:town') as unknown[]) ?? []).length === 1)
    expect(session.members).toHaveLength(2)
  })

  it('shares who is connected through awareness', async () => {
    const { net, invite } = await host()
    const guest = await joiner(invite)
    await until(() => guest.state.synced)
    const names = () => [...net.awareness.getStates().values()].map((s) => (s.user as { name: string }).name)
    await until(() => names().includes('Guest'))
    await guest.net.stop()
    await until(() => !names().includes('Guest'))
  })

  it('refuses peers on another schema version', async () => {
    const { net, invite } = await host()
    const events: string[] = []
    const odd = new CollabNetwork(new MemoryTransport(hub, 'odd'), new Y.Doc(), { kind: 'join', invite: decodeInvite(invite)! }, profile('Odd'), {
      rejected: (r, _p, byUs) => events.push(`${byUs ? 'we' : 'they'}:${r.reason}`),
    })
    networks.push(odd)
    // Pretend to be from the future.
    const hello = (odd as unknown as { sendHello: (p: unknown) => Promise<void> }).sendHello
    ;(odd as unknown as { sendHello: (p: unknown) => Promise<void> }).sendHello = async function (this: CollabNetwork, peer: unknown) {
      const send = this.send.bind(this)
      this.send = (p, data) => {
        if (data[0] === 0) {
          const json = JSON.parse(new TextDecoder().decode(data.subarray(1)))
          json.schema = 999
          const body = new TextEncoder().encode(JSON.stringify(json))
          const out = new Uint8Array(body.length + 1)
          out.set(body, 1)
          return send(p, out)
        }
        return send(p, data)
      }
      await hello.call(this, peer)
      this.send = send
    }
    await odd.start()
    await until(() => events.length > 0)
    expect(events).toContain('they:version')
    expect(net.readyPeers()).toHaveLength(0)
  })

  it('tells connected devices when the host ends the project', async () => {
    const { net, invite } = await host()
    const doc = new Y.Doc()
    const got: string[] = []
    const guest = new CollabNetwork(new MemoryTransport(hub, 'guest'), doc, { kind: 'join', invite: decodeInvite(invite)! }, profile('Guest'), {
      closed: (m, peer) => got.push(`${m.reason} from ${peer.remoteId}`),
    })
    networks.push(guest)
    await guest.start()
    await until(() => guest.readyPeers().length === 1 && net.readyPeers().length === 1)
    await net.sayGoodbye('host-closed')
    await until(() => got.length === 1)
    expect(got).toEqual(['host-closed from host'])
    await until(() => guest.readyPeers().length === 0)
  })

  it('keeps Sketch drawings out of the shared project list', async () => {
    const { sharedMeta } = await import('../state')
    await useProjectStore.getState().create({ name: 'Game', description: '', components: ['sketch', 'writer'] })
    const doc = useProjectStore.getState().addDocument('sketch', 'Drawing')
    const page = useProjectStore.getState().addDocument('writer', 'Page')
    const shared = sharedMeta(useProjectStore.getState().meta!)
    expect(shared.documents.map((d) => d.id)).toEqual([page.id])
    expect(doc.id).toBeTruthy()
  })
})

describe('comment connections (0.28)', () => {
  it('only pass transactions that change the Reviews document', async () => {
    const { onlyReviews } = await import('./network')
    const doc = new Y.Doc()
    const seen: boolean[] = []
    doc.on('afterTransaction', (tr: Y.Transaction) => seen.push(onlyReviews(tr)))
    const reviews = doc.getMap('doc:reviews/reviews')
    doc.transact(() => reviews.set('entries', new Y.Map()))
    doc.transact(() => (reviews.get('entries') as Y.Map<unknown>).set('a', 'comment'))
    doc.transact(() => doc.getMap('doc:items/x').set('name', 'Axe'))
    doc.transact(() => {
      reviews.set('b', 1)
      doc.getMap('doc:items/x').set('name', 'Bow')
    })
    doc.transact(() => doc.getXmlFragment('text:doc:reviews/reviews#note').insert(0, [new Y.XmlText('hi')]))
    expect(seen).toEqual([true, true, false, false, true])
  })
})
