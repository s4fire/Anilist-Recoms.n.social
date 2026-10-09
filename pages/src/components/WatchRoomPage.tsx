import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowLeft, ArrowUpRight, Check, Copy, MessageCircle, Pause, Play, RefreshCw, Send, Users, Volume2 } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AnimeCard from './AnimeCard'
import { getAnimeExternalLinks, type AnimeExternalLink } from '../lib/anilist'
import { displayError, supabase, type Profile, type RoomMessage, type WatchRoom } from '../lib/supabase'
import { expectedRoomPosition, joinWatchRoom, leaveWatchRoom, needsRoomSync, roomSupportsSeek, sendRoomMessage, transferWatchHost } from '../lib/watchRooms'
import { createPlayerAdapter } from './playerAdapters'
import type { PlaybackState, PlayerAdapter } from './PlayerAdapter'

type Participant = { user_id: string; username: string; avatar_url: string | null; online: boolean; typing: boolean }
const reactions = ['👏', '✨', '😭', '🍿']

function timeLabel(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

export default function WatchRoomPage({ userId }: { userId: string }) {
  const { roomId = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [room, setRoom] = useState<WatchRoom | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [reaction, setReaction] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [episodeDraft, setEpisodeDraft] = useState('')
  const [adapterState, setAdapterState] = useState<PlaybackState>('paused')
  const [seekDraft, setSeekDraft] = useState('')
  const [externalLinks, setExternalLinks] = useState<AnimeExternalLink[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null>(null)
  const [hasOlder, setHasOlder] = useState(false)
  const playerRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<PlayerAdapter | null>(null)
  const realtimeRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null)
  const applyingState = useRef(false)
  const isHostRef = useRef(false)
  const countdownTimers = useRef<number[]>([])
  const currentRoomRef = useRef<WatchRoom | null>(null)
  const syncToRoomRef = useRef<(next: WatchRoom) => Promise<void>>(async () => {})
  const isHost = room?.host_id === userId
  currentRoomRef.current = room
  isHostRef.current = isHost
  const expected = room ? expectedRoomPosition(room) : 0
  const visibleParticipants = useMemo(() => participants.filter((person) => person.online), [participants])

  const refreshMessages = useCallback(async (before?: string) => {
    if (!supabase || !roomId) return
    let query = supabase.from('room_messages').select('id,room_id,author,body,created_at').eq('room_id', roomId).order('created_at', { ascending: false }).limit(41)
    if (before) query = query.lt('created_at', before)
    const { data, error: messageError } = await query
    if (messageError) { setError(displayError(messageError, 'Room chat couldn’t load just now.')); return }
    const rows = ((data || []) as RoomMessage[]).reverse()
    setHasOlder(rows.length > 40)
    const page = rows.slice(-40)
    if (before) setMessages((current) => [...page, ...current])
    else setMessages(page)
    if (page.length) { setOlderCursor(page[0].created_at) }
  }, [roomId])

  useEffect(() => {
    let alive = true
    setLoading(true); setError(''); setRoom(null); setMessages([])
    void joinWatchRoom(roomId, params.get('code') || undefined).then(async ({ room: joined }) => {
      if (!alive) return
      if (!supabase) throw new Error('ARNS is still connecting to watch rooms.')
      setRoom(joined); setEpisodeDraft(String(joined.episode))
      await refreshMessages()
      setLoading(false)
    }).catch((reason) => {
      if (alive) { setError(displayError(reason, 'This room isn’t available right now.')); setLoading(false) }
    })
    return () => { alive = false }
  }, [roomId, params, refreshMessages])

  useEffect(() => {
    const activeRoom = currentRoomRef.current
    if (!activeRoom || !supabase) return
    let alive = true
    const memberIds = new Set<string>()
    void supabase.from('watch_room_members').select('user_id').eq('room_id', activeRoom.id).then(({ data }) => {
      if (data) for (const item of data) memberIds.add(item.user_id as string)
      void loadProfiles()
    })
    async function loadProfiles() {
      if (!memberIds.size) return
      const { data } = await supabase!.from('profiles').select('id,username,avatar_url').in('id', [...memberIds])
      if (!alive) return
      setParticipants((current) => {
        const onlineIds = new Set(current.filter((person) => person.online).map((person) => person.user_id))
        return ((data || []) as Pick<Profile, 'id' | 'username' | 'avatar_url'>[]).map((profile) => ({ user_id: profile.id, username: profile.username, avatar_url: profile.avatar_url, online: onlineIds.has(profile.id), typing: false }))
      })
    }
    const channel = supabase.channel(`watch-room:${activeRoom.id}`, { config: { private: true, presence: { key: userId }, broadcast: { self: false } } })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'watch_rooms', filter: `id=eq.${activeRoom.id}` }, (payload) => {
        const next = payload.new as WatchRoom
        setRoom(next)
        if (next.host_id !== userId) void syncToRoomRef.current(next)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${activeRoom.id}` }, (payload) => {
        const next = payload.new as RoomMessage
        setMessages((current) => current.some((message) => message.id === next.id) ? current : [...current, next].slice(-200))
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, Array<{ user_id?: string; username?: string; avatar_url?: string | null }>>
        const online = new Map<string, { username: string; avatar_url: string | null }>()
        for (const [key, metas] of Object.entries(state)) {
          const meta = metas[0]
          if (meta) online.set(meta.user_id || key, { username: meta.username || 'Friend', avatar_url: meta.avatar_url || null })
        }
        setParticipants((current) => {
          const currentById = new Map(current.map((person) => [person.user_id, person]))
          for (const [id, meta] of online) if (!currentById.has(id)) currentById.set(id, { user_id: id, username: meta.username, avatar_url: meta.avatar_url, online: true, typing: false })
          return [...currentById.values()].map((person) => ({ ...person, online: online.has(person.user_id), ...(online.has(person.user_id) ? online.get(person.user_id)! : {}) }))
        })
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const author = String((payload as { user_id?: string }).user_id || '')
        if (author === userId) return
        const typing = (payload as { typing?: boolean }).typing === true
        setParticipants((current) => current.map((person) => person.user_id === author ? { ...person, typing } : person))
        if (typing) window.setTimeout(() => setParticipants((current) => current.map((person) => person.user_id === author ? { ...person, typing: false } : person)), 1800)
      })
      .on('broadcast', { event: 'reaction' }, ({ payload }) => { const emoji = String((payload as { emoji?: string }).emoji || ''); if (reactions.includes(emoji)) setReaction(emoji) })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          const { data: profile } = await supabase!.from('profiles').select('username,avatar_url').eq('id', userId).maybeSingle()
          await channel.track({ user_id: userId, username: profile?.username || 'Friend', avatar_url: profile?.avatar_url || null, at: new Date().toISOString() })
          const latestRoom = currentRoomRef.current
          if (latestRoom && latestRoom.host_id !== userId) void syncToRoomRef.current(latestRoom)
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setNotice('Reconnecting to the room…')
        if (status === 'SUBSCRIBED') setNotice('')
      })
    realtimeRef.current = channel
    void loadProfiles()
    return () => { alive = false; realtimeRef.current = null; void supabase?.removeChannel(channel) }
  }, [room?.id, userId])

  const syncToRoom = useCallback(async (next: WatchRoom) => {
    const player = adapterRef.current
    if (!player || next.adapter === 'external') return
    const target = expectedRoomPosition(next)
    applyingState.current = true
    try {
      if (roomSupportsSeek(next) && needsRoomSync(player.getTime(), target)) await player.seek(target)
      if (next.state === 'playing') await player.play()
      else await player.pause()
      setNotice('')
    } catch { setNotice('Your browser paused playback. Use “Sync me” when you’re ready.') }
    window.setTimeout(() => { applyingState.current = false }, 350)
  }, [])
  syncToRoomRef.current = syncToRoom

  const externalMediaId = room?.adapter === 'external' ? room.media_id : null
  useEffect(() => {
    if (externalMediaId === null) return
    let alive = true
    void getAnimeExternalLinks(externalMediaId).then((links) => { if (alive) setExternalLinks(links) }).catch(() => { if (alive) setExternalLinks([]) })
    return () => { alive = false }
  }, [externalMediaId])

  useEffect(() => {
    const activeRoom = currentRoomRef.current
    if (!activeRoom || !playerRef.current || activeRoom.adapter === 'external') return
    const player = createPlayerAdapter(activeRoom.adapter)
    if (!player) return
    adapterRef.current = player
    let alive = true
    const unsubscribe = player.onStateChange((state) => {
      if (!alive) return
      setAdapterState(state)
      if (isHostRef.current && !applyingState.current && (state === 'playing' || state === 'paused')) {
        const currentTime = player.getTime()
        const next = { state, position_seconds: Math.max(0, Math.min(currentTime, 86400)), state_updated_at: new Date().toISOString() }
        void supabase?.from('watch_rooms').update(next).eq('id', activeRoom.id).eq('host_id', userId).then(({ error: updateError }) => {
          if (updateError) setNotice('The room clock couldn’t update. Try again in a moment.')
        })
      }
    })
    void player.load(playerRef.current, activeRoom.source_ref).then(() => {
      if (alive && !player.canEmbed && player.error) setError(player.error)
      if (alive && player.canEmbed) void syncToRoom(activeRoom)
    })
    return () => { alive = false; unsubscribe(); player.destroy(); adapterRef.current = null }
  }, [room?.id, room?.adapter, room?.source_ref, userId, syncToRoom])

  useEffect(() => {
    if (!room || isHost || room.adapter === 'external') return
    const timer = window.setInterval(() => {
      const player = adapterRef.current
      if (!player || room.state !== 'playing') return
      const position = expectedRoomPosition(room)
      if (roomSupportsSeek(room) && needsRoomSync(player.getTime(), position)) void player.seek(position).catch(() => setNotice('Your player couldn’t sync automatically. Use “Sync me”.'))
    }, 6000)
    return () => window.clearInterval(timer)
  }, [room, isHost])

  useEffect(() => () => { for (const timer of countdownTimers.current) window.clearTimeout(timer) }, [])

  async function publishHostState(state: 'playing' | 'paused', position = adapterRef.current?.getTime() || 0) {
    if (!room || !isHost || !supabase) return
    if (room.adapter === 'external' && position === 0) position = expectedRoomPosition(room)
    const next = { state, position_seconds: Math.max(0, Math.min(position, 86400)), state_updated_at: new Date().toISOString() }
    const { error: saveError } = await supabase.from('watch_rooms').update(next).eq('id', room.id).eq('host_id', userId)
    if (saveError) setError(displayError(saveError, 'The room clock couldn’t update.'))
    else setRoom({ ...room, ...next })
  }

  async function hostPlay() {
    if (!room || !isHost) return
    if (room.adapter === 'external') {
      for (const timer of countdownTimers.current) window.clearTimeout(timer)
      countdownTimers.current = []
      setCountdown(3)
      countdownTimers.current.push(window.setTimeout(() => setCountdown(2), 1000), window.setTimeout(() => setCountdown(1), 2000))
      countdownTimers.current.push(window.setTimeout(() => { setCountdown(0); void publishHostState('playing', expectedRoomPosition(room)) }, 3000))
    } else {
      try { await adapterRef.current?.play() } catch { setNotice('The provider blocked playback. Press play in its player controls.') }
      void publishHostState('playing')
    }
  }

  async function hostPause() {
    if (!room || !isHost) return
    for (const timer of countdownTimers.current) window.clearTimeout(timer)
    countdownTimers.current = []
    setCountdown(0)
    if (room.adapter !== 'external') await adapterRef.current?.pause()
    void publishHostState('paused')
  }

  async function syncMe() {
    if (!room) return
    const target = expectedRoomPosition(room)
    if (room.adapter === 'external') { setNotice(`Your cue is ${timeLabel(target)}. Open your own legal stream and join in.`); return }
    try {
      applyingState.current = true
      if (roomSupportsSeek(room) && needsRoomSync(adapterRef.current?.getTime() || 0, target)) await adapterRef.current?.seek(target)
      if (room.state === 'playing') await adapterRef.current?.play()
      else await adapterRef.current?.pause()
      setNotice(roomSupportsSeek(room) ? 'You’re back with the room.' : 'Twitch live streams can’t seek. Play and pause still follow the host.')
    } catch { setNotice('The browser blocked the sync. Press play in the provider player, then try again.') }
    window.setTimeout(() => { applyingState.current = false }, 350)
  }

  async function seekRoom(event: FormEvent) {
    event.preventDefault()
    if (!room || !isHost || !/^\d+(\.\d+)?$/.test(seekDraft)) return
    const target = Math.min(86400, Number(seekDraft))
    if (room.adapter !== 'external') {
      try { await adapterRef.current?.seek(target) }
      catch { setError('The player couldn’t seek to that time.'); return }
    }
    const next = { state: room.state, position_seconds: target, state_updated_at: new Date().toISOString() }
    const { error: updateError } = await supabase!.from('watch_rooms').update(next).eq('id', room.id).eq('host_id', userId)
    if (updateError) setError(displayError(updateError, 'The room position couldn’t be updated.'))
    else { setRoom({ ...room, ...next }); setSeekDraft('') }
  }

  async function changeEpisode(event: FormEvent) {
    event.preventDefault()
    if (!room || !isHost || !supabase || !/^\d+$/.test(episodeDraft) || Number(episodeDraft) < 1 || Number(episodeDraft) > 2000) return
    const { error: updateError } = await supabase.from('watch_rooms').update({ episode: Number(episodeDraft), position_seconds: 0, state: 'paused', state_updated_at: new Date().toISOString() }).eq('id', room.id).eq('host_id', userId)
    if (updateError) setError(displayError(updateError, 'The episode couldn’t be changed.'))
    else { setRoom({ ...room, episode: Number(episodeDraft), position_seconds: 0, state: 'paused', state_updated_at: new Date().toISOString() }); if (room.adapter !== 'external') { await adapterRef.current?.pause(); await adapterRef.current?.seek(0) } }
  }

  async function postMessage(event?: FormEvent) {
    event?.preventDefault()
    if (!room || !draft.trim() || sending) return
    setSending(true); setError('')
    try { const { message } = await sendRoomMessage(room.id, draft.trim()); setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]); setDraft(''); void realtimeRef.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId, typing: false } }) }
    catch (reason) { setError(displayError(reason, 'Your message couldn’t be sent.')) }
    setSending(false)
  }

  async function transfer(nextHost: string) {
    if (!room || !nextHost) return
    setError('')
    try { await transferWatchHost(room.id, nextHost); setNotice('Host controls transferred.') }
    catch (reason) { setError(displayError(reason, 'The host controls couldn’t be transferred.')) }
  }

  async function leave() {
    if (!room) return
    try { await leaveWatchRoom(room.id); navigate('/watch-together') }
    catch (reason) { setError(displayError(reason, 'Transfer host controls before leaving the room.')) }
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1800) }
    catch { setError('Copy this page link from your browser’s address bar to invite someone.') }
  }

  async function reportOutOfSync() {
    if (!room) return
    try {
      const { message } = await sendRoomMessage(room.id, 'I’m out of sync. Can we pause for a moment?')
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
      setNotice('Let everyone know you’re out of sync. Use “Sync me” to catch up.')
    } catch (reason) { setError(displayError(reason, 'The room couldn’t send that note.')) }
  }

  function announceTyping() { void realtimeRef.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId, typing: true } }) }
  function sendReaction(emoji: string) { void realtimeRef.current?.send({ type: 'broadcast', event: 'reaction', payload: { emoji } }) }
  function onChatKey(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void postMessage() } }

  if (loading) return <div className="empty-state"><span className="spinner" /><p>Finding your seat in the room…</p></div>
  if (error && !room) return <section className="empty-state large-empty"><div className="empty-icon"><Users size={20} /></div><h2>This room isn’t available.</h2><p>{error}</p><Link className="button button-outline" to="/watch-together"><ArrowLeft size={15} /> Back to watch rooms</Link></section>
  if (!room) return null

  return <section className="watch-room-page">
    <header className="watch-room-header"><Link className="icon-button" to="/watch-together" aria-label="Back to watch rooms"><ArrowLeft size={17} /></Link><div><span className="eyebrow">{isHost ? 'YOU’RE HOSTING' : 'YOU’RE WATCHING TOGETHER'}</span><h1>Episode {room.episode}</h1></div><span className="watch-live-status"><i />{room.state === 'playing' ? 'Playing' : 'Paused'}</span></header>
    <div className="watch-room-grid">
      <div className="watch-main-column">
        <div className="watch-room-anime"><AnimeCard mediaId={room.media_id} episode={room.episode} /><a className="anilist-link" href={`https://anilist.co/anime/${room.media_id}`} target="_blank" rel="noreferrer">AniList page <ArrowUpRight size={13} /></a></div>
        {room.adapter === 'external' ? <div className="external-sync-panel"><span className="external-sync-icon"><Volume2 size={22} /></span><span className="eyebrow">EXTERNAL SYNC</span><h2>Watch on your own stream.</h2><p>ARNS doesn’t play or share the video. Open a stream you’re allowed to use, then use the room clock to line up with everyone.</p>{externalLinks.length > 0 && <div className="external-anilist-links"><span>Available on AniList</span>{externalLinks.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer">{link.site}<ArrowUpRight size={12} /></a>)}</div>}<div className="external-clock"><small>{room.state === 'playing' ? 'ROOM CLOCK' : 'PAUSED AT'}</small><strong>{timeLabel(expected)}</strong><span>{room.state === 'playing' ? 'Everyone’s cue is moving.' : 'The host has paused the room.'}</span></div></div> : <div className="watch-player-wrap"><div className="watch-player" ref={playerRef} aria-label={`${room.adapter} player`} />{adapterState === 'error' && <p className="soft-error">The provider couldn’t play this link. Try another embed-eligible video.</p>}</div>}
        <div className="watch-sync-controls"><button className="button button-outline" onClick={() => void syncMe()}><RefreshCw size={14} /> Sync me</button><span>{room.adapter === 'external' ? 'Open your legal stream and match the room clock.' : isHost ? 'Your controls set the shared room clock.' : 'Host controls playback. You can sync your player any time.'}</span><button className="text-button" onClick={() => void reportOutOfSync()}>I’m out of sync</button></div>
        <div className="watch-host-tools"><div className="watch-clock-copy"><strong>{room.state === 'playing' ? 'The room is rolling.' : 'The room is paused.'}</strong><small>{isHost ? 'Player actions and seeks update the shared clock.' : `The host is ${room.state === 'playing' ? 'playing' : 'paused'}.`}</small></div>
          {isHost ? <div className="watch-host-buttons"><button className="button button-primary" onClick={() => void hostPlay()} disabled={room.state === 'playing' || countdown > 0}><Play size={14} />{countdown ? `Starting in ${countdown}…` : room.state === 'playing' ? 'Playing' : 'Play together'}</button><button className="button button-outline" onClick={() => void hostPause()} disabled={room.state === 'paused' && countdown === 0}><Pause size={14} />Pause</button></div> : <span className="host-controls-label"><Users size={14} /> Host controls playback</span>}
        </div>
        {isHost && <div className="watch-host-editors"><form className="watch-episode-form" onSubmit={(event) => void changeEpisode(event)}><label className="form-field">Room episode<input type="number" min={1} max={2000} value={episodeDraft} onChange={(event) => setEpisodeDraft(event.target.value)} /></label><button className="button button-outline button-small">Change episode</button></form>{roomSupportsSeek(room) && <form className="watch-episode-form" onSubmit={(event) => void seekRoom(event)}><label className="form-field">Set room position (seconds)<input inputMode="decimal" value={seekDraft} onChange={(event) => setSeekDraft(event.target.value)} placeholder={String(Math.floor(expected))} /></label><button className="button button-outline button-small">Seek together</button></form>}</div>}
        <div className="watch-reactions" aria-label="Send a room reaction">{reactions.map((emoji) => <button key={emoji} aria-label={`Send ${emoji} reaction`} onClick={() => sendReaction(emoji)}>{emoji}</button>)}{reaction && <span className="reaction-pop" aria-live="polite">{reaction}</span>}</div>
      </div>
      <aside className="watch-side-column">
        <section className="watch-participants"><div className="watch-side-heading"><div><span className="eyebrow">THE ROOM</span><h2><Users size={16} /> People here</h2></div><span>{visibleParticipants.length}</span></div>
          <ul>{participants.map((person) => <li key={person.user_id}><span className="watch-person-avatar">{person.username.slice(0, 1).toUpperCase()}<i className={person.online ? 'online' : ''} /></span><span><strong>{person.username}</strong><small>{person.user_id === room.host_id ? 'Host' : person.typing ? 'Finding the words…' : person.online ? 'In the room' : 'Away'}</small></span>{person.user_id === room.host_id && <span className="host-pill">HOST</span>}</li>)}</ul>
          {isHost && participants.some((person) => person.user_id !== userId) && <label className="form-field transfer-host">Pass host controls to<select defaultValue="" onChange={(event) => { if (event.target.value) void transfer(event.target.value); event.target.value = '' }}><option value="">Choose a participant</option>{participants.filter((person) => person.user_id !== userId).map((person) => <option key={person.user_id} value={person.user_id}>{person.username}</option>)}</select></label>}
          <button className="button button-outline button-small invite-button" onClick={() => void copyInvite()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Invite link copied' : 'Copy invite link'}</button>
          {!isHost && <button className="text-button leave-room-button" onClick={() => void leave()}>Leave this room</button>}
        </section>
        <section className="watch-chat"><div className="watch-side-heading"><div><span className="eyebrow">SAY IT HERE</span><h2><MessageCircle size={16} /> Room chat</h2></div></div>
          {hasOlder && <button className="text-button load-room-older" onClick={() => olderCursor && void refreshMessages(olderCursor)}>Load older messages</button>}
          <div className="watch-message-list" aria-live="polite">{messages.length ? messages.map((message) => { const person = participants.find((item) => item.user_id === message.author); return <article className={`watch-message ${message.author === userId ? 'watch-message-mine' : ''}`} key={message.id}><div><strong>{person?.username || (message.author === userId ? 'You' : 'Friend')}</strong><time>{new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div><p>{message.body}</p></article> }) : <div className="watch-chat-empty"><MessageCircle size={18} /><p>Nothing in the chat yet. You can start with “Ready?”</p></div>}</div>
          <form className="watch-chat-composer" onSubmit={(event) => void postMessage(event)}><textarea aria-label="Write a room message" value={draft} maxLength={1000} rows={2} onChange={(event) => { setDraft(event.target.value); announceTyping() }} onKeyDown={onChatKey} placeholder="A quick thought…" /><button className="button button-primary" disabled={!draft.trim() || sending} aria-label="Send message"><Send size={15} /></button><small>Enter to send · Shift+Enter for a new line</small></form>
        </section>
      </aside>
    </div>
    {(notice || error) && <div className={error ? 'inline-alert watch-inline-alert' : 'watch-notice'} role={error ? 'alert' : 'status'}>{error || notice}{error && <button onClick={() => setError('')}>Dismiss</button>}</div>}
    {countdown > 0 && <div className="watch-countdown" aria-live="assertive">{countdown}</div>}
  </section>
}
