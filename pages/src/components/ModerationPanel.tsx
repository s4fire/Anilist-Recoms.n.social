import { useCallback, useEffect, useState } from 'react'
import { Ban, Check, Clock3, Shield, ShieldOff, Trash2, UserMinus } from 'lucide-react'
import { callEdgeFunction, EdgeFunctionError } from '../lib/edgeFunctions'
import { displayError, supabase, type CommunityPerson, type CommunityReport, type CommunitySanction, type ModAction } from '../lib/supabase'

export default function ModerationPanel({ communityId, canModerate, canManageRoles = false, isAdmin = false }: { communityId: string | null; canModerate: boolean; canManageRoles?: boolean; isAdmin?: boolean }) {
  const [reports, setReports] = useState<CommunityReport[]>([])
  const [actions, setActions] = useState<ModAction[]>([])
  const [members, setMembers] = useState<CommunityPerson[]>([])
  const [sanctions, setSanctions] = useState<CommunitySanction[]>([])
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const refresh = useCallback(async () => {
    if (!supabase) { setLoading(false); return }
    setLoading(true); setError('')
    let reportQuery = supabase.from('reports').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(60)
    let actionQuery = supabase.from('mod_actions').select('*').order('created_at', { ascending: false }).limit(40)
    if (communityId) { reportQuery = reportQuery.eq('community_id', communityId); actionQuery = actionQuery.eq('community_id', communityId) }
    else if (!isAdmin) { reportQuery = reportQuery.is('community_id', null); actionQuery = actionQuery.is('community_id', null) }
    const [reportsResult, actionsResult, memberResult, sanctionResult] = await Promise.all([
      reportQuery,
      actionQuery,
      communityId ? supabase.rpc('community_member_profiles', { p_community_id: communityId }) : Promise.resolve({ data: [], error: null }),
      communityId ? supabase.rpc('community_sanction_profiles', { p_community_id: communityId }) : Promise.resolve({ data: [], error: null }),
    ])
    if (reportsResult.error) setError(displayError(reportsResult.error, 'Reports couldn’t be loaded.'))
    else setReports((reportsResult.data || []) as CommunityReport[])
    if (!actionsResult.error) setActions((actionsResult.data || []) as ModAction[])
    if (!memberResult.error) setMembers((memberResult.data || []) as CommunityPerson[])
    if (!sanctionResult.error) setSanctions((sanctionResult.data || []) as CommunitySanction[])
    setLoading(false)
  }, [communityId, isAdmin])
  useEffect(() => { void refresh() }, [refresh])

  async function act(action: string, fields: Record<string, unknown> = {}) {
    const key = `${action}:${String(fields.target_id || fields.target_user || '')}`
    setBusy(key); setError(''); setNotice('')
    try {
      await callEdgeFunction('community-moderate', { action, ...(communityId ? { community_id: communityId } : {}), reason: reason.trim(), ...fields })
      setReason(''); setNotice('Done. The moderation log has been updated.'); await refresh()
    } catch (problem) { setError(problem instanceof EdgeFunctionError ? problem.message : 'That action couldn’t be completed just now.') }
    finally { setBusy('') }
  }

  return <section className="moderation-panel">
    <div className="section-heading"><div><span className="eyebrow">{isAdmin ? 'ACROSS ARNS' : 'KEEP THIS SPACE KIND'}</span><h2>{isAdmin ? 'Site review' : 'Moderation'}</h2></div><button className="text-button" onClick={() => void refresh()}>Refresh</button></div>
    {error && <p className="soft-error" role="alert">{error}</p>}{notice && <p className="inline-success" role="status">{notice}</p>}
    <label className="form-field">Action note <span className="character-count">{reason.length}/500</span><textarea value={reason} maxLength={500} rows={2} onChange={(event) => setReason(event.target.value)} placeholder="Optional context for the log" /></label>
    {loading ? <div className="empty-panel"><span className="spinner" />Loading the mod queue…</div> : <>
      <h3 className="moderation-subhead">Open reports <span>{reports.length}</span></h3>
      {reports.length ? <div className="report-list">{reports.map((report) => <article className="report-card" key={report.id}><div><span className="eyebrow">{report.target_type.toUpperCase()} · {new Date(report.created_at).toLocaleDateString()}</span><p>{report.reason}</p><small>Reporter {report.reporter.slice(0, 8)} · item {report.target_id.slice(0, 8)}</small></div><div className="report-actions">
        {report.target_type !== 'community' && <button className="icon-button" disabled={Boolean(busy)} aria-label="Remove reported item" title="Remove item" onClick={() => void act(report.target_type === 'message' ? 'delete-message' : 'delete-emoji', { community_id: report.community_id, target_id: report.target_id })}><Trash2 size={15} /></button>}
        {report.target_type === 'community' && isAdmin && <button className="icon-button danger-icon" disabled={Boolean(busy)} aria-label="Remove reported community" title="Remove community" onClick={() => void act('delete-community', { community_id: report.target_id, target_id: report.target_id })}><Trash2 size={15} /></button>}
        <button className="icon-button" disabled={Boolean(busy)} aria-label="Close report" title="Close report" onClick={() => void act('close-report', { community_id: report.community_id, target_id: report.id })}><Check size={15} /></button>
      </div></article>)}</div> : <p className="quiet-copy">No open reports. Thanks for keeping an eye on this place.</p>}
      {communityId && <><h3 className="moderation-subhead">Members <span>{members.length}</span></h3><div className="community-member-list">{members.map((person) => <article className="community-member-row" key={person.id}><span className="member-name"><strong>{person.username}</strong><small>{person.role}</small></span>{person.role !== 'owner' && <div className="report-actions">
        {canModerate && person.role === 'member' && <><button className="icon-button" title="Mute for one hour" aria-label={`Mute ${person.username} for one hour`} disabled={Boolean(busy)} onClick={() => void act('mute', { target_user: person.id, duration_minutes: minutes })}><Clock3 size={15} /></button><button className="icon-button" title="Remove member" aria-label={`Remove ${person.username}`} disabled={Boolean(busy)} onClick={() => void act('remove', { target_user: person.id })}><UserMinus size={15} /></button><button className="icon-button danger-icon" title="Ban from community" aria-label={`Ban ${person.username}`} disabled={Boolean(busy)} onClick={() => void act('ban', { target_user: person.id })}><Ban size={15} /></button></>}
        {canModerate && person.role === 'mod' && <button className="icon-button danger-icon" title="Remove moderator" aria-label={`Remove moderator ${person.username}`} disabled={Boolean(busy)} onClick={() => void act('remove', { target_user: person.id })}><UserMinus size={15} /></button>}
        {canManageRoles && person.role === 'member' && <button className="icon-button" title="Promote to moderator" aria-label={`Promote ${person.username} to moderator`} disabled={Boolean(busy)} onClick={() => void act('promote-mod', { target_user: person.id })}><Shield size={15} /></button>}
        {canManageRoles && person.role === 'mod' && <button className="icon-button" title="Demote moderator" aria-label={`Demote moderator ${person.username}`} disabled={Boolean(busy)} onClick={() => void act('demote-mod', { target_user: person.id })}><ShieldOff size={15} /></button>}
      </div>}</article>)}</div></>}
      {communityId && <><h3 className="moderation-subhead">Active restrictions <span>{sanctions.length}</span></h3>{sanctions.length ? <div className="community-member-list">{sanctions.map((sanction) => <article className="community-member-row" key={`${sanction.restriction}:${sanction.id}`}><span className="member-name"><strong>{sanction.username}</strong><small>{sanction.restriction === 'mute' && sanction.expires_at ? `Muted until ${new Date(sanction.expires_at).toLocaleString()}` : 'Banned from this community'}{sanction.reason ? ` · ${sanction.reason}` : ''}</small></span><button className="button button-outline button-small" disabled={Boolean(busy)} onClick={() => void act(sanction.restriction === 'mute' ? 'unmute' : 'unban', { target_user: sanction.id })}>{sanction.restriction === 'mute' ? 'Unmute' : 'Unban'}</button></article>)}</div> : <p className="quiet-copy">No active mutes or community bans.</p>}</>}
      <h3 className="moderation-subhead">Recent actions</h3>{actions.length ? <ul className="mod-log">{actions.slice(0, 20).map((item) => <li key={item.id}><span>{item.action.replaceAll('-', ' ')}</span><small>{item.reason || 'No note'} · {new Date(item.created_at).toLocaleString()}</small></li>)}</ul> : <p className="quiet-copy">Actions taken here will appear in the log.</p>}
    </>}
    <label className="form-field mute-duration">Mute duration<select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}><option value={60}>1 hour</option><option value={360}>6 hours</option><option value={1440}>1 day</option><option value={10080}>7 days</option></select></label>
  </section>
}
