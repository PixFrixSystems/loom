// What's new: the changes worth knowing about in each release, shown once after Loom updates to it.
// Add an entry for a release with something people should notice; leave out fixes nobody would
// look for. Newest first. A few short lines each: what it is, and where to find it.

export type HighlightIcon = 'cloud' | 'model' | 'done' | 'switch' | 'background' | 'pin' | 'usage' | 'files'

export interface Highlight {
  icon: HighlightIcon
  title: string
  body: string
}

export interface ReleaseNotes {
  version: string
  highlights: Highlight[]
}

export const RELEASE_NOTES: ReleaseNotes[] = [
  {
    version: '0.1.14',
    highlights: [
      {
        icon: 'cloud',
        title: 'Show a site to a client with a public link',
        body: 'In Dev servers in the status bar, click the cloud next to a running server. Loom opens a Cloudflare link to it and tells you once it works; anyone with the link can see the site until you stop sharing.'
      },
      {
        icon: 'model',
        title: 'Choose the model new chats start with',
        body: "Settings, Claude: keep the one you picked last, follow Claude Code's default, or set one model for every new chat."
      },
      {
        icon: 'done',
        title: 'Working or done, at a glance',
        body: 'While Claude works, its last step says so in lavender with a ringing dot. A finished turn ends with a green check and how long it took.'
      },
      {
        icon: 'switch',
        title: 'Model switches in the chat',
        body: 'Changing the model mid-chat is noted in the timeline, from which model to which.'
      }
    ]
  }
]

/** -1, 0 or 1, comparing versions like 0.1.14 part by part. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/**
 * The notes to show after updating from `seen` to `current`: every release after the one last seen,
 * up to this one. When the version last seen isn't known (a copy from before this existed), only
 * this version's notes.
 */
export function notesSince(seen: string | null, current: string): ReleaseNotes[] {
  if (!seen) return RELEASE_NOTES.filter((r) => r.version === current)
  return RELEASE_NOTES.filter((r) => compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0)
}

/** For Settings' What's new: this version's notes, or the latest ones before it. */
export function notesFor(current: string): ReleaseNotes[] {
  const hit = RELEASE_NOTES.find((r) => compareVersions(r.version, current) <= 0)
  return hit ? [hit] : []
}
