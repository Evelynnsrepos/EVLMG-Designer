# Working together (peer-to-peer collaboration)

How live collaboration works and how to keep new code compatible with it.
Users see it as **Work together** in the sidebar and **Join project** on the start screen.

## In one paragraph

A shared project keeps a [Yjs](https://yjs.dev) document next to its JSON files (`collab/state.bin`).
The stores (`projectStore`, `documentStore`) write every change into it through a small binding,
and changes from teammates come back into the stores and the JSON files. Devices find and talk to each other with
[iroh](https://iroh.computer) (QUIC, end-to-end encrypted, NAT hole punching, public relays as fallback),
the same on Windows, macOS and Linux. There is no server and no account.

## Layers

| Layer | Where | What it does |
|---|---|---|
| Transport | `src-tauri/src/collab.rs`, `collab_commands.rs`, `src/core/collab/tauriTransport.ts` | One iroh endpoint per app. ALPN `egd/collab/1`, one bidirectional stream per peer, `EGD1` hello, length-prefixed frames (8 MiB max). Events reach JS over a Tauri channel as `[kind u8][conn u32 BE][payload]`. The device key is stored in the app data folder (`collab-key`); its public key is the device id. |
| Other transports | `browserTransport.ts` (two tabs of `npm run dev`, BroadcastChannel, testing only), `memoryTransport.ts` (unit tests) | Same `CollabTransport` interface, so a future server transport can be added without touching the rest. |
| Network | `network.ts`, `protocol.ts` | Handshake (protocol and schema version, project id, membership, join proof), Yjs sync (y-protocols), awareness (presence), redialing members every 15 s, duplicate connections. |
| Shared state | `session.ts`, `bridge.ts` | The Yjs document, JSON-to-Yjs mapping, per-document undo, saving `state.bin`. |
| Controller | `controller.ts` | Goes online when a shared project opens, offline when it closes. Share, invite, join, remove, stop sharing. |
| Assets | `assetSync.ts` | Images and audio referenced as `assets/(images\|audio)/<uuid>.<ext>` are fetched from a teammate in 512 KB chunks (200 MB max per file). |
| Presence | `presence.ts`, `src/shared/canvas/RemoteCursors.tsx`, `src/shared/richtext/collab.ts` | Who is where (sidebar dots), canvas pointers and selections, text carets. Never saved. |
| UI | `src/shell/collab/` | Share and Join dialogs, "Let X join?" prompt, presence dots. |

## What is shared

Top-level names in the Yjs document:

- `meta`: project meta **without** personal fields (`layout`, `sidebarCollapsed` stay on each computer).
- `categories`, `entities:<type>`: the shared lists.
- `doc:<component type>/<id>`: every component document.
- `text:doc:<type>/<id>#<field>`: live rich text (Writer and Wiki bodies), a `Y.XmlFragment`.
- `share` (project id and invite secret) and `members` (device ids allowed in).

### JSON to Yjs

`bridge.ts` maps plain JSON values:

- Objects become `Y.Map`s, so two people changing different fields both win.
- **Keyed lists** (arrays where every item is an object with a unique string `id`) become a map by id with a
  fractional order key per item. Two people adding, moving or editing different items merge cleanly.
- Everything else (numbers, strings, arrays without ids) is replaced as a whole; the last writer wins.

**For component authors:** give list items a unique `id` (all current components do) and keep data as plain JSON.
That is all it takes for a component to merge well. Strings are replaced whole, so long prose belongs in the rich text editor
with `liveTextName` set (see `src/shared/richtext/RichTextEditor.tsx`).

### Undo

Each document has its own Yjs `UndoManager` that only tracks changes made on this device, so Ctrl+Z never takes back a teammate's work.
Entity lists and categories share one undo scope (`project`). Live text uses the editor's own Yjs undo.

### Rich text

When a project is shared, `RichTextEditor` with `liveTextName` edits the `Y.XmlFragment` directly (TipTap Collaboration),
so teammates type into the same text at once. The JSON body is still saved through `onChange` (right away for your own typing,
after a short pause for a teammate's) so files on disk and word counts stay correct.
An empty fragment is filled from the JSON under a client id derived from its name and content, so two devices filling it
while apart produce the same edit and do not duplicate the text.

### Deleting and restoring

Deleting a document (`deleteDocument`) marks it removed in the shared state; teammates delete their file too, and it is
not brought back on the next open. Restoring a backup of a shared project writes `collab/restored.txt`; on next open the restored files
become the shared state (and reach teammates) instead of the old shared copy loading over them.

## Joining and membership

1. The owner shares the project: a project id and a random invite secret are created, and the owner's device becomes the first member.
2. The invite code is `EGD1-` + base64url JSON `{p: project id, n: project name, a: owner address, s: secret}`.
   The address is the iroh node id plus relay and direct addresses.
3. The joiner connects and proves it knows the secret with an HMAC-SHA256 over `egd-join|projectId|joinerId|hostId`, then
   **anyone already in the project** who is online is asked "Let X join?". On yes, the joiner is added to `members` and receives the project.
4. From then on, devices connect by id. A connection from a device not in `members` is refused.
   "New invite code" replaces the secret, so older codes stop working; removing a member disconnects them.

Version checks: the protocol version and the data `SCHEMA_VERSION` must match, otherwise both sides see
"uses a different version of the app".

## Cross-platform notes

- iroh works the same on Windows, macOS and Linux (including mixed groups). Line endings and paths never travel:
  only Yjs updates and asset bytes do, and paths are rebuilt with `getFs().join`.
- Windows may show a firewall prompt the first time; declining still works over the relay, just slower.
- macOS: no local-network permission is needed, since the app does not use LAN discovery.
- CI runs the unit tests and a relay round trip on all three systems (`ci.yml`), and `cross-os.yml` connects a Windows,
  a macOS and a Linux runner to each other over the internet (nightly, on tags, and when the transport changes).

## Trying it without two computers

Run `npm run dev` and open http://localhost:5173 in two tabs. One tab shares a project, the other clicks Join project and pastes the code.
Both tabs share the browser's storage, so use this only to try things out.

## Known limits

- Peer to peer, someone who is already in the project must be online for a teammate to join or catch up. A server removes that limit.
- If two people create the same fixed-id document (for example the Wiki's article index) while both offline, one person's
  first version of it can win when they reconnect. Documents with UUIDs are not affected.
- Invite links (`egd://join/...`) are not registered with the operating system yet; paste the code instead.

## Working through a server (0.8)

[EDG Server](https://github.com/Evelynnsrepos/Evelopment-Games-Designer-Server) is an always-on member of a
project: it keeps the Yjs document, relays edits and presence, and stores asset files, so people sync without being online together.
The protocol is the same version 1; only the transport and the way people get in differ.

| Piece | Where | What it does |
|---|---|---|
| Connect code | `protocol.ts` (`decodeServerCode`) | `EGS1-` + base64url JSON: server address, certificate fingerprint (self-signed servers), project, server name, **key**. Made on the server's admin page. |
| Transport | `serverTransport.ts`, `src-tauri/src/server_link.rs` | A WebSocket. The first text message is the key; the server answers `auth-ok` with its id, the project's id, the role (`view`/`write`) and whether the project is still empty. Protocol v1 runs in binary messages. In the desktop app the socket lives in Rust so a self-signed server is pinned by fingerprint; other servers are checked against the system's trust store. |
| Network | `network.ts` | `NetworkMode.member.server`: dial only the server, and skip the member list check (the transport authenticated the server). `readOnly` stops sending changes for view keys. A join without an invite secret sends no join proof. |
| Controller | `controller.ts` | `joinProject` accepts server codes, `moveToServer` uploads the open project into an empty server project, `collab/server.json` keeps the personal connect code (never in the shared state). The server is the host: only its admin removes people or closes the project. |
| UI | `src/shell/collab/CollabDialogs.tsx`, `src/shell/plugins/ServerPluginOffer.tsx` | "Or work through a server" in Work together, server codes in Join project, online people from presence, plugin offers. |

- The first upload binds the server project to the app's project id (`meta.id`), so moving a project keeps its id.
- A revoked key gets `reject` (`not-member`) and then `auth-error`; the app stops retrying and says so. Closing the project on the server
  sends the usual `host-closed` goodbye, and everyone is asked whether to keep their copy.
- Plugins the server offers are listed over the same connection; each install goes through the plugin warning, and a changed plugin
  (new SHA-256) asks again.

To run the integration test against a real server, build it and set `EGD_SERVER_BIN` to its binary before `npm test`.
