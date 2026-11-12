// Reads Loom's QR code with the phone's camera, inside the page. The Camera app opens a code in
// Safari, and a copy of this page added to the Home Screen keeps its own storage apart from
// Safari's: scanning from in here is how that copy gets a link of its own.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { parsePairingHash } from '@shared/remote'

type Problem = 'blocked' | 'none' | 'failed'

const PROBLEMS: Record<Problem, string> = {
  blocked: "This page isn't allowed to use the camera. Allow it when the phone asks, or in the phone's settings for this site, then try again.",
  none: 'No camera was found on this device.',
  failed: "The camera couldn't be started. Close other apps that are using it, then try again."
}

/** The part of a scanned address that links a phone, when the code is one of Loom's. */
function pairingHash(text: string): string | null {
  const at = text.indexOf('#')
  if (at < 0) return null
  const hash = text.slice(at)
  return parsePairingHash(hash) ? hash : null
}

/**
 * The camera, full screen, until it sees Loom's code. `onCode` gets the code's link part
 * (#r=...&s=...), the same thing the address would carry had the Camera app opened it.
 */
export function Scanner({ onCode, onClose }: { onCode: (hash: string) => void; onClose: () => void }): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const found = useRef(onCode)
  found.current = onCode
  const [problem, setProblem] = useState<Problem | null>(null)
  const [other, setOther] = useState(false)

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
    // Focus goes to the view as a whole, so its one button doesn't start out ringed.
    d?.focus({ preventScroll: true })
    let stream: MediaStream | null = null
    let stopped = false
    let timer = 0
    const stop = (): void => {
      stopped = true
      clearTimeout(timer)
      for (const track of stream?.getTracks() ?? []) track.stop()
    }
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no camera'), { name: 'NotFoundError' })
        // The reader is only fetched when someone scans.
        const [{ default: jsQR }, camera] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
        ])
        stream = camera
        if (stopped) return stop()
        const v = video.current
        if (!v) return stop()
        v.srcObject = camera
        await v.play().catch(() => undefined)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('no canvas')
        const look = (): void => {
          if (stopped) return
          if (v.readyState >= 2 && v.videoWidth && v.videoHeight) {
            // The middle square of the picture, where the frame on screen is, at a size that reads fast.
            const side = Math.min(v.videoWidth, v.videoHeight)
            const size = Math.min(720, side)
            canvas.width = canvas.height = size
            ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, size, size)
            const code = jsQR(ctx.getImageData(0, 0, size, size).data, size, size, { inversionAttempts: 'dontInvert' })
            if (code?.data) {
              const hash = pairingHash(code.data)
              if (hash) {
                stop()
                return found.current(hash)
              }
              setOther(true)
            }
          }
          timer = window.setTimeout(look, 150)
        }
        look()
      } catch (e) {
        if (stopped) return
        const name = (e as Error).name
        setProblem(name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'none' : 'failed')
      }
    })()
    return () => {
      stop()
      d?.close()
    }
  }, [])

  return (
    <dialog ref={dialog} className="scanner" aria-label="Scan Loom's code" tabIndex={-1} onClose={onClose}>
      <div className="scanner-view">
        {/* playsInline: an iPhone would otherwise take the video full screen as a player */}
        <video ref={video} playsInline muted autoPlay />
        {problem ? null : <div className="scanner-frame" aria-hidden="true" />}
      </div>
      <div className="scanner-foot">
        <p role="status">
          {problem
            ? PROBLEMS[problem]
            : other
              ? "That isn't a Loom code. Point at the one in Loom's Settings, under Phone access."
              : "Point the camera at the code in Loom's Settings, under Phone access."}
        </p>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  )
}
