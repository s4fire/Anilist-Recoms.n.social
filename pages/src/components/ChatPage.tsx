import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronUp, CornerDownLeft, MessageCircle, MoreHorizontal, Search, Send, Sparkles, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Avatar from './Avatar'
import AniListListAction from './AniListListAction'
import { animeTitle, dayLabel, timeLabel } from '../lib/format'
import { getAnime, searchAnime, type Anime } from '../lib/anilist'
import { displayError, supabase, type Message, type Profile, type Recommendation } from '../lib/supabase'

 type FeedItem = { kind: 'message'; value: Message } | { kind: 'recommendation'; value: Recommendation }

export default function ChatPage({ userId, friendId, friend: initialFriend, online, onChanged }: { userId: string; friendId: string; friend: Profile | null; online: boolean; onChanged: () => Promise<void> }) {
  const [friend, setFriend] = useState<Profile | null>(initialFriend)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [draft, setDraft] = useState('')
  const [composerMode, setComposerMode] = useState<'message' | 'recommendation'>('message')
  const [sending, setSending] = useState(false)
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState('')
  const channelRef = useRef<any>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const restoreHeight = useRef<number | null>(null)
  const navigate = useNavigate()
  const conversationKey = useMemo(() => [userId, friendId].sort().join(':'), [userId, friendId])

  useEffect(() => {
    if (initialFriend) setFriend(initialFriend)
  }, [initialFriend?.id, initialFriend?.username, initialFriend?.avatar_url, initialFriend?.banner_url])

  useEffect(() => {
    setAllowed(null)
    setFeed([])
    setLoading(true)
    if (!supabase || !friendId || friendId === userId) { setAllowed(false); setLoading(false); return }
    let alive = true
    void (async () => {
      const { data: edges, error: edgeError } = await supabase.from('friendships').select('id').eq('status', 'accepted').or(`and(requester.eq.${userId},addressee.eq.${friendId}),and(requester.eq.${friendId},addressee.eq.${userId})`).limit(1)
      if (!alive) return
      if (edgeError || !edges?.length) { setAllowed(false); setLoading(false); return }
      setAllowed(true)
      if (!initialFriend) {
        const { data: person } = await supabase.from('profiles').select('id,anilist_id,username,avatar_url,banner_url,created_at').eq('id', friendId).maybeSingle()
        if (alive) setFriend(person as Profile | null)
      }
      await loadHistory(true)
    })()
    return () => { alive = false }
  }, [userId, friendId, conversationKey])

  const loadHistory = useCallback(async (first = false) => {
    if (!supabase) return
    if (first) setLoading(true)
    const before = first ? null : feed[0]?.value.created_at
    let messageQuery = supabase.from('messages').select('*').or(`and(sender.eq.${userId},recipient.eq.${friendId}),and(sender.eq.${friendId},recipient.eq.${userId})`).order('created_at', { ascending: false }).limit(30)
    let recommendationQuery = supabase.from('recommendations').select('*').or(`and(sender.eq.${userId},recipient.eq.${friendId}),and(sender.eq.${friendId},recipient.eq.${userId})`).order('created_at', { ascending: false }).limit(30)
    if (before) { messageQuery = messageQuery.lt('created_at', before); recommendationQuery = recommendationQuery.lt('created_at', before) }
    const [messagesResult, recsResult] = await Promise.all([messageQuery, recommendationQuery])
    if (messagesResult.error || recsResult.error) { setError(displayError(messagesResult.error || recsResult.error, 'Conversation history couldn’t be loaded.')); setLoading(false); return }
    const items: FeedItem[] = [
      ...((messagesResult.data || []) as Message[]).map((value) => ({ kind: 'message' as const, value })),
      ...((recsResult.data || []) as Recommendation[]).map((value) => ({ kind: 'recommendation' as const, value })),
    ].sort((a, b) => new Date(a.value.created_at).getTime() - new Date(b.value.created_at).getTime())
    setHasMore((messagesResult.data?.length || 0) === 30 || (recsResult.data?.length || 0) === 30)
    setFeed((current) => first ? items : [...items, ...current])
    if (first) {
      setLoading(false)
      void supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('recipient', userId).eq('sender', friendId).is('read_at', null)
      void onChanged()
    }
  }, [feed, friendId, userId, onChanged])

  useEffect(() => {
    if (allowed !== true || !supabase) return
    const channel = supabase.channel(`morrow:conversation:${conversationKey}`, { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        const row = (payload.new || payload.old) as Message
        if (!row || ![row.sender, row.recipient].includes(userId) || ![row.sender, row.recipient].includes(friendId)) return
        if (payload.eventType === 'INSERT') {
          const inserted: FeedItem = { kind: 'message', value: row }
          setFeed((current) => current.some((item) => item.kind === 'message' && item.value.id === row.id) ? current : [...current, inserted].sort((a, b) => new Date(a.value.created_at).getTime() - new Date(b.value.created_at).getTime()))
        }
        if (payload.eventType === 'UPDATE') setFeed((current) => current.map((item) => item.kind === 'message' && item.value.id === row.id ? { ...item, value: row } : item))
        void onChanged()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recommendations' }, (payload) => {
        const row = (payload.new || payload.old) as Recommendation
        if (!row || ![row.sender, row.recipient].includes(userId) || ![row.sender, row.recipient].includes(friendId)) return
        if (payload.eventType === 'INSERT') {
          const inserted: FeedItem = { kind: 'recommendation', value: row }
          setFeed((current) => current.some((item) => item.kind === 'recommendation' && item.value.id === row.id) ? current : [...current, inserted].sort((a, b) => new Date(a.value.created_at).getTime() - new Date(b.value.created_at).getTime()))
        }
        if (payload.eventType === 'UPDATE') setFeed((current) => current.map((item) => item.kind === 'recommendation' && item.value.id === row.id ? { ...item, value: row } : item))
        void onChanged()
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.sender === friendId) {
          setTyping(Boolean(payload.active))
          if (payload.active) window.setTimeout(() => setTyping(false), 2200)
        }
      })
      .subscribe()
    channelRef.current = channel
    return () => { channelRef.current = null; void supabase?.removeChannel(channel) }
  }, [allowed, conversationKey, userId, friendId, onChanged])

  useEffect(() => {
    const element = feedRef.current
    if (!element || loading) return
    if (restoreHeight.current !== null) {
      element.scrollTop += element.scrollHeight - restoreHeight.current
      restoreHeight.current = null
    } else if (stickToBottom.current) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [feed.length, loading])

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault()
    const body = draft.trim()
    if (!body || !supabase || sending || allowed !== true) return
    setSending(true); setError('')
    const optimistic: Message = { id: `temp-${crypto.randomUUID()}`, sender: userId, recipient: friendId, body, created_at: new Date().toISOString(), read_at: null }
    setFeed((current) => [...current, { kind: 'message', value: optimistic }])
    setDraft('')
    const { data, error: sendError } = await supabase.from('messages').insert({ sender: userId, recipient: friendId, body }).select('*').single()
    if (sendError) { setFeed((current) => current.filter((item) => item.kind !== 'message' || item.value.id !== optimistic.id)); setDraft(body); setError(displayError(sendError, 'Your message couldn’t be sent.')) }
    else setFeed((current) => current.map((item) => item.kind === 'message' && item.value.id === optimistic.id ? { kind: 'message', value: data as Message } : item))
    setSending(false)
  }

  function broadcastTyping(value: boolean) {
    if (channelRef.current) void channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { sender: userId, active: value } })
  }

  if (allowed === false) return <div className="chat-unavailable"><div className="empty-icon"><MessageCircle size={20} /></div><span className="eyebrow">A NOTE BEFORE YOU WRITE</span><h2>This conversation isn’t open yet.</h2><p>Messages are only available between accepted friends.</p><button className="button button-outline" onClick={() => navigate('/friends')}>Go to your friends</button></div>
  if (allowed === null || !friend) return <div className="chat-loading"><span className="spinner" /> Opening your conversation…</div>

  return <section className="chat-layout">
    <header className="chat-header"><button className="icon-button back-button" onClick={() => navigate('/')} aria-label="Back to conversations"><ArrowLeft size={18} /></button><Avatar name={friend.username} src={friend.avatar_url} size="md" /><div className="chat-person"><h1>{friend.username}</h1><span><i className={`presence-dot ${online ? 'is-online' : ''}`} />{online ? 'Here now' : 'AniList friend'}</span></div><a className="chat-profile-link" href={`https://anilist.co/user/${encodeURIComponent(friend.username)}`} target="_blank" rel="noreferrer">AniList profile <ArrowUpRight size={14} /></a><button className="icon-button more-button" aria-label="More conversation details" onClick={() => navigate('/friends')}><MoreHorizontal size={19} /></button></header>
    <div className="chat-thread" ref={feedRef} onScroll={(event) => { const node = event.currentTarget; stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100 }}>
      {hasMore && !loading && <button className="load-older" onClick={() => { if (feedRef.current) restoreHeight.current = feedRef.current.scrollHeight; void loadHistory(false) }}><ChevronUp size={15} /> A little further back</button>}
      {loading ? <div className="thread-skeleton"><span /><span /><span /></div> : feed.length === 0 ? <div className="chat-empty"><div className="empty-icon"><MessageCircle size={20} /></div><h2>No messages yet.</h2><p>Send them something good to watch.</p><button className="text-button" onClick={() => setComposerMode('recommendation')}>Start with a recommendation <ChevronDown size={14} /></button></div> : <>
        <div className="thread-beginning"><span>THIS IS THE BEGINNING</span><i>✳</i><span>OF SOMETHING GOOD</span></div>
        {feed.map((item, index) => {
          const previous = feed[index - 1]
          const showDay = !previous || new Date(previous.value.created_at).toDateString() !== new Date(item.value.created_at).toDateString()
          return <div key={`${item.kind}-${item.value.id}`}>{showDay && <div className="day-divider"><span>{dayLabel(item.value.created_at)}</span></div>}
            {item.kind === 'message' ? <MessageBubble item={item.value} mine={item.value.sender === userId} /> : <FeedRecommendation item={item.value} mine={item.value.sender === userId} friend={friend} />}
          </div>
        })}
      </>}
      <AnimatePresence>{typing && <motion.div className="typing-row" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><Avatar name={friend.username} src={friend.avatar_url} size="sm" /><span><i /><i /><i /></span><small>{friend.username} is finding the words</small></motion.div>}</AnimatePresence>
    </div>
    {error && <div className="chat-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
    {composerMode === 'recommendation' ? <RecommendationComposer userId={userId} friendId={friendId} friend={friend} onClose={() => setComposerMode('message')} onSent={(rec) => { setFeed((items) => items.some((item) => item.kind === 'recommendation' && item.value.id === rec.id) ? items : [...items, { kind: 'recommendation', value: rec }]); setComposerMode('message'); void onChanged() }} /> : <form className="message-composer" onSubmit={(event) => void sendMessage(event)}>
      <button type="button" className="recommend-trigger" onClick={() => setComposerMode('recommendation')}><BookOpen size={17} /><span>Recommend<br />something</span></button>
      <div className="composer-field"><textarea value={draft} maxLength={2000} rows={1} placeholder={`Write to ${friend.username}…`} aria-label={`Message ${friend.username}`} onChange={(event) => { setDraft(event.target.value); broadcastTyping(Boolean(event.target.value.trim())) }} onBlur={() => broadcastTyping(false)} onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} /><div className="composer-hint"><span>Keep it kind; keep it yours.</span><span>{draft.length}/2000 <CornerDownLeft size={12} /> to send</span></div></div>
      <button type="submit" className="send-button" disabled={!draft.trim() || sending} aria-label="Send message">{sending ? <span className="spinner spinner-light" /> : <Send size={17} />}</button>
    </form>}
  </section>
}

