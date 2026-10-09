import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Clock3, Play, Plus, Users } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AnimeCard from './AnimeCard'
import AnimeSearch from './AnimeSearch'
import type { Anime } from '../lib/anilist'
import { createWatchRoom } from '../lib/watchRooms'
import { displayError, supabase, type Community, type WatchAdapter, type WatchRoom } from '../lib/supabase'

const adapters: Array<{ value: WatchAdapter; label: string }> = [
  { value: 'youtube', label: 'YouTube' }, { value: 'vimeo', label: 'Vimeo' }, { value: 'twitch', label: 'Twitch' },
  { value: 'dailymotion', label: 'Dailymotion' }, { value: 'direct', label: 'Direct video file' }, { value: 'hls', label: 'HLS stream' }, { value: 'external', label: 'External sync' },
]

export default function WatchTogetherPage({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const [anime, setAnime] = useState<Anime | null>(null)
  const [episode, setEpisode] = useState('1')
  const [adapter, setAdapter] = useState<WatchAdapter>('external')
  const [source, setSource] = useState('')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [access, setAccess] = useState<'invite' | 'friends' | 'community'>('invite')
  const [communityId, setCommunityId] = useState('')
  const [communities, setCommunities] = useState<Community[]>([])
  const [rooms, setRooms] = useState<WatchRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!supabase) { setLoading(false); setError('ARNS is still connecting to watch rooms.'); return }
    setLoading(true); setError('')
    const { data: memberships, error: membershipError } = await supabase.from('watch_room_members').select('room_id').eq('user_id', userId).limit(60)
    if (membershipError) { setError(displayError(membershipError, 'Rooms couldn’t load just now.')); setRooms([]); setLoading(false); return }
    const ids = (memberships || []).map((row) => row.room_id as string)
    if (!ids.length) { setRooms([]); setLoading(false); return }
    const { data, error: roomsError } = await supabase.from('watch_rooms').select('id,host_id,media_id,episode,adapter,source_ref,state,position_seconds,state_updated_at,access,community_id,created_at').in('id', ids).order('created_at', { ascending: false })
    if (roomsError) setError(displayError(roomsError, 'Rooms couldn’t load just now.'))
    else setRooms((data || []) as WatchRoom[])
    setLoading(false)
  }, [userId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!supabase) return
    void supabase.from('community_members').select('community_id,communities(id,name)').eq('member_id', userId).then(({ data }) => {
      setCommunities((data || []).flatMap((row: any) => row.communities ? [row.communities as Community] : []))
    })
  }, [userId])

  async function startRoom(event: FormEvent) {
    event.preventDefault()
    if (!anime || !Number.isInteger(Number(episode)) || Number(episode) < 1) { setError('Choose an anime and a valid episode first.'); return }
    if (adapter !== 'external' && !source.trim()) { setError('Add a link for the selected player.'); return }
    if ((adapter === 'direct' || adapter === 'hls') && !rightsConfirmed) { setError('Confirm you have the rights to use this video.'); return }
    setBusy(true); setError('')
    try {
      const result = await createWatchRoom({ media_id: anime.id, episode: Number(episode), adapter, source_ref: adapter === 'external' ? null : source.trim(), access, community_id: access === 'community' ? communityId : null, rights_confirmed: rightsConfirmed })
      const code = result.room.invite_code
      navigate(`/watch/rooms/${result.room.id}${code ? `?code=${encodeURIComponent(code)}` : ''}`)
    } catch (reason) { setError(displayError(reason, 'The room couldn’t be started just now.')) }
    setBusy(false)
  }

  return <section className="watch-page">
    <div className="page-heading"><div><span className="eyebrow">PICK A STORY, BRING YOUR PEOPLE</span><h1>Watch together<span className="heading-period">.</span></h1><p>Sync up with the host or press play on your own legal stream at the same time.</p></div><span className="heading-stamp"><Users size={17} />Your watch room</span></div>
    <div className="watch-create-panel">
      <div className="section-heading"><div><span className="eyebrow">MAKE A ROOM</span><h2>What are we watching?</h2></div></div>
      <form className="watch-create-form" onSubmit={(event) => void startRoom(event)}>
        {anime ? <div className="watch-selected-anime"><AnimeCard mediaId={anime.id} episode={Number(episode)} /><button type="button" className="text-button" onClick={() => setAnime(null)}>Choose another</button></div> : <AnimeSearch label="Search anime for this watch room" placeholder="Find an anime on AniList…" onSelect={setAnime} />}
        <div className="watch-create-fields">
          <label className="form-field">Episode<input aria-label="Episode number" value={episode} inputMode="numeric" type="number" min={1} max={2000} onChange={(event) => setEpisode(event.target.value)} /></label>
          <label className="form-field">How will you watch?<select value={adapter} onChange={(event) => { setAdapter(event.target.value as WatchAdapter); setSource(''); setRightsConfirmed(false) }}>{adapters.map((item) => <option key={item.value} value={item.value} disabled={item.value === 'dailymotion' && !(import.meta.env.VITE_DAILYMOTION_PLAYER_ID as string | undefined)}>{item.label}{item.value === 'dailymotion' && !(import.meta.env.VITE_DAILYMOTION_PLAYER_ID as string | undefined) ? ' · add a Player ID in app settings' : ''}</option>)}</select></label>
          {adapter !== 'external' && <label className="form-field watch-source-field">{adapter === 'direct' ? 'Direct file URL' : adapter === 'hls' ? 'HLS URL' : `${adapters.find((item) => item.value === adapter)?.label} link`}<input type="url" maxLength={2048} required value={source} onChange={(event) => setSource(event.target.value)} placeholder={adapter === 'direct' || adapter === 'hls' ? 'https://…' : 'Paste a video or channel link'} /></label>}
          <label className="form-field">Who can join?<select value={access} onChange={(event) => setAccess(event.target.value as typeof access)}><option value="invite">People with the invite link</option><option value="friends">My AniList friends</option><option value="community">A community</option></select></label>
          {access === 'community' && <label className="form-field">Community<select required value={communityId} onChange={(event) => setCommunityId(event.target.value)}><option value="">Choose a community</option>{communities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        </div>
        {(adapter === 'direct' || adapter === 'hls') && <div className="rights-note"><p>Only use a video you have the right to play here, such as your own work, Creative Commons, or public domain content.</p><label><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /> I have the rights to use this video in the room.</label></div>}
        {adapter === 'external' && <p className="soft-copy">No video plays inside ARNS. Everyone uses their own legal stream; the room shares a clock and chat.</p>}
        {adapter === 'dailymotion' && !(import.meta.env.VITE_DAILYMOTION_PLAYER_ID as string | undefined) && <p className="soft-copy">Dailymotion requires a public Player ID from Dailymotion Studio in the app’s build settings.</p>}
        {error && <p className="soft-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy || !anime || (access === 'community' && !communityId) || ((adapter === 'direct' || adapter === 'hls') && !rightsConfirmed)}><Play size={15} />{busy ? 'Starting room…' : 'Start room'}</button>
      </form>
    </div>
    <section className="watch-room-list"><div className="section-heading"><div><span className="eyebrow">YOUR OPEN ROOMS</span><h2>Rooms you can return to</h2></div><button className="text-button" onClick={() => void refresh()}><Clock3 size={14} /> Refresh</button></div>
      {loading ? <p className="loading-line"><span className="spinner" /> Checking your rooms…</p> : rooms.length ? <div className="watch-room-cards">{rooms.map((room) => <div className="watch-room-card" key={room.id}><AnimeCard mediaId={room.media_id} episode={room.episode} compact /><span className="watch-room-card-meta"><small>{room.adapter === 'external' ? 'External sync' : adapters.find((item) => item.value === room.adapter)?.label} · {room.host_id === userId ? 'You’re hosting' : 'You joined'}</small><Link className="button button-outline button-small" to={`/watch/rooms/${room.id}`}>Open room</Link></span></div>)}</div> : <div className="empty-panel"><div className="empty-icon"><Users size={18} /></div><div><strong>No open rooms yet.</strong><p>Pick an anime above and invite someone over.</p></div><Plus size={16} /></div>}
    </section>
  </section>
}
