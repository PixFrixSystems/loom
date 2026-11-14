import { ExternalLink, FolderOpen, Maximize2, Minimize2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FileTab } from '@shared/types'
import type { MediaInfo } from '@shared/media'
import { relPath } from '../lib/paths'
import { useStore } from '../store'
import { ProjectMark } from './ProjectMark'

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`
}

function lengthText(seconds: number): string {
  if (!Number.isFinite(seconds)) return ''
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

/**
 * A picture, a video or sound in a tab: shown, not edited. Pictures fit the pane and a click shows
 * them at their real size; videos and sound play with the usual controls and stop when the tab is
 * put away. A file that changes on disk (Claude made a new version) is shown afresh.
 */
export function MediaView({ tab, visible }: { tab: FileTab; visible: boolean }): ReactNode {
  const project = useStore((s) => s.projects.find((p) => p.id === tab.projectId))
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading')
  /** "1920 × 1080", or a length for sound */
  const [measure, setMeasure] = useState('')
  const [actual, setActual] = useState(false)
  const player = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const shown = useRef('')

  useEffect(() => {
    let gone = false
    const load = async (): Promise<void> => {
      const next = await window.loom.mediaInfo(tab.path)
      if (gone) return
      if (!next) return setState('missing')
      // The address changes with the file: only then is it loaded again.
      if (next.url === shown.current) return
      shown.current = next.url
      setState('loading')
      setMeasure('')
      setInfo(next)
    }
    void load()
    // While it is on screen, look for a newer version on disk.
    const t = visible ? setInterval(load, 3000) : undefined
    return () => {
      gone = true
      clearInterval(t)
    }
  }, [tab.path, visible])

  // Out of sight, nothing keeps playing.
  useEffect(() => {
    if (!visible) player.current?.pause()
  }, [visible])

  const details = [measure, info ? sizeText(info.size) : ''].filter(Boolean).join(', ')
  return (
    <div className="fileview mediaview">
      <div className="file-head">
        <ProjectMark project={project} />
        {project ? <span className="chat-head-project">{project.name}</span> : null}
        <span className="chat-head-path selectable" title={tab.path}>
          {project ? relPath(tab.path, project.path) : tab.path}
        </span>
        <span className="chat-head-spacer" />
        {state === 'ready' && details ? <span className="media-details">{details}</span> : null}
        {info?.kind === 'image' && state === 'ready' ? (
          <button className="icon-btn" title={actual ? 'Fit to the pane' : 'Show at its real size'} aria-pressed={actual} onClick={() => setActual(!actual)}>
            {actual ? <Minimize2 /> : <Maximize2 />}
          </button>
        ) : null}
        <button className="icon-btn" title="Show in File Explorer" onClick={() => void window.loom.reveal(tab.path)}>
          <FolderOpen />
        </button>
        <button className="icon-btn" title="Open with the default app" onClick={() => void window.loom.openPath(tab.path)}>
          <ExternalLink />
        </button>
      </div>
      {state === 'missing' || state === 'failed' ? (
        <div className="file-unavailable">
          <p>{state === 'missing' ? 'This file does not exist (any more).' : info?.kind === 'image' ? "This picture can't be shown here." : "This file's format can't be played here."}</p>
          <button className="btn" onClick={() => void window.loom.openPath(tab.path)}>
            Open with the default app
          </button>
        </div>
      ) : info ? (
        <div className={`media-stage is-${info.kind}${actual ? ' is-actual' : ''}`}>
          {info.kind === 'image' ? (
            <img
              key={info.url}
              className="media-image"
              src={info.url}
              alt={tab.title}
              draggable={false}
              onClick={() => setActual(!actual)}
              onLoad={(e) => {
                setMeasure(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)
                setState('ready')
              }}
              onError={() => setState('failed')}
            />
          ) : info.kind === 'video' ? (
            <video
              key={info.url}
              ref={(el) => {
                player.current = el
              }}
              className="media-video"
              src={info.url}
              controls
              preload="metadata"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                setMeasure([v.videoWidth ? `${v.videoWidth} × ${v.videoHeight}` : '', lengthText(v.duration)].filter(Boolean).join(', '))
                setState('ready')
              }}
              onError={() => setState('failed')}
            />
          ) : (
            <audio
              key={info.url}
              ref={(el) => {
                player.current = el
              }}
              className="media-audio"
              src={info.url}
              controls
              preload="metadata"
              onLoadedMetadata={(e) => {
                setMeasure(lengthText(e.currentTarget.duration))
                setState('ready')
              }}
              onError={() => setState('failed')}
            />
          )}
        </div>
      ) : null}
    </div>
  )
}