function MessageBubble({ item, mine }: { item: Message; mine: boolean }) {
  return <motion.div className={`message-row ${mine ? 'message-mine' : ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}><div className={`message-bubble ${mine ? 'bubble-mine' : ''}`}><p>{item.body}</p><div className="message-meta"><time dateTime={item.created_at}>{timeLabel(item.created_at)}</time>{mine && item.read_at && <Check size={12} aria-label="Read" />}</div></div></motion.div>
}

function FeedRecommendation({ item, mine, friend }: { item: Recommendation; mine: boolean; friend: Profile }) {
  const [anime, setAnime] = useState<Anime | null>(null)
  useEffect(() => { let alive = true; void getAnime(item.anilist_media_id).then((value) => { if (alive) setAnime(value) }).catch(() => { if (alive) setAnime(null) }); return () => { alive = false } }, [item.anilist_media_id])
  return <motion.article className={`chat-rec-row ${mine ? 'chat-rec-mine' : ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
    <div className="chat-rec-label"><Sparkles size={13} />{mine ? `A little something for ${friend.username}` : `${friend.username} thought of you`}</div>
    <div className="chat-rec-card">{anime ? <a href={anime.siteUrl} target="_blank" rel="noreferrer" className="chat-rec-cover"><img src={anime.coverImage.large} alt={`Cover art for ${animeTitle(anime.title)}`} loading="lazy" /></a> : <div className="chat-rec-cover rec-cover-loading"><BookOpen size={18} /></div>}
      <div className="chat-rec-details"><strong>{anime ? animeTitle(anime.title) : 'AniList recommendation'}</strong><div className="chat-rec-meta">{anime?.averageScore && <span>{anime.averageScore}%</span>}{anime?.format && <span>{anime.format.replaceAll('_', ' ')}</span>}<time>{timeLabel(item.created_at)}</time></div>{item.note && <p>{item.note}</p>}<a href={anime?.siteUrl || `https://anilist.co/anime/${item.anilist_media_id}`} target="_blank" rel="noreferrer">See on AniList <ArrowUpRight size={12} /></a><AniListListAction mediaId={item.anilist_media_id} /></div>
      {item.recipient === item.sender ? null : item.status !== 'unseen' && !mine ? <span className={`tiny-status status-${item.status}`}>{statusLabel(item.status)}</span> : null}
    </div>
  </motion.article>
}

function statusLabel(status: Recommendation['status']) { return ({ unseen: 'New', watching: 'Interested', watched: 'Seen it', not_for_me: 'Not for me' })[status] }

function RecommendationComposer({ userId, friendId, friend, onClose, onSent }: { userId: string; friendId: string; friend: Profile; onClose: () => void; onSent: (rec: Recommendation) => void }) {
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')
  const [results, setResults] = useState<Anime[]>([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setSearching(false); return }
    let alive = true
    const timer = window.setTimeout(() => { setSearching(true); void searchAnime(query.trim()).then((items) => { if (alive) setResults(items) }).catch((reason) => { if (alive) setError(displayError(reason, 'AniList search is unavailable.')) }).finally(() => { if (alive) setSearching(false) }) }, 350)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [query])
  async function send(anime: Anime) {
    if (!supabase) return
    setBusyId(anime.id); setError(''); setSent('')

    const { data, error: insertError } = await supabase.from('recommendations').insert({ sender: userId, recipient: friendId, anilist_media_id: anime.id, note: note.trim() || null, status: 'unseen' }).select('*').single()
    if (insertError) setError(displayError(insertError, 'Your recommendation couldn’t be sent.'))
    else { onSent(data as Recommendation); setSent('Sent to ' + friend.username + '.'); setQuery(''); setNote(''); setResults([]) }
    setBusyId(null)
  }
  return <div className="rec-composer">
    <div className="rec-composer-head"><div><span className="eyebrow">PASS A STORY ALONG</span><h3>Recommend to {friend.username}</h3></div><button className="icon-button" onClick={onClose} aria-label="Close recommendation composer"><X size={18} /></button></div>
    <label className="composer-search"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setError('') }} placeholder="Find an anime on AniList…" autoFocus /><span>ANIList</span></label>
    <label className="note-label" htmlFor="recommendation-note">Add a note <span>Optional · {note.length}/280</span></label><textarea id="recommendation-note" className="note-input" maxLength={280} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="The ending stayed with me for days…" />
    {error && <div className="error-message" role="alert">{error}</div>}{sent && <div className="success-message" role="status">{sent}</div>}
    <div className="composer-results" aria-live="polite">{searching ? <div className="loading-line"><span className="spinner" /> Looking through AniList…</div> : results.map((anime) => <div className="composer-result" key={anime.id}><img src={anime.coverImage.large} alt="" loading="lazy" /><div><strong>{animeTitle(anime.title)}</strong><small>{anime.format?.replaceAll('_', ' ') || 'Anime'}{anime.averageScore ? ` · ${anime.averageScore}%` : ''}</small></div><button className="button button-outline button-small" disabled={busyId === anime.id} onClick={() => void send(anime)}>{busyId === anime.id ? 'Sending…' : 'Send rec'}</button></div>)}{query.trim().length >= 2 && !searching && results.length === 0 && !error && <p className="empty-search">No anime found. Try another title.</p>}{query.trim().length < 2 && <p className="composer-tip">Search by title. Your friend can tell you what they thought in the inbox.</p>}</div>
    <div className="composer-footer"><span>Media details are fetched live from AniList.</span><button className="text-button" onClick={onClose}>Back to message <ChevronDown size={14} /></button></div>
  </div>
}
