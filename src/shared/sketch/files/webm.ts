import { ByteWriter } from './bytes'

/**
 * A small WebM (Matroska) muxer for one video track (Sketch Pro): takes the
 * chunks WebCodecs' VideoEncoder makes (VP8 or VP9) and wraps them in a file
 * players open. Time is kept in milliseconds.
 */

export interface VideoChunk {
  data: Uint8Array
  /** ms from the start. */
  time: number
  key: boolean
}

/** EBML size: as few bytes as the value needs (all-ones is reserved). */
function size(n: number): number[] {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out: number[] = []
      for (let i = len - 1; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) & 255)
      out[0] |= 1 << (8 - len)
      return out
    }
  }
  throw new Error('Too big for WebM')
}

function idBytes(id: number): number[] {
  const out: number[] = []
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 255)
  return out
}

function el(id: number, body: ArrayLike<number>): Uint8Array {
  return new ByteWriter().bytes(idBytes(id)).bytes(size(body.length)).bytes(body).done()
}
const join = (...parts: ArrayLike<number>[]) => {
  const w = new ByteWriter()
  for (const p of parts) w.bytes(p)
  return w.done()
}
function uint(id: number, v: number) {
  const b: number[] = []
  do {
    b.unshift(v & 255)
    v = Math.floor(v / 256)
  } while (v > 0)
  return el(id, b)
}
const str = (id: number, s: string) => el(id, new TextEncoder().encode(s))
function float(id: number, v: number) {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setFloat64(0, v)
  return el(id, b)
}

/** An Opus sound track for muxWebm (Storyboard animatics). */
export interface AudioTrack {
  chunks: VideoChunk[]
  sampleRate: number
  channels: number
  /** OpusHead, from the encoder's decoderConfig.description. */
  codecPrivate: Uint8Array
}

export function muxWebm(chunks: VideoChunk[], opts: { width: number; height: number; codec: 'V_VP8' | 'V_VP9'; duration: number; audio?: AudioTrack }): Uint8Array {
  const header = el(
    0x1a45dfa3,
    join(uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), str(0x4282, 'webm'), uint(0x4287, 2), uint(0x4285, 2)),
  )
  const info = el(0x1549a966, join(uint(0x2ad7b1, 1_000_000), str(0x4d80, 'Eve.Lopment Games Designer'), str(0x5741, 'Eve.Lopment Games Designer'), float(0x4489, opts.duration)))
  const video = el(0xe0, join(uint(0xb0, opts.width), uint(0xba, opts.height)))
  const a = opts.audio
  const entries = [el(0xae, join(uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), str(0x86, opts.codec), video))]
  // Track 2: Opus (track type 2 = audio). Seek pre-roll 80 ms is what Opus asks for.
  if (a) entries.push(el(0xae, join(uint(0xd7, 2), uint(0x73c5, 2), uint(0x83, 2), str(0x86, 'A_OPUS'), el(0x63a2, a.codecPrivate), uint(0x56bb, 80_000_000), el(0xe1, join(float(0xb5, a.sampleRate), uint(0x9f, a.channels))))))
  const tracks = el(0x1654ae6b, join(...entries))
  // Both tracks in time order; a new cluster at each video key frame, and before the 16-bit block time would overflow.
  const all = [...chunks.map((c) => ({ ...c, track: 1 })), ...(a?.chunks ?? []).map((c) => ({ ...c, key: true, track: 2 }))].sort((x, y) => x.time - y.time || x.track - y.track)
  const clusters: Uint8Array[] = []
  let start = 0
  let blocks: Uint8Array[] = []
  const close = () => {
    if (blocks.length) clusters.push(el(0x1f43b675, join(uint(0xe7, start), ...blocks)))
    blocks = []
  }
  for (const c of all) {
    const t = Math.round(c.time)
    if (!blocks.length || (c.track === 1 && c.key) || t - start > 30000) {
      close()
      start = t
    }
    const rel = t - start
    blocks.push(el(0xa3, join([0x80 | c.track, (rel >> 8) & 255, rel & 255, c.key ? 0x80 : 0], c.data)))
  }
  close()
  return join(header, el(0x18538067, join(info, tracks, ...clusters)))
}
