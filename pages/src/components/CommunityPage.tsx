import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowLeft, Hash, MessageSquareText, Plus, ShieldCheck, Trash2, Users } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import AnimeCard from './AnimeCard'
import AnimeSearch from './AnimeSearch'
import EmojiPicker from './EmojiPicker'
import ModerationPanel from './ModerationPanel'
import { callEdgeFunction, EdgeFunctionError } from '../lib/edgeFunctions'
import { getAnimeProgress } from '../lib/anilist'
import { shouldBlurSpoiler } from '../lib/taste'
import { displayError, supabase, type Community, type CommunityChannel, type CommunityEmoji, type CommunityMessage, type CommunityPerson } from '../lib/supabase'

function MessageBody({ body, emojis }: { body: string; emojis: CommunityEmoji[] }) {
  const byName = useMemo(() => new Map(emojis.map((item) => [item.name, item])), [emojis])
  return <span className="community-message-body">{body.split(/(:[a-z0-9_]{2,32}:)/g).map((part, index) => {
    const emoji = /^:([a-z0-9_]{2,32}):$/.exec(part)
    const item = emoji ? byName.get(emoji[1]) : undefined
    return item?.url ? <img key={`${item.id}:${index}`} className="inline-community-emoji" src={item.url} alt={item.name} title={`:${item.name}:`} /> : <span key={index}>{part}</span>
  })}</span>
}

function SpoilerAwareBody({ mediaId, episode, anilistId, children }: { mediaId: number | null; episode: number | null; anilistId: number; children: ReactNode }) {
  const [progress, setProgress] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    let alive = true
    setProgress(null); setLoaded(false); setRevealed(false)
    if (!episode) { setLoaded(true); return () => { alive = false } }
    if (!mediaId || !anilistId) { setLoaded(true); return () => { alive = false } }
    void getAnimeProgress(anilistId, mediaId).then((value) => { if (alive) setProgress(value) }).catch(() => { if (alive) setProgress(null) }).finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [mediaId, episode, anilistId])
  if (!episode) return <>{children}</>
  if (!loaded) return <span className="spoiler-loading">Checking your AniList progress…</span>
  if (!shouldBlurSpoiler(episode, progress) || revealed) return <>{children}</>
  return <button type="button" className="community-spoiler" aria-label={`Reveal content with spoilers through episode ${episode}`} onClick={() => setRevealed(true)}><span className="community-spoiler-content" aria-hidden="true">{children}</span><span className="community-spoiler-overlay">Contains spoilers for episode {episode}<small>Tap to reveal · courtesy blur, not security</small></span></button>
}

