import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { MessageCircle, Plus, RotateCw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import AnimeCard from './AnimeCard'
import { displayError, supabase, type AnimeThread } from '../lib/supabase'

export default function AnimeThreadsPage() {
  const { mediaId: rawId = '' } = useParams()
  const mediaId = Number(rawId)
  const [threads, setThreads] = useState<AnimeThread[]>([])
  const [title, setTitle] = useState('')
  const [episode, setEpisode] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!supabase || !Number.isSafeInteger(mediaId) || mediaId <= 0) { setError('That AniList ID doesn’t look right.'); setLoading(false); return }
    setLoading(true); setError('')
    const { data, error: loadError } = await supabase.from('threads').select('*').eq('media_id', mediaId).order('created_at', { ascending: false }).limit(60)
    if (loadError) setError(displayError(loadError, 'The anime’s threads couldn’t be loaded.'))
    else setThreads((data || []) as AnimeThread[])
    setLoading(false)
  }, [mediaId])
  useEffect(() => { void load() }, [load])
  async function create(event: FormEvent) {
    event.preventDefault()
    if (!supabase || busy || !title.trim()) return
    setBusy(true); setError('')
    const { data, error: createError } = await supabase.functions.invoke('thread-create', { body: { media_id: mediaId, title: title.trim(), episode: episode ? Number(episode) : null } })
    if (createError || !data?.thread) setError(displayError(createError, data?.error || 'That thread couldn’t be started.'))
    else { setThreads((current) => [data.thread as AnimeThread, ...current]); setTitle(''); setEpisode('') }
    setBusy(false)
  }
  if (!Number.isSafeInteger(mediaId) || mediaId <= 0) return <div className="error-message" role="alert">That AniList anime ID isn’t valid.</div>
  return <section className="anime-threads-page">
    <div className="thread-page-nav"><Link className="text-button" to="/">Back to your space</Link></div>
    <AnimeCard mediaId={mediaId} label="DISCUSS THIS ANIME" />
    <div className="page-heading"><div><span className="eyebrow">A PLACE FOR THOUGHTS, NOT SPOILERS</span><h1>Anime threads<span className="heading-period">.</span></h1><p>Talk episodes, characters, and the scenes that stayed with you.</p></div><span className="heading-stamp"><MessageCircle size={17} />{threads.length} threads</span></div>
    {error && <div className="error-message" role="alert">{error} <button className="text-button" onClick={() => void load()}>Try again</button></div>}
    <form className="thread-create-form" onSubmit={(event) => void create(event)}><label>Start a thread<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="What did you think of the first episode?" /></label><label>Episode, if relevant<input value={episode} type="number" min="1" max="9999" onChange={(event) => setEpisode(event.target.value)} placeholder="Optional" /></label><button className="button button-primary" disabled={!title.trim() || busy}>{busy ? 'Opening…' : <><Plus size={15} /> Start thread</>}</button></form>
    {loading ? <div className="empty-panel"><span className="spinner" /> Gathering the conversation…</div> : threads.length ? <div className="thread-list">{threads.map((thread) => <Link className="thread-list-item" key={thread.id} to={`/threads/${thread.id}`}><span className="thread-list-icon"><MessageCircle size={17} /></span><span><strong>{thread.title}</strong><small>{thread.episode ? `Episode ${thread.episode} · ` : ''}{new Date(thread.created_at).toLocaleDateString()}</small></span><span className="thread-list-arrow">Open</span></Link>)}</div> : <div className="empty-state large-empty"><div className="empty-icon"><MessageCircle size={19} /></div><h2>Start the first conversation.</h2><p>Keep the episode number in the title if you want people to know where you are.</p><button className="button button-outline" onClick={() => void load()}><RotateCw size={14} /> Refresh threads</button></div>}
  </section>
}
