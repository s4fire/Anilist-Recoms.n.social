import { useEffect, useState } from 'react'
import { Ban, Search, ShieldCheck } from 'lucide-react'
import ModerationPanel from './ModerationPanel'
import { callEdgeFunction, EdgeFunctionError } from '../lib/edgeFunctions'
import { displayError, supabase, type Profile } from '../lib/supabase'

export default function AdminPage() {
  const [query, setQuery] = useState('')
  const [reason, setReason] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [bans, setBans] = useState<Array<{ user_id: string; reason: string; created_at: string }>>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!supabase) return
    void supabase.from('site_bans').select('user_id,reason,created_at').order('created_at', { ascending: false }).limit(40).then(({ data, error: loadError }) => {
      if (loadError) setError(displayError(loadError, 'Site bans couldn’t be loaded.'))
      else setBans((data || []) as typeof bans)
    })
  }, [])
  useEffect(() => {
    const term = query.trim()
    const client = supabase
    if (!client || term.length < 2) { setResults([]); return }
    let alive = true
    const timer = window.setTimeout(async () => {
      const { data, error: searchError } = await client.rpc('search_arns_profiles', { search_query: term })
      if (!alive) return
      if (searchError) setError(displayError(searchError, 'Member search is unavailable.'))
      setResults((data || []) as Profile[])
    }, 300)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [query])
  async function siteBan(person: Profile) {
    setBusy(person.id); setError(''); setNotice('')
    try {
      await callEdgeFunction('community-moderate', { action: 'site-ban', target_user: person.id, reason: reason.trim() })
      setBans((current) => [{ user_id: person.id, reason: reason.trim(), created_at: new Date().toISOString() }, ...current])
      setNotice(`${person.username} can no longer post or send friend requests.`); setReason('')
    } catch (problem) { setError(problem instanceof EdgeFunctionError ? problem.message : 'That site-wide ban couldn’t be applied.') }
    finally { setBusy('') }
  }
  async function siteUnban(userId: string) {
    setBusy(userId); setError(''); setNotice('')
    try {
      await callEdgeFunction('community-moderate', { action: 'site-unban', target_user: userId, reason: reason.trim() })
      setBans((current) => current.filter((ban) => ban.user_id !== userId))
      setNotice('The site-wide ban was removed.'); setReason('')
    } catch (problem) { setError(problem instanceof EdgeFunctionError ? problem.message : 'That site-wide ban couldn’t be removed.') }
    finally { setBusy('') }
  }
  return <section className="admin-page"><div className="page-heading"><div><span className="eyebrow">SITE-WIDE REVIEW</span><h1>Admin<span className="heading-period">.</span></h1><p>Reports and account actions across ARNS.</p></div><span className="heading-stamp"><ShieldCheck size={16} />Restricted access</span></div>
    {error && <p className="inline-alert" role="alert">{error}</p>}{notice && <p className="inline-success" role="status">{notice}</p>}
    <ModerationPanel communityId={null} canModerate={false} isAdmin />
    <section className="admin-ban-panel"><div className="section-heading"><div><span className="eyebrow">ACCOUNT SAFETY</span><h2>Site-wide bans</h2></div></div><label className="community-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a member by username" aria-label="Find a member to ban" /></label><label className="form-field">Reason for the audit log<textarea value={reason} maxLength={500} rows={2} onChange={(event) => setReason(event.target.value)} placeholder="Optional note for other admins" /></label>
      {results.length > 0 && <div className="admin-search-results">{results.map((person) => <div className="community-member-row" key={person.id}><strong>{person.username}</strong><button className="button button-outline button-small" disabled={Boolean(busy)} onClick={() => void siteBan(person)}><Ban size={13} />{busy === person.id ? 'Applying…' : 'Ban across ARNS'}</button></div>)}</div>}
      {bans.length > 0 && <ul className="mod-log">{bans.map((ban) => <li key={ban.user_id}><span>Site-wide ban · {ban.user_id.slice(0, 8)}</span><small>{ban.reason || 'No note'} · {new Date(ban.created_at).toLocaleString()} <button className="text-button" disabled={Boolean(busy)} onClick={() => void siteUnban(ban.user_id)}>Unban</button></small></li>)}</ul>}
    </section>
  </section>
}
