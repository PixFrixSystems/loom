import { LogIn, LogOut } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { ServiceAccount, ServiceId } from '@shared/types'
import { useStore } from '../store'

const IDS: ServiceId[] = ['github', 'cloudflare', 'vercel']
const NAMES: Record<ServiceId, string> = { github: 'GitHub', cloudflare: 'Cloudflare', vercel: 'Vercel' }

/** What the sign-in is used for, so the name next to it means something. */
const USED_FOR: Record<ServiceId, string> = {
  github: 'Pushes and pulls from Loom, your terminals and Claude go out as this account.',
  cloudflare: 'Deploys with Wrangler, from your terminals or by Claude, go to this account.',
  vercel: 'Deploys with the Vercel CLI, from your terminals or by Claude, go to this account.'
}

const SIGNED_OUT: Record<ServiceId, string> = {
  github: 'Not signed in on this PC. Git asks you to sign in the first time you push.',
  cloudflare: 'Not signed in on this PC. Wrangler asks you to sign in the first time something is deployed.',
  vercel: 'Not signed in on this PC. The Vercel CLI asks you to sign in the first time something is deployed.'
}

/** The row's sentence: who, through what, and what it is used for. The name is what the eye should land on. */
function Status({ a }: { a: ServiceAccount }): ReactNode {
  if (!a.signedIn) return SIGNED_OUT[a.id]
  const also = a.others?.length ? `, and also as ${a.others.join(', ')}` : ''
  const via = a.via ? `, through ${a.via}` : ''
  // The tool renews its sign-in when it runs; until then only it can say whose the sign-in is.
  const unnamed = a.who ? '' : ` The account's name shows here once ${a.via ?? 'the tool'} has run again.`
  return (
    <>
      {a.who ? (
        <>
          Signed in as <strong className="account-who">{a.who}</strong>
        </>
      ) : (
        'Signed in'
      )}
      {also}
      {via}. {USED_FOR[a.id]}
      {unnamed}
      {a.detail ? ` ${a.detail}` : ''}
    </>
  )
}

/**
 * Settings, Accounts: who this PC is signed in as on GitHub, Cloudflare and Vercel, next to the
 * Claude account. They are the tools' own sign-ins, so what Claude pushes or deploys from a chat
 * goes out as these. Signing in or out happens through the tool, where it can be seen.
 */
export function ServiceAccounts(): ReactNode {
  // Each service fills in as its answer comes: null is "couldn't be looked up", missing is "still asking".
  const [found, setFound] = useState<Partial<Record<ServiceId, ServiceAccount | null>>>({})
  const [busy, setBusy] = useState<ServiceId | null>(null)
  const load = (force = false): Promise<void[]> =>
    Promise.all(
      IDS.map((id) =>
        window.loom.serviceAccount(id, force).then(
          (a) => setFound((cur) => ({ ...cur, [id]: a })),
          () => setFound((cur) => ({ ...cur, [id]: null }))
        )
      )
    )
  useEffect(() => {
    void load()
    // Back from a sign-in in the browser or a terminal: look again (the answers are kept for half a minute).
    const again = (): void => void load()
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [])

  const s = useStore.getState()
  const signIn = async (a: ServiceAccount): Promise<void> => {
    if (!a.signIn) return
    if ('run' in a.signIn) return s.runInTerminal(`Sign in to ${NAMES[a.id]}`, a.signIn.run)
    setBusy(a.id)
    const r = await window.loom.githubSign('in')
    await load(true)
    setBusy(null)
    if (!r.ok) s.showToast(`Couldn't sign in to GitHub: ${r.error ?? 'Git did not answer.'}`)
  }
  const signOut = async (a: ServiceAccount): Promise<void> => {
    if (!a.signOut) return
    const inTerminal = 'run' in a.signOut
    const pick = await s.ask({
      title: `Sign out of ${NAMES[a.id]}${a.who ? ` (${a.who})` : ''}?`,
      body: inTerminal
        ? `This runs ${(a.signOut as { run: string }).run} in a terminal. ${a.via ? a.via[0].toUpperCase() + a.via.slice(1) : 'The tool'} on this PC forgets the account, for every project.`
        : 'Git on this PC forgets this account, in Loom, your terminals and other apps alike. The next push asks you to sign in again.',
      choices: [
        { id: 'out', label: 'Sign out', kind: 'danger' },
        { id: 'cancel', label: 'Cancel', kind: 'ghost' }
      ],
      cancel: 'cancel'
    })
    if (pick !== 'out') return
    if ('run' in a.signOut) return s.runInTerminal(`Sign out of ${NAMES[a.id]}`, a.signOut.run)
    setBusy(a.id)
    const r = await window.loom.githubSign('out', a.who)
    await load(true)
    setBusy(null)
    if (!r.ok) s.showToast(`Couldn't sign out of GitHub: ${r.error ?? 'Git did not answer.'}`)
  }

  return (
    <>
      {IDS.map((id) => {
        const a = found[id]
        return (
          <div key={id} className="set-row">
            <div className="set-text">
              <div className="set-title">{NAMES[id]}</div>
              <div className="set-hint selectable">{a ? <Status a={a} /> : a === null ? "Loom couldn't check this one." : 'Checking the sign-in on this PC…'}</div>
            </div>
            <div className="set-control">
              <div className="set-actions">
                {a?.signedIn && a.signOut ? (
                  <button className="btn danger" disabled={busy === id} onClick={() => void signOut(a)}>
                    <LogOut /> Sign out
                  </button>
                ) : null}
                {a && !a.signedIn && a.signIn ? (
                  <button className="btn primary" disabled={busy === id} onClick={() => void signIn(a)}>
                    <LogIn /> {busy === id ? 'Waiting for the sign-in' : 'Sign in'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}
      <p className="accounts-note">
        These are the sign-ins of the tools on this PC. Loom reads who is signed in and keeps nothing.{' '}
        <button className="link-btn" onClick={() => void load(true)}>
          Check again
        </button>
      </p>
    </>
  )
}
