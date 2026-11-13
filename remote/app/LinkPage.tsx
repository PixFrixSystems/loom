// The page anyone can open at remote.loom.baby: how to link a phone, and what it says while it links.
// It wears the website's look (loom.baby): the same header and footer, type and lit sheets.

import { useEffect, useState, type ReactNode } from 'react'
import wordmark from '@renderer/assets/brand/loom-wordmark.webp'
import wordmark2x from '@renderer/assets/brand/loom-wordmark@2x.webp'
import { isHomeScreenApp, type PairError } from './link'
import { Scanner } from './Scanner'
import { useApp } from './state'

const SITE = 'https://loom.baby'
const REPO = 'https://github.com/PixFrixSystems/loom'

export function Wordmark(): ReactNode {
  return <img className="wordmark" src={wordmark} srcSet={`${wordmark2x} 2x`} width={114} height={32} alt="Loom" />
}

/** The browser's own bar takes this page's ground while it shows, and the app's bar colour after. */
function useThemeColor(color: string): void {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!meta) return
    const before = meta.content
    meta.content = color
    return () => {
      meta.content = before
    }
  }, [color])
}

function SiteFoot(): ReactNode {
  return (
    <footer className="site-foot">
      <div className="site-foot-inner">
        <div className="site-foot-top">
          <a className="home" href={SITE} aria-label="Loom, the website">
            <Wordmark />
          </a>
          <nav className="site-foot-links" aria-label="Footer">
            <a href={`${REPO}/releases/latest`}>Download for Windows</a>
            <a href={REPO} target="_blank" rel="noopener">
              Source on GitHub
            </a>
            <a href={`${SITE}/privacy/`}>Privacy</a>
          </nav>
        </div>
        <div className="site-foot-bottom">
          <p className="site-foot-legal">
            Loom is an independent project. It is not made by or affiliated with Anthropic. Claude and Claude Code are trademarks of Anthropic.
          </p>
          <p className="site-foot-credit">
            Created by{' '}
            <a href="https://pixfrix.gr/" target="_blank" rel="noopener">
              PixFrix.gr
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}

function Page({ foot, children }: { foot?: boolean; children: ReactNode }): ReactNode {
  useThemeColor('#0a0c12')
  return (
    <div className="page">
      {/* Focus moves by script: the address after # belongs to linking and to the chats */}
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        Skip to content
      </a>
      <header className="top">
        <div className="top-inner">
          <a className="home" href="/" aria-label="Loom, home">
            <Wordmark />
          </a>
          <a className="btn small" href={SITE}>
            About Loom
          </a>
        </div>
      </header>
      {children}
      {foot ? <SiteFoot /> : null}
    </div>
  )
}

/** What a linked phone shows, drawn with the page's own parts. The workspace is made up. */
function PhonePreview(): ReactNode {
  return (
    <div className="phone" role="img" aria-label="Loom on a phone: the chats open on the PC, one of them waiting for an answer, and the projects under them">
      <div className="phone-screen">
        <div className="bar">
          <Wordmark />
          <span className="pc">
            <span className="live-dot" />
            Studio PC
          </span>
        </div>
        <div className="group">
          <h2>Open in Loom</h2>
          <div className="row">
            <span className="tile" style={{ background: 'var(--t-woad)' }}>
              A
            </span>
            <span className="row-text">
              <span className="row-title">Dark mode toggle</span>
              <span className="row-preview">The toggle goes in the header.</span>
            </span>
            <span className="row-meta">
              <span className="tag is-needs">Needs you</span>
            </span>
          </div>
          <div className="row">
            <span className="tile" style={{ background: 'var(--t-verdigris)' }}>
              M
            </span>
            <span className="row-text">
              <span className="row-title">Login screen</span>
              <span className="row-preview">Checking the form at phone width.</span>
            </span>
            <span className="row-meta">
              <span className="tag is-working">
                <span className="live-dot" /> Working
              </span>
            </span>
          </div>
          <div className="row is-unread">
            <span className="tile" style={{ background: 'var(--t-weld)' }}>
              D
            </span>
            <span className="row-text">
              <span className="row-title">Install guide</span>
              <span className="row-preview">Done. The page builds with no warnings.</span>
            </span>
            <span className="row-meta">12 min ago</span>
          </div>
        </div>
        <div className="group">
          <h2>Projects</h2>
          <div className="subgroup">
            <h3>Acme</h3>
            <div className="row is-project">
              <span className="tile" style={{ background: 'var(--t-woad)' }}>
                A
              </span>
              <span className="row-text">
                <span className="row-title">acme-site</span>
              </span>
              <span className="row-meta">
                <span className="tag is-needs">Needs you</span>
              </span>
            </div>
            <div className="row is-project">
              <span className="tile" style={{ background: 'var(--t-indigo)' }}>
                A
              </span>
              <span className="row-text">
                <span className="row-title">api</span>
              </span>
              <span className="row-meta">2 h ago</span>
            </div>
            <div className="row is-project">
              <span className="tile" style={{ background: 'var(--t-weld)' }}>
                D
              </span>
              <span className="row-text">
                <span className="row-title">docs</span>
              </span>
              <span className="row-meta">1 open</span>
            </div>
          </div>
          <div className="subgroup">
            <h3>Own work</h3>
            <div className="row is-project">
              <span className="tile" style={{ background: 'var(--t-verdigris)' }}>
                M
              </span>
              <span className="row-text">
                <span className="row-title">mobile-app</span>
              </span>
              <span className="row-meta">
                <span className="tag is-working">
                  <span className="live-dot" /> Working
                </span>
              </span>
            </div>
            <div className="row is-project">
              <span className="tile" style={{ background: 'var(--t-cochineal)' }}>
                D
              </span>
              <span className="row-text">
                <span className="row-title">design-system</span>
              </span>
              <span className="row-meta">3 days ago</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const WHY: Record<PairError, string> = {
  expired: 'That code has expired or was already used. In Loom, choose Link a phone to show a new one.',
  full: 'Loom already has as many phones linked as it takes. Remove one in Settings, Phone access, then try again.',
  version: "This page and the Loom on your PC don't match. Update Loom, then link again.",
  timeout: "Loom on your PC didn't answer. Check that it is open and online, then show a new code.",
  'bad-link': "That link isn't a Loom code. Scan the one Loom shows in Settings, Phone access.",
  refused: 'The link was refused on your PC. If that was a mistake, show a new code in Loom and scan it again.'
}

export function LinkScreen(): ReactNode {
  const phase = useApp((s) => s.phase)
  const [scanning, setScanning] = useState(false)
  if (phase.at === 'linking' && phase.digits) {
    // Scanning only asks. Loom shows the same digits on the PC, where the link is allowed or refused.
    return (
      <Page>
        <main id="main" className="wait" tabIndex={-1}>
          <div className="hero">
            <h1>Allow it on your PC</h1>
            <p className="lede">Loom on your PC is asking whether to link this phone. Check that it shows these digits, then choose Link this phone there.</p>
            <p className="check-digits" aria-label={`The digits are ${phase.digits.split('').join(' ')}`}>
              {phase.digits}
            </p>
          </div>
        </main>
      </Page>
    )
  }
  if (phase.at === 'linking') {
    return (
      <Page>
        <main id="main" className="wait" tabIndex={-1}>
          <div className="hero">
            <h1>Linking this phone</h1>
            <p className="lede">
              <span className="live-dot" /> {phase.pcOff ? 'Waiting for Loom on your PC. Keep it open, with the code on screen.' : 'Talking to Loom on your PC.'}
            </p>
          </div>
        </main>
      </Page>
    )
  }
  const note =
    phase.at === 'link-failed'
      ? WHY[phase.why]
      : phase.at === 'unlinked' && phase.note === 'removed'
        ? 'This phone was removed in Loom, so it is no longer linked.'
        : phase.at === 'unlinked' && phase.note === 'forgotten'
          ? 'This phone is no longer linked.'
          : null
  return (
    <Page foot>
      <main id="main" className="pairing" tabIndex={-1}>
        <div className="hero">
          <h1>
            Link this phone <br />
            to Loom
          </h1>
          <p className="lede">Your chats stay on your PC. This phone connects to it, so you can follow them, send messages and answer Claude from anywhere.</p>
          {note ? (
            <p className="alert" role="alert">
              {note}
            </p>
          ) : null}
          <div className="actions">
            <button className="btn primary" onClick={() => setScanning(true)}>
              Scan the code
            </button>
          </div>
          {/* A copy on the Home Screen keeps its own storage: a code opened by the Camera app links Safari, not it. */}
          {isHomeScreenApp() ? <p className="scan-note">Scan from here, not with the Camera app: that would link Safari instead of this app.</p> : null}
          {/* Handing the code over as the address is what the Camera app does: linking starts from there. */}
          {scanning ? (
            <Scanner
              onCode={(hash) => {
                setScanning(false)
                location.hash = hash
              }}
              onClose={() => setScanning(false)}
            />
          ) : null}
        </div>
        <section className="pane" aria-labelledby="how-title">
          <div className="pane-inner">
            <h2 id="how-title">How to link it</h2>
            {/* Without list markers Safari stops calling it a list, so it is named one */}
            <ol className="steps" role="list">
              <li>
                <span>Open Loom on your PC.</span>
              </li>
              <li>
                <span>Go to Settings, then Phone access.</span>
              </li>
              <li>
                <span>Choose Link a phone, and scan the code: with Scan the code above, or with this phone&apos;s camera.</span>
              </li>
            </ol>
            <p className="notice">
              Loom is a free app for Windows. <a href={SITE}>Get it at loom.baby</a>
            </p>
          </div>
          <PhonePreview />
        </section>
      </main>
    </Page>
  )
}
