import { ExternalLink, LoaderCircle, RotateCw } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { LoginState } from '@shared/types'

/**
 * Signing in to Claude without a terminal: Claude Code's own sign-in runs out of sight, the
 * browser does the rest, and this shows what's left to do. A box takes the code for the few
 * sign-ins that show one. `onEnd` hears true once signed in, false when cancelled.
 */
export function SignInPanel({ onEnd }: { onEnd: (signedIn: boolean) => void }): ReactNode {
  const [state, setState] = useState<LoginState>({ status: 'waiting' })
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)

  const start = (): void => {
    setSent(false)
    setCode('')
    void window.loom.loginStart().then(setState)
  }
  useEffect(() => {
    const off = window.loom.onLoginState(setState)
    start()
    return off
  }, [])
  useEffect(() => {
    if (state.status === 'done') onEnd(true)
  }, [state.status])

  const cancel = (): void => {
    window.loom.loginCancel()
    onEnd(false)
  }

  if (state.status === 'failed') {
    return (
      <div className="signin" role="status">
        <p className="signin-fail selectable">Signing in didn&apos;t finish. {state.message}</p>
        <div className="signin-actions">
          <button className="btn primary" onClick={start}>
            <RotateCw /> Try again
          </button>
          <button className="btn ghost" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="signin">
      <p className="signin-status" role="status">
        <LoaderCircle className="spin" /> Finish signing in in your browser. Loom notices by itself when you&apos;re done.
      </p>
      <div className="signin-actions">
        <button className="btn" disabled={!state.url} onClick={() => state.url && void window.loom.openExternal(state.url)}>
          <ExternalLink /> Open the sign-in page
        </button>
        <button className="btn ghost" onClick={cancel}>
          Cancel
        </button>
      </div>
      <form
        className="signin-code"
        onSubmit={(e) => {
          e.preventDefault()
          if (!code.trim()) return
          window.loom.loginCode(code)
          setSent(true)
        }}
      >
        <label htmlFor="signin-code">If the page shows a code, paste it here</label>
        <div className="signin-row">
          <input
            id="signin-code"
            className="field"
            value={code}
            spellCheck={false}
            autoComplete="off"
            placeholder="Code from the sign-in page"
            onChange={(e) => {
              setCode(e.target.value)
              setSent(false)
            }}
          />
          <button className="btn primary" type="submit" disabled={!code.trim()}>
            Continue
          </button>
        </div>
        {sent ? <p className="signin-hint">Checking the code…</p> : null}
      </form>
    </div>
  )
}
