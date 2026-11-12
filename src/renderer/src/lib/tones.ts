import type { NotifySound } from '@shared/types'

// Loom's notification sounds, made on the spot with Web Audio (no sound files to ship). Each is
// short and soft: a few sine or triangle notes with a gentle attack and a long, quiet fade.

export const TONES: { value: NotifySound; label: string }[] = [
  { value: 'off', label: 'No sound' },
  { value: 'chime', label: 'Chime' },
  { value: 'glass', label: 'Glass' },
  { value: 'pluck', label: 'Pluck' },
  { value: 'rise', label: 'Rise' }
]

type Note = { freq: number; at: number; length: number; type?: OscillatorType; level?: number }

const SHAPES: Record<Exclude<NotifySound, 'off'>, Note[]> = {
  // Two soft notes falling a fourth
  chime: [
    { freq: 1318.5, at: 0, length: 0.9 },
    { freq: 987.8, at: 0.14, length: 1.1 }
  ],
  // One high, glassy note with a quiet octave above it
  glass: [
    { freq: 1760, at: 0, length: 1.4 },
    { freq: 3520, at: 0, length: 0.8, level: 0.25 }
  ],
  // A short, round pluck
  pluck: [{ freq: 659.3, at: 0, length: 0.45, type: 'triangle' }],
  // Three quick notes going up
  rise: [
    { freq: 784, at: 0, length: 0.35 },
    { freq: 988, at: 0.09, length: 0.35 },
    { freq: 1175, at: 0.18, length: 0.7 }
  ]
}

let ctx: AudioContext | null = null

/** The volume the sounds start at, out of 100 */
export const DEFAULT_VOLUME = 75

/**
 * Plays a sound at `volume` (0 to 100). Loudness follows the square of the slider, so its steps
 * sound even to the ear; the default comes out soft.
 */
export function playTone(sound: NotifySound | undefined, volume = DEFAULT_VOLUME): void {
  if (!sound || sound === 'off' || volume <= 0) return
  const notes = SHAPES[sound]
  if (!notes) return
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  const now = ctx.currentTime + 0.02
  const master = ctx.createGain()
  master.gain.value = 0.24 * Math.min(1, volume / 100) ** 2
  master.connect(ctx.destination)
  for (const n of notes) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = n.type ?? 'sine'
    osc.frequency.value = n.freq
    const start = now + n.at
    const peak = n.level ?? 1
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + n.length)
    osc.connect(gain).connect(master)
    osc.start(start)
    osc.stop(start + n.length + 0.05)
  }
}
