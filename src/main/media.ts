import { protocol } from 'electron'
import { randomBytes } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { mediaType, type MediaInfo } from '@shared/media'

// Pictures, videos and sound open in a tab of their own. The window gets them over a private
// address rather than reading whole files into memory: a video is streamed, and seeking in it
// asks for just the part needed. The address carries a key made for this run of Loom, and only
// media files are ever served, so nothing else (a site in a preview, say) can read files with it.

const SCHEME = 'loom-media'
const KEY = randomBytes(16).toString('hex')

/** Before the app is ready: the address is one pages may load media from, in a stream. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])
}

/** What the window needs to show a media file: where to load it from, and how big it is. */
export async function mediaInfo(path: string): Promise<MediaInfo | null> {
  const type = mediaType(path)
  if (!type) return null
  try {
    const st = await fs.stat(path)
    if (!st.isFile()) return null
    // The modified time in the address: a file that changes on disk is loaded afresh.
    return { kind: type[0], url: `${SCHEME}://${KEY}/?p=${encodeURIComponent(path)}&v=${Math.round(st.mtimeMs)}`, size: st.size, mtime: st.mtimeMs }
  } catch {
    return null
  }
}

/** Once the app is ready: answers the window's requests for media, whole or a byte range of it. */
export function serveMedia(): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const path = url.searchParams.get('p')
      const type = path ? mediaType(path) : null
      if (url.host !== KEY || !path || !type) return new Response(null, { status: 403 })
      const size = (await fs.stat(path)).size
      let start = 0
      let end = size - 1
      let status = 200
      const range = request.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/)
      if (range && (range[1] || range[2])) {
        // "bytes=100-" from there to the end, "bytes=-500" the last 500, "bytes=100-200" that part.
        if (range[1]) {
          start = Number(range[1])
          if (range[2]) end = Math.min(Number(range[2]), size - 1)
        } else start = Math.max(0, size - Number(range[2]))
        if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
        status = 206
      }
      const headers: Record<string, string> = {
        'Content-Type': type[1],
        'Content-Length': String(size ? end - start + 1 : 0),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      }
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      if (!size) return new Response(null, { status: 200, headers })
      const body = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream
      return new Response(body, { status, headers })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
