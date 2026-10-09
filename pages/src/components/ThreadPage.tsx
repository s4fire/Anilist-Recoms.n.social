import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, MessageCircle, Send } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import AnimeCard from './AnimeCard'
import { getAnimeProgress } from '../lib/anilist'
import { shouldBlurSpoiler } from '../lib/taste'
import { displayError, supabase, type AnimeThread, type Profile, type ThreadPost } from '../lib/supabase'

type ThreadAuthor = Pick<Profile, 'id' | 'username' | 'avatar_url'>
const PAGE_SIZE = 30

export default function ThreadPage({ userId, anilistId }: { userId: string; anilistId: number }) {
  const { threadId = '' } = useParams()
  const [thread, setThread] = useState<AnimeThread | null>(null)
  const [posts, setPosts] = useState<ThreadPost[]>([])
  const [authors, setAuthors] = useState<Map<string, ThreadAuthor>>(new Map())
  const [progress, setProgress] = useState<number | null>(null)
  const [progressLoaded, setProgressLoaded] = useState(false)
  const [pageOffset, setPageOffset] = useState(PAGE_SIZE)
  const [hasMore, setHasMore] = useState(false)
  const [draft, setDraft] = useState('')
  const [episodeTag, setEpisodeTag] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError('')
    const { data: threadData, error: threadError } = await supabase.from('threads').select('*').eq('id', threadId).maybeSingle()
    if (threadError || !threadData) { setError(displayError(threadError, 'This thread isn’t available.')); setLoading(false); return }
    setThread(threadData as AnimeThread)
    const { data: postData, error: postError } = await supabase.from('thread_posts').select('*').eq('thread_id', threadId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, PAGE_SIZE - 1)
    if (postError) { setError(displayError(postError, 'Replies couldn’t be loaded.')); setLoading(false); return }
    const rows = (postData || []) as ThreadPost[]
    setPosts(rows.reverse()); setPageOffset(rows.length); setHasMore(rows.length === PAGE_SIZE)
    const { data: authorRows } = await supabase.rpc('thread_author_profiles', { p_thread_id: threadId })
    setAuthors(new Map(((authorRows || []) as ThreadAuthor[]).map((author) => [author.id, author])))
    setLoading(false)
  }, [threadId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!thread || !anilistId) { setProgress(null); setProgressLoaded(true); return }
    let alive = true
    setProgressLoaded(false)
    void getAnimeProgress(anilistId, thread.media_id).then((value) => { if (alive) setProgress(value) }).catch(() => { if (alive) setProgress(null) }).finally(() => { if (alive) setProgressLoaded(true) })
    return () => { alive = false }
  }, [thread, anilistId])
  useEffect(() => {
    if (!supabase || !threadId) return
    const client = supabase
    const channel = client.channel(`arns:thread:${threadId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'thread_posts', filter: `thread_id=eq.${threadId}` }, (payload) => {
      const post = payload.new as ThreadPost
      setPosts((current) => current.some((row) => row.id === post.id) ? current : [...current, post])
      void client.rpc('thread_author_profiles', { p_thread_id: threadId }).then(({ data }) => {
        setAuthors(new Map(((data || []) as ThreadAuthor[]).map((author) => [author.id, author])))
      })
    }).subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [threadId])

  async function loadOlder() {
    if (!supabase || !hasMore || busy) return
    setBusy(true); setError('')
    const { data, error: olderError } = await supabase.from('thread_posts').select('*').eq('thread_id', threadId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(pageOffset, pageOffset + PAGE_SIZE - 1)
    if (olderError) setError(displayError(olderError, 'Older replies couldn’t be loaded.'))
    else {
      const older = ((data || []) as ThreadPost[]).reverse()
      setPosts((current) => [...older.filter((post) => !current.some((row) => row.id === post.id)), ...current])
      setPageOffset((offset) => offset + older.length); setHasMore(older.length === PAGE_SIZE)
      const newIds = [...new Set(older.map((post) => post.author).filter((id) => !authors.has(id))) ]
      if (newIds.length) {
        const { data: authorRows } = await supabase.rpc('thread_author_profiles', { p_thread_id: threadId })
        setAuthors(new Map(((authorRows || []) as ThreadAuthor[]).map((author) => [author.id, author])))
      }
    }
    setBusy(false)
  }
  async function send(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !draft.trim() || busy) return
    setBusy(true); setError('')
    const { data, error: sendError } = await supabase.functions.invoke('thread-post', { body: { thread_id: threadId, body: draft.trim(), episode_tag: episodeTag ? Number(episodeTag) : null } })
    if (sendError || !data?.post) setError(displayError(sendError, data?.error || 'Your reply couldn’t be sent.'))
    else { const post = data.post as ThreadPost; setPosts((current) => current.some((row) => row.id === post.id) ? current : [...current, post]); setDraft(''); setEpisodeTag('') }
    setBusy(false)
  }
  if (loading) return <div className="empty-panel"><span className="spinner" /> Opening the thread…</div>
  if (!thread) return <section className="error-message" role="alert">{error || 'This thread isn’t available.'} <Link to="/">Back to your space</Link></section>
  return <section className="thread-page">
    <Link className="text-button" to={`/anime/${thread.media_id}/threads`}><ArrowLeft size={14} /> All anime threads</Link>
    <AnimeCard mediaId={thread.media_id} episode={thread.episode} label="ANIME THREAD" />
    <header className="thread-detail-heading"><span className="eyebrow">{thread.episode ? `EPISODE ${thread.episode}` : 'OPEN DISCUSSION'}</span><h1>{thread.title}</h1><p>Started {new Date(thread.created_at).toLocaleDateString()} · Keep it kind, and tag the episode you’re discussing.</p></header>
    <div className="courtesy-spoiler-note" role="note">Spoiler blur is a courtesy, not security. Someone can still reveal a tagged post.</div>
    {error && <div className="error-message" role="alert">{error}</div>}
    {hasMore && <button className="button button-outline button-small" onClick={() => void loadOlder()} disabled={busy}>Load older replies</button>}
    <div className="thread-posts" aria-live="polite">{posts.length ? posts.map((post) => <SpoilerPost key={post.id} post={post} author={authors.get(post.author)} mine={post.author === userId} progress={progressLoaded ? progress : null} />) : <div className="empty-panel"><div className="empty-icon"><MessageCircle size={18} /></div><div><strong>The thread is open.</strong><p>Share the first thought, with an episode tag if it helps.</p></div></div>}</div>
    <form className="thread-reply-form" onSubmit={(event) => void send(event)}><label>Your reply<textarea value={draft} maxLength={2000} onChange={(event) => setDraft(event.target.value)} placeholder="What did you notice?" rows={3} /></label><label className="episode-tag-label">Spoilers through episode<input type="number" min="1" max="9999" value={episodeTag} onChange={(event) => setEpisodeTag(event.target.value)} placeholder="No spoiler tag" /></label><button className="button button-primary" disabled={!draft.trim() || busy}>{busy ? 'Sending…' : <><Send size={14} /> Post reply</>}</button></form>
  </section>
}

function SpoilerPost({ post, author, mine, progress }: { post: ThreadPost; author?: ThreadAuthor; mine: boolean; progress: number | null }) {
  const [revealed, setRevealed] = useState(false)
  const hidden = shouldBlurSpoiler(post.episode_tag, progress) && !revealed
  return <article className="thread-post"><header><strong>{mine ? 'You' : author?.username || 'An ARNS member'}</strong><time>{new Date(post.created_at).toLocaleString()}</time></header>{hidden ? <button className="spoiler-blur" onClick={() => setRevealed(true)} aria-label={`Reveal post with spoilers through episode ${post.episode_tag}`}><span>Contains spoilers for episode {post.episode_tag}</span><small>Tap to reveal · courtesy blur only</small></button> : <div className="thread-post-body">{post.episode_tag && <span className="episode-tag">Through episode {post.episode_tag}</span>}<p>{post.body}</p>{post.episode_tag && progress === null && <small>We couldn’t confirm your public AniList progress, so tagged spoilers stay blurred until you reveal them.</small>}</div>}</article>
}
