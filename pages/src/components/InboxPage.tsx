import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, BookOpen, ChevronDown, History, RotateCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import Avatar from './Avatar'
import AnimeCard from './AnimeCard'
import AniListListAction from './AniListListAction'
import { animeTitle, timeLabel } from '../lib/format'
import { getAnime, type Anime } from '../lib/anilist'
import { displayError, RECOMMENDATION_REASONS, supabase, type Profile, type Recommendation, type SharedQueue } from '../lib/supabase'

const choices: Array<{ value: Recommendation['status']; label: string }> = [
  { value: 'unseen', label: 'Haven’t decided' },
  { value: 'on_my_list', label: 'On my AniList' },
  { value: 'seen', label: 'Seen it' },
  { value: 'not_for_me', label: 'Not for me' },
]

type InboxItem = { rec: Recommendation; sender: Profile | null; anime: Anime | null }

export default function InboxPage({ userId }: { userId: string }) {
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [queues, setQueues] = useState<SharedQueue[]>([])
  const [queueSelection, setQueueSelection] = useState<Record<string, string>>({})
  const [queued, setQueued] = useState<Record<string, boolean>>({})
  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError('')
    const { data, error: loadError } = await supabase.from('recommendations').select('*').eq('recipient', userId).order('created_at', { ascending: false }).limit(60)
    if (loadError) { setError(displayError(loadError, 'Your recommendations couldn’t be loaded.')); setLoading(false); return }
    const { data: queueRows } = await supabase.from('queues').select('*').order('created_at', { ascending: false })
    setQueues((queueRows || []) as SharedQueue[])
    const recs = (data || []) as Recommendation[]
    const ids = [...new Set(recs.map((rec) => rec.sender))]
    const { data: people } = ids.length ? await supabase.from('profiles').select('id,anilist_id,username,avatar_url,banner_url,created_at').in('id', ids) : { data: [] }
    const byId = new Map(((people || []) as Profile[]).map((person) => [person.id, person]))
    const resolved = await Promise.all(recs.map(async (rec) => {
      try { return { rec, sender: byId.get(rec.sender) || null, anime: await getAnime(rec.anilist_media_id) } }
      catch { return { rec, sender: byId.get(rec.sender) || null, anime: null } }
    }))
    setItems(resolved); setLoading(false)
  }, [userId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!supabase) return
    const channel = supabase.channel(`morrow:inbox:${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'recommendations', filter: `recipient=eq.${userId}` }, () => { void load() }).subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [userId, load])

  async function updateStatus(rec: Recommendation, status: Recommendation['status']) {
    if (!supabase) return
    setBusy(rec.id); setError('')
    const { error: updateError } = await supabase.from('recommendations').update({ status }).eq('id', rec.id).eq('recipient', userId)
    if (updateError) setError(displayError(updateError, 'That status couldn’t be saved.'))
    else setItems((previous) => previous.map((item) => item.rec.id === rec.id ? { ...item, rec: { ...item.rec, status } } : item))
    setBusy('')
  }

  async function addToQueue(rec: Recommendation) {
    if (!supabase || busy) return
    const queueId = queueSelection[rec.id] || queues[0]?.id
    if (!queueId) return
    setBusy(`queue-${rec.id}`); setError('')
    const { error: addError } = await supabase.from('queue_items').insert({ queue_id: queueId, media_id: rec.anilist_media_id, added_by: userId, recommended_by: rec.sender, priority: 2, status: 'up_next' })
    if (addError) setError(displayError(addError, 'That anime couldn’t be added to the queue.'))
    else setQueued((current) => ({ ...current, [rec.id]: true }))
    setBusy('')
  }

  return <div className="inbox-page"><div className="page-heading"><div><span className="eyebrow">GOOD TASTE, PASSED ALONG</span><h1>For you<span className="heading-period">.</span></h1><p>Things a friend thought you might love. No pressure, just a nudge.</p></div><div className="heading-actions"><Link className="button button-outline button-small" to="/recommendation-history"><History size={14} /> History</Link><span className="heading-stamp"><BookOpen size={18} />{items.filter((item) => item.rec.status === 'unseen').length} new</span></div></div>
    {error && <div className="error-message" role="alert">{error} <button className="text-button" onClick={() => void load()}>Try again</button></div>}
    {loading ? <div className="recommendation-grid">{[0, 1, 2].map((n) => <div className="rec-skeleton" key={n}><span /><div><i /><i /><i /></div></div>)}</div> : items.length ? <div className="recommendation-grid">{items.map(({ rec, sender, anime }) => <article className="recommendation-card" key={rec.id}>
      {anime ? <a className="rec-cover" href={anime.siteUrl} target="_blank" rel="noreferrer"><img src={anime.coverImage.large} alt={`Cover art for ${animeTitle(anime.title)}`} loading="lazy" /><span className="cover-external"><ArrowUpRight size={15} /></span></a> : <div className="rec-cover missing-cover"><BookOpen size={22} /><span>AniList details<br />taking a pause</span></div>}
      <div className="rec-card-body"><div className="rec-from"><Avatar name={sender?.username} src={sender?.avatar_url} size="sm" /><span><strong>{sender?.username || 'A friend'}</strong><small>sent {timeLabel(rec.created_at)}</small></span></div>
        {anime ? <><a className="rec-title" href={anime.siteUrl} target="_blank" rel="noreferrer">{animeTitle(anime.title)} <ArrowUpRight size={13} /></a><div className="rec-meta">{anime.averageScore ? <span className="score-dot">{anime.averageScore}%</span> : null}{anime.format && <span>{anime.format.replaceAll('_', ' ')}</span>}{anime.episodes && <span>{anime.episodes} eps</span>}</div>{anime.genres.length > 0 && <div className="genre-list">{anime.genres.slice(0, 3).map((genre) => <span key={genre}>{genre}</span>)}</div>}</> : <div className="rec-title unavailable-title">A recommendation from AniList</div>}
        {rec.reason_tags?.length > 0 && <div className="reason-chip-list">{rec.reason_tags.map((tag) => <span key={tag}>{RECOMMENDATION_REASONS.find((reason) => reason.value === tag)?.label || tag}</span>)}</div>}
        {rec.similar_to_media_id && <AnimeCard mediaId={rec.similar_to_media_id} label="A little like" />}
        {rec.note && <blockquote className="rec-note">“{rec.note}”</blockquote>}
        <AniListListAction mediaId={rec.anilist_media_id} allowRepeat />
        {queued[rec.id] ? <p className="queue-added-note" role="status">Added to the shared queue.</p> : queues.length ? <div className="inbox-queue-action"><label className="sr-only" htmlFor={`queue-${rec.id}`}>Choose a shared queue</label><select id={`queue-${rec.id}`} value={queueSelection[rec.id] || queues[0].id} onChange={(event) => setQueueSelection((current) => ({ ...current, [rec.id]: event.target.value }))}>{queues.map((queue) => <option value={queue.id} key={queue.id}>{queue.name}</option>)}</select><button className="button button-outline button-small" disabled={busy === `queue-${rec.id}`} onClick={() => void addToQueue(rec)}>{busy === `queue-${rec.id}` ? 'Adding…' : 'Add to Watch Next'}</button></div> : <Link className="queue-added-note" to="/queues">Make a shared Watch Next queue</Link>}
        <label className="status-select-label" htmlFor={`status-${rec.id}`}>Your reply</label><div className={`status-select status-${rec.status}`}><select id={`status-${rec.id}`} value={rec.status} disabled={busy === rec.id} onChange={(event) => void updateStatus(rec, event.target.value as Recommendation['status'])}>{choices.map((choice) => <option value={choice.value} key={choice.value}>{choice.label}</option>)}</select><ChevronDown size={15} /></div>
      </div>
    </article>)}</div> : <div className="empty-state large-empty"><div className="empty-icon"><BookOpen size={21} /></div><span className="eyebrow">NOTHING ON THE SHELF YET</span><h2>Good things are on their way.</h2><p>When a friend sends a recommendation, it’ll find a home here.</p><button className="button button-outline" onClick={() => void load()}><RotateCw size={15} /> Refresh inbox</button></div>}
  </div>
}
