import qrcode from 'qrcode-generator'
import { Smartphone, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RemoteDevice, RemoteStatus } from '@shared/remote'
import { timeAgo } from '../lib/paths'
import { useStore } from '../store'

/**
 * The link as a QR code: dark squares on a light tile, which every phone camera reads. It is
 * read off a screen, so the lightest error correction does, and that keeps the pattern coarse.
 */
function QrCode({ text }: { text: string }): ReactNode {
  const { path, size } = useMemo(() => {
    const qr = qrcode(0, 'L')
    qr.addData(text)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`
    }
    // Four empty squares all round: scanners need the margin.
    return { path: d, size: n + 8 }
  }, [text])
  return (
    <svg className="phone-qr" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label="QR code that links a phone to Loom">
      <path d={path} fill="#0c0f1d" />
    </svg>
  )
}

/** Minutes and seconds until `at`, counting down. */
function TimeLeft({ at }: { at: number }): ReactNode {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, Math.round((at - Date.now()) / 1000))
  // Even-width digits so the line doesn't shift each second. The colon stays out of them: in
  // this typeface they would widen it.
  return (
    <span className="phone-left">
      <span className="phone-digits">{Math.floor(secs / 60)}</span>:<span className="phone-digits">{String(secs % 60).padStart(2, '0')}</span>
    </span>
  )
}

function deviceLine(d: RemoteDevice): string {
  if (d.connected) return 'Connected now'
  if (d.seenAt) return `Last connected ${timeAgo(d.seenAt)}`
  return `Linked ${timeAgo(d.linkedAt)}, not connected yet`
}

function relayLine(r: RemoteStatus): { text: string; tone?: 'warn' } | null {
  if (!r.enabled) return null
  if (r.relay === 'error') return { text: `Loom can't reach your phones: ${r.error ?? 'the connection was refused'}.`, tone: 'warn' }
  if (!r.devices.length && !r.pairing) return { text: 'No phone is linked yet.' }
  if (r.relay === 'online') return { text: 'Ready: a linked phone can connect.' }
  return { text: 'Connecting, so phones can reach this PC…' }
}

/**
 * Settings, Phone access: switch it on, link a phone by QR code, see the phones linked and
 * remove one. The page a phone opens is remote.loom.baby.
 */
export function PhoneAccess(): ReactNode {
  const remote = useStore((s) => s.remote)
  const [copied, setCopied] = useState(false)
  if (!remote) return null
  const set = (next: Promise<RemoteStatus>): void => void next.then((r) => useStore.setState({ remote: r }))
  const host = remote.address.replace(/^https?:\/\//, '')
  const line = relayLine(remote)

  const remove = async (d: RemoteDevice): Promise<void> => {
    const pick = await useStore.getState().ask({
      title: `Remove ${d.name}?`,
      body: 'It can no longer open your chats. To use it again, link it with a new code.',
      choices: [
        { id: 'remove', label: 'Remove', kind: 'danger' },
        { id: 'cancel', label: 'Cancel', kind: 'ghost' }
      ],
      cancel: 'cancel'
    })
    if (pick === 'remove') set(window.loom.remoteRemove(d.id))
  }

  return (
    <section className="set-section">
      <h2>Phone access</h2>
      <div className="set-row">
        <div className="set-text">
          <div className="set-title">Use Loom from your phone</div>
          <div className="set-hint">
            A linked phone opens <span className="selectable">{host}</span> to follow your chats, send messages, stop Claude and answer its questions. Loom has to be
            running on this PC. What passes between the two is encrypted with a key only this PC and the phone hold.
          </div>
        </div>
        <div className="set-control">
          <div className="phone-controls">
            <label className="check-row">
              <input type="checkbox" checked={remote.enabled} onChange={(e) => set(window.loom.remoteEnable(e.target.checked))} />
              <span>Let linked phones connect</span>
            </label>
            {line ? <p className={`phone-state${line.tone ? ` is-${line.tone}` : ''}`}>{line.text}</p> : null}
          </div>
        </div>
      </div>

      <div className="set-row">
        <div className="set-text">
          <div className="set-title">Linked phones</div>
          <div className="set-hint">A phone is linked by scanning a code shown here. Remove one and it can no longer connect.</div>
        </div>
        <div className="set-control">
          <div className="phone-controls">
            {remote.devices.length ? (
              <ul className="phone-list">
                {remote.devices.map((d) => (
                  <li key={d.id} className="phone-device">
                    <Smartphone className="phone-device-icon" />
                    <span className="phone-device-text">
                      <span className="phone-device-name">{d.name}</span>
                      <span className="phone-device-line">
                        {d.connected ? <span className="live-dot" /> : null}
                        {deviceLine(d)}
                      </span>
                    </span>
                    <button className="icon-btn" title={`Remove ${d.name}`} aria-label={`Remove ${d.name}`} onClick={() => void remove(d)}>
                      <Trash2 />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {remote.pairing ? (
              <div className="phone-pair">
                <QrCode text={remote.pairing.url} />
                <div className="phone-pair-text">
                  <p className="phone-pair-title">Scan with the phone&apos;s camera</p>
                  <p className="phone-pair-hint">
                    Links one phone, for the next <TimeLeft at={remote.pairing.expiresAt} />. Whoever scans it first gets in, so keep it to yourself.
                  </p>
                  <div className="phone-pair-actions">
                    <button
                      className="link-btn"
                      onClick={() => {
                        void navigator.clipboard.writeText(remote.pairing!.url)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                      }}
                    >
                      {copied ? 'Link copied' : 'Copy the link instead'}
                    </button>
                    <button className="link-btn is-quiet" onClick={() => set(window.loom.remotePairCancel())}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button className="btn" onClick={() => set(window.loom.remotePair())}>
                <Smartphone /> Link a phone
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
