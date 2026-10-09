import { useCallback, useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, History } from 'lucide-react'
import AnimeCard from './AnimeCard'
import Avatar from './Avatar'
import { timeLabel } from '../lib/format'
import { displayError, RECOMMENDATION_REASONS, supabase, type Profile, type Recommendation } from '../lib/supabase'

type HistoryItem = { recommendation: Recommendation; person: Profile | null; direction: 'sent' | 'received' }

export default function RecommendationHistoryPage({ userId }: { userId: string }) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [direction, setDirection] = useState<'all' | 'sent' | 'received'>('all')
  const [status, setStatus] = useState<'all' | Recommendation['status']>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError('')
    const [sent, received] = await Promise.all([
      direction === 'received' ? Promise.resolve({ data: [], error: null }) : supabase.from('recommendations').select('*').eq('sender', userId).order('created_at', { ascending: false }).limit(100),
      direction === 'sent' ? Promise.resolve({ data: [], error: null }) : supabase.from('recommendations').select('*').eq('recipient', userId).order('created_at', { ascending: false }).limit(100),
    ])
    if (sent.error || received.error) { setError(displayError(sent.error || received.error, 'Recommendation history couldn’t be loaded.')); setLoading(false); return }
    const rows = [
      ...((sent.data || []) as Recommendation[]).map((recommendation) => ({ recommendation, direction: 'sent' as const, other: recommendation.recipient })),
      ...((received.data || []) as Recommendation[]).map((recommendation) => ({ recommendation, direction: 'received' as const, other: recommendation.sender })),
    ].filter((item) => status === 'all' || item.recommendation.status === status)
    const ids = [...new Set(rows.map((item) => item.other))]
    const peopleResult = ids.length ? await supabase.from('profiles').select('id,anilist_id,username,avatar_url,banner_url,created_at').in('id', ids) : { data: [], error: null }
    if (peopleResult.error) { setError(displayError(peopleResult.error, 'The people in your history couldn’t be loaded.')); setLoading(false); return }
    const people = new Map(((peopleResult.data || []) as Profile[]).map((person) => [person.id, person]))
    setItems(rows.map(({ recommendation, direction: itemDirection, other }) => ({ recommendation, direction: itemDirection, person: people.get(other) || null })).sort((a, b) => b.recommendation.created_at.localeCompare(a.recommendation.created_at)))
    setLoading(false)
  }, [direction, status, userId])
  useEffect(() => { void load() }, [load])
  return <section className="recommendation-history-page">
    <div className="page-heading"><div><span className="eyebrow">THE STORIES YOU PASSED ALONG</span><h1>Recommendation history<span className="heading-period">.</span></h1><p>Sent and received, all in one place.</p></div><span className="heading-stamp"><History size={17} />{items.length} entries</span></div>
    <div className="history-filters"><label>Direction<select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="all">Sent and received</option><option value="sent">Sent by me</option><option value="received">Sent to me</option></select></label><label>Reply<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Every reply</option><option value="unseen">Haven’t decided</option><option value="on_my_list">On my AniList</option><option value="seen">Seen it</option><option value="not_for_me">Not for me</option></select></label></div>
    {error && <div className="error-message" role="alert">{error} <button className="text-button" onClick={() => void load()}>Try again</button></div>}
    {loading ? <div className="empty-panel"><span className="spinner" /> Gathering your history…</div> : items.length ? <div className="history-list">{items.map(({ recommendation: rec, person, direction: itemDirection }) => <article className="history-row" key={rec.id}><div className="history-row-head"><span className={`history-direction ${itemDirection}`} >{itemDirection === 'sent' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}{itemDirection === 'sent' ? `You sent to ${person?.username || 'a friend'}` : `${person?.username || 'A friend'} sent to you`}</span><time>{timeLabel(rec.created_at)}</time></div><AnimeCard mediaId={rec.anilist_media_id} />{rec.similar_to_media_id && <AnimeCard mediaId={rec.similar_to_media_id} label="Similar to" />}{rec.note && <p className="history-note">“{rec.note}”</p>}{rec.reason_tags?.length > 0 && <div className="reason-chip-list">{rec.reason_tags.map((tag) => <span key={tag}>{RECOMMENDATION_REASONS.find((reason) => reason.value === tag)?.label || tag}</span>)}</div>}<div className="history-row-foot"><span><Avatar name={person?.username} src={person?.avatar_url} size="sm" /> {itemDirection === 'sent' ? `Your friend replied: ${statusLabel(rec.status)}` : `Your reply: ${statusLabel(rec.status)}`}</span></div></article>)}</div> : <div className="empty-state large-empty"><div className="empty-icon"><History size={20} /></div><h2>No recommendations here yet.</h2><p>When you pass a story along—or a friend sends one—you’ll find it here.</p></div>}
  </section>
}

function statusLabel(status: Recommendation['status']) { return ({ unseen: 'Haven’t decided', on_my_list: 'On my AniList', seen: 'Seen it', not_for_me: 'Not for me' })[status] }
