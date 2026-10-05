import { useState } from 'react'
import { ArrowUpRight, CircleAlert, Compass } from 'lucide-react'

export type AuthIssue = { message: string; retry?: () => Promise<void> } | null

function getRedirectUri() {
  const base = import.meta.env.BASE_URL || '/'
  return new URL(base.endsWith('/') ? base : `${base}/`, window.location.origin).toString()
}

export function beginAniListLogin() {
  const clientId = import.meta.env.VITE_ANILIST_CLIENT_ID as string | undefined
  if (!clientId) return false
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: getRedirectUri(), response_type: 'code' })
  window.location.assign(`https://anilist.co/api/v2/oauth/authorize?${query.toString()}`)
  return true
}

export default function AuthView({ issue }: { issue: AuthIssue }) {
  const [localIssue, setLocalIssue] = useState('')
  return (
    <main className="auth-page">
      <div className="auth-left">
        <a className="wordmark" href="#/" aria-label="ARNS home"><span className="brand-mark">A</span>ARNS</a>
        <div className="auth-copy">
          <span className="eyebrow">A little closer, episode by episode</span>
          <h1>Good stories<br /><em>travel better</em><br />together.</h1>
          <p>Send a friend a series you love. Pick up the conversation where the credits roll.</p>
          <div className="auth-feature"><span className="tiny-star">✳</span><span>A social companion for your AniList circle.</span></div>
        </div>
        <footer className="auth-footer">Your watch history stays yours. ARNS is just for the conversation.</footer>
      </div>
      <div className="auth-art" aria-hidden="true">
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
        <div className="art-note"><span className="note-mark">“</span><p>you have to<br />see this one</p><span className="note-rule" /></div>
        <span className="art-caption">Stories are better shared</span>
        <div className="art-flower">✳</div>
      </div>
      <section className="auth-card" aria-labelledby="signin-title">
        <div className="auth-card-top"><Compass size={18} strokeWidth={1.6} /><span>YOUR CORNER OF THE INTERNET</span></div>
        <h2 id="signin-title">Find your people.</h2>
        <p className="auth-intro">Sign in with AniList to see friends, share recommendations, and talk about what stayed with you.</p>
        {(issue || localIssue) && <div className="auth-error" role="alert"><CircleAlert size={18} /><div><strong>One small detour</strong><p>{issue?.message || localIssue}</p></div></div>}
        <button className="button button-primary signin-button" onClick={() => {
          if (!beginAniListLogin()) setLocalIssue('ARNS needs its AniList application ID before sign-in can begin. See the setup notes.')
        }}>
          Log in with AniList <ArrowUpRight size={17} />
        </button>
        {issue?.retry && <button className="button button-subtle retry-button" onClick={() => void issue.retry?.().then(() => window.location.reload()).catch(() => undefined)}>Try that sign-in again</button>}
        <div className="auth-divider"><span /> <small>JUST THE GOOD PARTS</small> <span /></div>
        <ul className="auth-promises">
          <li><span>01</span> Your AniList token never reaches this page.</li>
          <li><span>02</span> No tracking, ratings, or duplicate lists.</li>
          <li><span>03</span> Anime details come straight from AniList.</li>
        </ul>
        <p className="auth-terms">By continuing, you authorize ARNS to identify your AniList account. Works with AniList; not affiliated with or endorsed by it.</p>
      </section>
    </main>
  )
}