export default function CommunityPage({ userId, isAdmin, anilistId }: { userId: string; isAdmin: boolean; anilistId: number }) {
  const { communityId = '' } = useParams()
  const [community, setCommunity] = useState<Community | null>(null)
  const [channels, setChannels] = useState<CommunityChannel[]>([])
  const [activeChannel, setActiveChannel] = useState('')
  const [membership, setMembership] = useState<CommunityPerson | null>(null)
  const [people, setPeople] = useState<CommunityPerson[]>([])
  const [messages, setMessages] = useState<CommunityMessage[]>([])
  const [emojis, setEmojis] = useState<CommunityEmoji[]>([])
  const [draft, setDraft] = useState('')
  const [mediaId, setMediaId] = useState<number | null>(null)
  const [episode, setEpisode] = useState('')
  const [showAnime, setShowAnime] = useState(false)
  const [newChannel, setNewChannel] = useState('')
  const [newChannelKind, setNewChannelKind] = useState<'chat' | 'threads'>('chat')
  const [newChannelMediaId, setNewChannelMediaId] = useState<number | null>(null)
  const [newChannelEpisode, setNewChannelEpisode] = useState('')
  const [showChannelAnime, setShowChannelAnime] = useState(false)
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [showModeration, setShowModeration] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canModerate = isAdmin || membership?.role === 'owner' || membership?.role === 'mod'
  const active = channels.find((channel) => channel.id === activeChannel) || channels[0]

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); setError('ARNS is still connecting to communities.'); return }
    setLoading(true); setError('')
    const client = supabase
    const [communityResult, channelResult, memberResult, emojiResult] = await Promise.all([
      client.from('communities').select('*').eq('id', communityId).maybeSingle(),
      client.from('channels').select('*').eq('community_id', communityId).order('position').order('name'),
      client.rpc('community_member_profiles', { p_community_id: communityId }),
      client.from('community_emojis').select('*').eq('community_id', communityId).order('name'),
    ])
    if (communityResult.error || !communityResult.data) { setError(displayError(communityResult.error, 'That community isn’t available.')); setLoading(false); return }
    const currentCommunity = communityResult.data as Community
    setCommunity(currentCommunity)
    const channelRows = (channelResult.data || []) as CommunityChannel[]
    if (channelResult.error) setError(displayError(channelResult.error, 'Channels couldn’t be loaded.'))
    setChannels(channelRows)
    setActiveChannel((current) => channelRows.some((row) => row.id === current) ? current : channelRows[0]?.id || '')
    const memberRows = (memberResult.data || []) as CommunityPerson[]
    setPeople(memberRows)
    setMembership(memberRows.find((person) => person.id === userId) || null)
    const { data: emojiRows } = emojiResult
    const emojiWithUrls = ((emojiRows || []) as CommunityEmoji[]).map((emoji) => ({ ...emoji, url: client.storage.from('community-emojis').getPublicUrl(emoji.path).data.publicUrl }))
    setEmojis(emojiWithUrls)
    setLoading(false)
  }, [communityId, userId])
  useEffect(() => { void load() }, [load])

  const loadMessages = useCallback(async (channelId: string) => {
    if (!supabase || !channelId) { setMessages([]); return }
    const { data, error: messageError } = await supabase.from('channel_messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(80)
    if (messageError) setError(displayError(messageError, 'Messages couldn’t be loaded.'))
    else setMessages(((data || []) as CommunityMessage[]).reverse())
  }, [])
  useEffect(() => { void loadMessages(active?.id || '') }, [active?.id, loadMessages])
  useEffect(() => {
    if (!supabase || !active?.id) return
    const client = supabase
    const channel = client.channel(`arns:channel:${active.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'channel_messages', filter: `channel_id=eq.${active.id}` }, (payload) => {
      if (payload.eventType === 'INSERT') setMessages((current) => current.some((item) => item.id === (payload.new as CommunityMessage).id) ? current : [...current, payload.new as CommunityMessage].slice(-80))
      if (payload.eventType === 'DELETE') setMessages((current) => current.filter((item) => item.id !== (payload.old as CommunityMessage).id))
    }).subscribe()
    return () => { void client.removeChannel(channel) }
  }, [active?.id])

  async function join() {
    if (!supabase || !community) return
    setBusy(true); setError(''); setNotice('')
    const { error: joinError } = await supabase.from('community_members').insert({ community_id: community.id, member_id: userId, role: 'member' })
    if (joinError) setError(displayError(joinError, 'You couldn’t join this community just now.'))
    else { setNotice('You’re in. Say hello when you’re ready.'); await load() }
    setBusy(false)
  }
  async function leave() {
    if (!supabase || !membership) return
    setBusy(true); setError('')
    const { error: leaveError } = await supabase.from('community_members').delete().eq('community_id', communityId).eq('member_id', userId)
    if (leaveError) setError(displayError(leaveError, 'You couldn’t leave just now.'))
    else { setMembership(null); setNotice('You’ve left this community.'); await load() }
    setBusy(false)
  }
  async function send(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !active || !membership || !draft.trim() || busy) return
    setBusy(true); setError(''); setNotice('')
    const parsedEpisode = episode.trim() ? Number(episode) : null
    if (episode && (!Number.isSafeInteger(parsedEpisode) || Number(parsedEpisode) < 1)) { setError('Episode number should be a positive whole number.'); setBusy(false); return }
    const { error: sendError } = await supabase.from('channel_messages').insert({ channel_id: active.id, author: userId, body: draft.trim(), media_id: mediaId, episode: parsedEpisode })
    if (sendError) setError(displayError(sendError, 'Your message couldn’t be sent.'))
    else { setDraft(''); setMediaId(null); setEpisode(''); setShowAnime(false) }
    setBusy(false)
  }
  async function addChannel(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !community || !canModerate || busy) return
    const name = newChannel.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 32)
    setBusy(true); setError('')
    const parsedEpisode = newChannelEpisode ? Number(newChannelEpisode) : null
    if (newChannelEpisode && (!Number.isSafeInteger(parsedEpisode) || Number(parsedEpisode) < 1)) { setError('Episode number should be a positive whole number.'); setBusy(false); return }
    const { data, error: channelError } = await supabase.from('channels').insert({ community_id: community.id, name, kind: newChannelKind, position: channels.length, media_id: newChannelMediaId, episode: parsedEpisode }).select('*').single()
    if (channelError || !data) setError(displayError(channelError, 'That channel couldn’t be added. The community may have reached its 20-channel limit.'))
    else { setChannels((current) => [...current, data as CommunityChannel]); setActiveChannel(data.id); setNewChannel(''); setNewChannelMediaId(null); setNewChannelEpisode(''); setShowChannelAnime(false); setShowChannelForm(false) }
    setBusy(false)
  }
  async function reportCommunity() {
    if (!community) return
    const reason = window.prompt('What should moderators know?')?.trim()
    if (!reason) return
    try { await callEdgeFunction('community-moderate', { action: 'report', target_type: 'community', target_id: community.id, reason }); setNotice('Thanks. Your report is with the moderators.') }
    catch (problem) { setError(problem instanceof EdgeFunctionError ? problem.message : 'That report couldn’t be sent.') }
  }
  async function deleteCommunity() {
    if (!community || !window.confirm(`Remove “${community.name}” and its messages? This can’t be undone.`)) return
    try { await callEdgeFunction('community-moderate', { action: 'delete-community', community_id: community.id, target_id: community.id, reason: 'Community owner requested removal.' }); window.location.hash = '#/communities' }
    catch (problem) { setError(problem instanceof EdgeFunctionError ? problem.message : 'That community couldn’t be removed.') }
  }
  function insertEmoji(token: string) { setDraft((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${token} `) }
  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(event as unknown as FormEvent) } }

  if (loading) return <div className="empty-panel"><span className="spinner" />Opening the community…</div>
  if (!community) return <section className="error-message" role="alert">{error || 'That community isn’t available.'}<Link to="/communities">Back to communities</Link></section>
  return <section className="community-page">
    <Link to="/communities" className="text-button"><ArrowLeft size={14} /> All communities</Link>
    <header className="community-banner"><div><span className="eyebrow">/{community.slug} · {community.visibility === 'public' ? 'PUBLIC COMMUNITY' : 'UNLISTED COMMUNITY'}</span><h1>{community.name}<span className="heading-period">.</span></h1><p>{community.description || 'A place to trade good stories and talk about what you love.'}</p><small><Users size={13} /> {people.length} {people.length === 1 ? 'member' : 'members'}</small></div><div className="community-actions">
      {!membership ? <button className="button button-primary" disabled={busy} onClick={() => void join()}>Join community</button> : membership.role !== 'owner' ? <button className="button button-outline" disabled={busy} onClick={() => void leave()}>Leave community</button> : <span className="role-pill"><ShieldCheck size={13} />Owner</span>}
      <button className="text-button" onClick={() => void reportCommunity()}>Report community</button>
      {canModerate && <button className="button button-outline" onClick={() => setShowModeration(!showModeration)}><ShieldCheck size={14} />{showModeration ? 'Close moderation' : 'Moderation'}</button>}
      {((membership?.role === 'owner') || isAdmin) && <button className="icon-button danger-icon" aria-label="Remove community" title="Remove community" onClick={() => void deleteCommunity()}><Trash2 size={15} /></button>}
    </div></header>
    {notice && <p className="inline-success" role="status">{notice}</p>}{error && <p className="inline-alert" role="alert">{error}</p>}
    {showModeration && <ModerationPanel communityId={community.id} canModerate={canModerate} canManageRoles={membership?.role === 'owner'} isAdmin={isAdmin} />}
    <div className="community-layout"><aside className="community-channel-sidebar"><div className="channel-sidebar-title"><span>CHANNELS</span>{canModerate && <button className="icon-button small" aria-label="Add channel" title="Add channel" onClick={() => setShowChannelForm(!showChannelForm)}><Plus size={14} /></button>}</div>
      {showChannelForm && <form className="add-channel-form" onSubmit={(event) => void addChannel(event)}><input value={newChannel} onChange={(event) => setNewChannel(event.target.value)} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9-]{1,31}" required placeholder="channel-name" aria-label="New channel name" /><label className="form-field">Channel type<select value={newChannelKind} onChange={(event) => setNewChannelKind(event.target.value as 'chat' | 'threads')}><option value="chat">Chat</option><option value="threads">Discussion</option></select></label><button type="button" className="text-button" onClick={() => setShowChannelAnime(!showChannelAnime)}>{newChannelMediaId ? 'Change anime reference' : 'Add anime reference'}</button>{showChannelAnime && <AnimeSearch onSelect={(anime) => { setNewChannelMediaId(anime.id); setShowChannelAnime(false) }} />}{newChannelMediaId && <label className="form-field">Episode (optional)<input value={newChannelEpisode} type="number" min={1} onChange={(event) => setNewChannelEpisode(event.target.value)} placeholder="e.g. 4" /></label>}{newChannelMediaId && <AnimeCard mediaId={newChannelMediaId} episode={newChannelEpisode ? Number(newChannelEpisode) : null} compact />}<button className="button button-outline" disabled={busy}>Add channel</button><small>Up to 20 channels, names use letters, numbers, and hyphens.</small></form>}
      <nav aria-label="Community channels">{channels.map((channel) => <div key={channel.id} className="community-channel-row"><button className={`community-channel-link ${active?.id === channel.id ? 'is-active' : ''}`} onClick={() => setActiveChannel(channel.id)}><span>{channel.kind === 'chat' ? <Hash size={15} /> : <MessageSquareText size={15} />}{channel.name}</span></button>{canModerate && !['general', 'recommendations'].includes(channel.name) && <button type="button" className="icon-button small channel-remove-button" aria-label={`Remove ${channel.name} channel`} title="Remove channel" onClick={() => void callEdgeFunction('community-moderate', { action: 'delete-channel', community_id: community.id, target_id: channel.id, reason: 'Removed by a community moderator.' }).then(() => { setChannels((current) => current.filter((item) => item.id !== channel.id)); if (active?.id === channel.id) setActiveChannel(channels.find((item) => item.id !== channel.id)?.id || '') }).catch((problem) => setError(problem instanceof EdgeFunctionError ? problem.message : 'That channel couldn’t be removed.'))}><Trash2 size={12} /></button>}</div>)}</nav>
      <div className="member-mini-list"><span className="eyebrow">PEOPLE HERE</span>{people.slice(0, 8).map((person) => <span key={person.id} className="member-mini"><strong>{person.username}</strong><small>{person.role}</small></span>)}</div>
    </aside><section className="community-chat-panel"><header className="channel-heading"><div><span className="eyebrow">{community.name}</span><h2>{active ? `${active.kind === 'chat' ? '#' : '↳'} ${active.name}` : 'Channels'}</h2></div>{active?.media_id && <AnimeCard mediaId={active.media_id} episode={active.episode} compact />}</header>
      <div className="community-message-list" aria-live="polite">{messages.length ? messages.map((message) => { const author = people.find((person) => person.id === message.author); return <article className="community-message" key={message.id}><span className="community-message-avatar">{author?.username.slice(0, 1).toUpperCase() || 'A'}</span><div className="community-message-content"><div className="community-message-meta"><strong>{author?.username || 'Community member'}</strong><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time><button className="text-button report-message-button" onClick={() => { const reason = window.prompt('What should moderators know?')?.trim(); if (!reason) return; void callEdgeFunction('community-moderate', { action: 'report', target_type: 'message', target_id: message.id, reason }).then(() => setNotice('Thanks. Your report is with the moderators.')).catch((problem) => setError(problem instanceof EdgeFunctionError ? problem.message : 'That report couldn’t be sent.')) }}>Report</button>{canModerate && <button className="text-button report-message-button" onClick={() => void callEdgeFunction('community-moderate', { action: 'delete-message', community_id: community.id, target_id: message.id, reason: 'Removed by a community moderator.' }).then(() => setNotice('The message was removed.')).catch((problem) => setError(problem instanceof EdgeFunctionError ? problem.message : 'That message couldn’t be removed.'))}>Remove</button>}</div><p><SpoilerAwareBody mediaId={message.media_id} episode={message.episode} anilistId={anilistId}><MessageBody body={message.body} emojis={emojis} /></SpoilerAwareBody></p>{message.media_id && <AnimeCard mediaId={message.media_id} episode={message.episode} compact />}</div></article> }) : <div className="empty-panel"><div className="empty-icon"><MessageSquareText size={18} /></div><div><strong>{membership ? 'A fresh page.' : 'Have a look around.'}</strong><p>{membership ? 'Start a conversation and make this channel feel like home.' : 'Join to post, or read what the community is talking about.'}</p></div></div>}</div>
      {membership ? <form className="community-composer" onSubmit={(event) => void send(event)}><textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 2000))} onKeyDown={composerKeyDown} maxLength={2000} rows={2} placeholder={`Message #${active?.name || 'community'}…`} aria-label="Community message" /><div className="community-composer-tools"><EmojiPicker communityId={community.id} emojis={emojis} canManage={canModerate} onPick={insertEmoji} onAdded={(emoji) => setEmojis((current) => [...current, { ...emoji, url: emoji.url || supabase?.storage.from('community-emojis').getPublicUrl(emoji.path).data.publicUrl }])} onRemoved={(id) => setEmojis((current) => current.filter((emoji) => emoji.id !== id))} /><button type="button" className="button button-outline" onClick={() => setShowAnime(!showAnime)}>{mediaId ? 'Change anime' : 'Add anime'}</button><small>{draft.length}/2000 · Shift+Enter for a new line</small><button className="button button-primary" disabled={busy || !draft.trim()}>{busy ? 'Sending…' : 'Send'}</button></div>
        {showAnime && <div className="community-anime-picker"><AnimeSearch onSelect={(anime) => { setMediaId(anime.id); setShowAnime(false) }} />{mediaId && <label className="form-field">Episode (optional)<input value={episode} type="number" min={1} onChange={(event) => setEpisode(event.target.value)} placeholder="e.g. 4" /></label>}{mediaId && <button type="button" className="text-button" onClick={() => { setMediaId(null); setEpisode('') }}>Remove anime reference</button>}</div>}
      </form> : <div className="join-to-post">Join this community to post. <button className="text-button" onClick={() => void join()}>Join now</button></div>}
    </section></div>
  </section>
}
