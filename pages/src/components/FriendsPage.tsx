import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Ban, Check, Clock3, Search, Sparkles, UserPlus, Users, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Avatar from './Avatar'
import { displayError, supabase, type Friendship, type Profile } from '../lib/supabase'
import type { FriendItem } from '../App'

export default function FriendsPage({ userId, relationships, friends, onChanged, online }: { userId: string; relationships: Friendship[]; friends: FriendItem[]; onChanged: () => Promise<void>; online: Set<string> }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const incoming = relationships.filter((row) => row.status === 'pending' && row.addressee === userId)
  const outgoing = relationships.filter((row) => row.status === 'pending' && row.requester === userId)
  const acceptedIds = useMemo(() => new Set(friends.map((friend) => friend.profile.id)), [friends])
  const pendingIds = useMemo(() => new Set([...incoming, ...outgoing].map((row) => row.requester === userId ? row.addressee : row.requester)), [relationships, userId])

  useEffect(() => {
    const trimmed = query.trim()
    const client = supabase
    if (trimmed.length < 2 || !client) { setResults([]); setSearching(false); return }
    let alive = true
    const timer = window.setTimeout(async () => {
      setSearching(true); setError('')
      const { data, error: searchError } = await client.rpc('search_arns_profiles', { search_query: trimmed })
      if (!alive) return
      if (searchError) setError(displayError(searchError, 'We couldn’t search AniList neighbors.'))
      setResults((data as Profile[] | null) || [])
      setSearching(false)
    }, 320)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [query, userId])

  async function sendRequest(person: Profile) {
    if (!supabase) return
    setBusyId(person.id); setError(''); setMessage('')
    const previous = relationships.find((row) => (row.requester === userId && row.addressee === person.id) || (row.requester === person.id && row.addressee === userId))
    const result = previous?.status === 'declined'
      ? await supabase.from('friendships').update({ requester: userId, addressee: person.id, status: 'pending' }).eq('id', previous.id)
      : await supabase.from('friendships').insert({ requester: userId, addressee: person.id, status: 'pending' })
    if (result.error) setError(result.error.code === '23505' ? 'There’s already a request or friendship between you two.' : displayError(result.error, 'We couldn’t send that request.'))
    else { setMessage(`A note is on its way to ${person.username}.`); await onChanged() }
    setBusyId('')
  }

  async function respond(row: Friendship, status: 'accepted' | 'declined') {
    if (!supabase) return
    setBusyId(row.id); setError('')
    const { error: updateError } = await supabase.from('friendships').update({ status }).eq('id', row.id).eq('status', 'pending')
    if (updateError) setError(displayError(updateError, 'We couldn’t update that request.'))
    else { setMessage(status === 'accepted' ? 'You’re friends now. That’s a nice start.' : 'Request declined.'); await onChanged() }
    setBusyId('')
  }

  async function blockPerson(person: Profile) {
    if (!supabase || !window.confirm(`Block ${person.username}? They won’t be able to message you or send you friend requests.`)) return
    setBusyId(person.id); setError(''); setMessage('')
    const { error: blockError } = await supabase.from('user_blocks').insert({ blocker: userId, blocked: person.id })
    if (blockError && blockError.code !== '23505') setError(displayError(blockError, 'That account couldn’t be blocked just now.'))
    else { setMessage(`${person.username} is blocked. You can review blocked accounts in Settings.`); await onChanged() }
    setBusyId('')
  }

  const resultRelationship = (id: string) => relationships.find((row) => (row.requester === userId && row.addressee === id) || (row.requester === id && row.addressee === userId))
  return <div className="friends-page">
    <div className="page-heading"><div><span className="eyebrow">MAKE ROOM AT THE TABLE</span><h1>Your people<span className="heading-period">.</span></h1><p>Find ARNS members by the AniList name they already use.</p></div><span className="heading-stamp"><Users size={19} />{friends.length} {friends.length === 1 ? 'friend' : 'friends'}</span></div>
    <section className="friend-search-panel"><label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search AniList usernames…" aria-label="Search AniList usernames" /><span>AniList</span></label><p className="search-hint">Try a username, not a real name. Search only includes people who have joined ARNS.</p>
      {message && <div className="success-message" role="status">{message}</div>}{error && <div className="error-message" role="alert">{error}</div>}
      {query.trim().length >= 2 && <div className="search-results" aria-live="polite">{searching ? <div className="loading-line"><span className="spinner" /> Looking for your people…</div> : results.length ? results.map((person) => {
        const relationship = resultRelationship(person.id)
        const isFriend = acceptedIds.has(person.id)
        const isIncoming = incoming.some((row) => row.requester === person.id)
        const isOutgoing = outgoing.some((row) => row.addressee === person.id)
        const canRetry = relationship?.status === 'declined'
        return <div className="search-result" key={person.id}><Avatar name={person.username} src={person.avatar_url} size="md" /><div className="result-name"><strong>{person.username}</strong><small>ARNS username · @{person.username}</small></div>
          {isFriend ? <button className="button button-outline button-small" onClick={() => navigate(`/chat/${person.id}`)}>Say hello</button> : isIncoming ? <span className="request-label">They wrote first</span> : isOutgoing ? <span className="request-label"><Clock3 size={14} /> Request sent</span> : <button className="button button-outline button-small" disabled={busyId === person.id || pendingIds.has(person.id)} onClick={() => void sendRequest(person)}><UserPlus size={14} /> {busyId === person.id ? 'Sending…' : canRetry ? 'Ask again' : 'Add friend'}</button>}
          <button className="icon-button danger-icon" title={`Block ${person.username}`} aria-label={`Block ${person.username}`} disabled={busyId === person.id} onClick={() => void blockPerson(person)}><Ban size={14} /></button>
        </div>
      }) : <div className="empty-search">{query.trim().length < 2 ? 'Keep typing — two letters is enough to begin.' : 'No matching AniList users found. Check the spelling and try again.'}</div>}</div>}
    </section>
    {(incoming.length > 0 || outgoing.length > 0) && <section className="requests-section"><div className="section-heading"><div><span className="eyebrow">A LITTLE HELLO</span><h2>Friend requests</h2></div></div>
      {incoming.map((row) => <RequestRow key={row.id} row={row} userId={userId} incoming onRespond={respond} busy={busyId === row.id} />)}
      {outgoing.map((row) => <RequestRow key={row.id} row={row} userId={userId} incoming={false} onRespond={respond} busy={busyId === row.id} />)}
    </section>}
    <section className="friends-roster"><div className="section-heading"><div><span className="eyebrow">THE PEOPLE YOU CAN MESSAGE</span><h2>Friends</h2></div></div>
      {friends.length ? <div className="roster-list">{friends.map(({ profile: person }) => <div className="roster-row" key={person.id}><span className="avatar-wrap"><Avatar name={person.username} src={person.avatar_url} size="md" /><i className={`presence-dot ${online.has(person.id) ? 'is-online' : ''}`} /></span><div className="result-name"><strong>{person.username}</strong><small>{online.has(person.id) ? 'Around right now' : 'A good time to say hi'}</small></div><a className="anilist-link" href={`https://anilist.co/user/${encodeURIComponent(person.username)}`} target="_blank" rel="noreferrer">AniList <ArrowUpRight size={13} /></a><button className="button button-outline button-small" onClick={() => navigate(`/compare/${person.id}`)}><Sparkles size={13} /> Taste check</button><button className="button button-primary button-small" onClick={() => navigate(`/chat/${person.id}`)}>Message</button></div>)}</div> : <div className="empty-panel friends-empty"><div className="empty-icon"><Users size={19} /></div><div><strong>It starts with one.</strong><p>Search for a friend above. We’ll keep the seat warm.</p></div></div>}
    </section>
  </div>
}

function RequestRow({ row, userId, incoming, onRespond, busy }: { row: Friendship; userId: string; incoming: boolean; onRespond: (row: Friendship, status: 'accepted' | 'declined') => void; busy: boolean }) {
  const [person, setPerson] = useState<Profile | null>(null)
  useEffect(() => {
    const id = row.requester === userId ? row.addressee : row.requester
    if (!supabase) return
    let alive = true
    void supabase.from('profiles').select('id,anilist_id,username,avatar_url,banner_url,created_at').eq('id', id).maybeSingle().then(({ data }) => { if (alive) setPerson(data as Profile | null) })
    return () => { alive = false }
  }, [row, userId])
  return <div className="request-row"><Avatar name={person?.username} src={person?.avatar_url} size="md" /><div className="result-name"><strong>{person?.username || 'AniList neighbor'}</strong><small>{incoming ? 'Would like to be friends' : 'Waiting on a reply'}</small></div>
    {incoming ? <div className="request-actions"><button className="icon-button accept-button" title="Accept request" aria-label="Accept request" disabled={busy} onClick={() => onRespond(row, 'accepted')}><Check size={17} /></button><button className="icon-button decline-button" title="Decline request" aria-label="Decline request" disabled={busy} onClick={() => onRespond(row, 'declined')}><X size={17} /></button></div> : <span className="request-label"><Clock3 size={14} /> Awaiting reply</span>}
  </div>
}
