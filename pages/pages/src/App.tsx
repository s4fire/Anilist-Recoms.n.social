import { useCallback, useEffect, useState } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, ChevronRight, CircleHelp, Compass, LogOut, MessageCircle, Search, Sparkles, Users, X } from 'lucide-react'
import AuthView, { type AuthIssue } from './components/AuthView'
import Avatar from './components/Avatar'
import ChatPage from './components/ChatPage'
import FriendsPage from './components/FriendsPage'
import InboxPage from './components/InboxPage'
import { getUser, type AniListUser } from './lib/anilist'
import { displayError } from './lib/supabase'
import { supabase, type Friendship, type Profile } from './lib/supabase'

export type FriendItem = { relationship: Friendship; profile: Profile }

function AppHome({ bootstrapIssue }: { bootstrapIssue: AuthIssue }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [friends, setFriends] = useState<FriendItem[]>([])
  const [relationships, setRelationships] = useState<Friendship[]>([])
  const [online, setOnline] = useState<Set<string>>(new Set())
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [inboxCount, setInboxCount] = useState(0)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [socialError, setSocialError] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!supabase) return
    let alive = true
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setUserId(session?.user.id ?? null)
    })
    void supabase.auth.getSession().then(({ data }) => { if (alive) setUserId(data.session?.user.id ?? null) })
    return () => { alive = false; listener.subscription.unsubscribe() }
  }, [])

  const refreshSocial = useCallback(async () => {
    if (!supabase || !userId) return
    const client = supabase
    setSocialError('')
    const { data, error } = await client.from('friendships').select('*').or(`requester.eq.${userId},addressee.eq.${userId}`).order('created_at', { ascending: false })
    if (error) { setSocialError(displayError(error, 'We couldn’t refresh your friends.')); return }
    const rows = (data || []) as Friendship[]
    setRelationships(rows)
    const accepted = rows.filter((row) => row.status === 'accepted')
    const ids = [...new Set(accepted.map((row) => row.requester === userId ? row.addressee : row.requester))]
    if (!ids.length) { setFriends([]); setUnread({}); return }
    const { data: people, error: peopleError } = await client.from('profiles').select('id,anilist_id,username,avatar_url,banner_url,created_at').in('id', ids)
    if (peopleError) { setSocialError(displayError(peopleError, 'We couldn’t load your friends.')); return }
    const byId = new Map((people as Profile[]).map((person) => [person.id, person]))
    setFriends(accepted.flatMap((relationship) => {
      const otherId = relationship.requester === userId ? relationship.addressee : relationship.requester
      const person = byId.get(otherId)
      return person ? [{ relationship, profile: person }] : []
    }).sort((a, b) => a.profile.username.localeCompare(b.profile.username)))
    const counts = await Promise.all(ids.map(async (id) => {
      const result = await client.from('messages').select('id', { count: 'exact', head: true }).eq('recipient', userId).eq('sender', id).is('read_at', null)
      return [id, result.count || 0] as const
    }))
    setUnread(Object.fromEntries(counts))
    const inbox = await client.from('recommendations').select('id', { count: 'exact', head: true }).eq('recipient', userId).eq('status', 'unseen')
    setInboxCount(inbox.count || 0)
  }, [userId])

  useEffect(() => {
    if (!supabase || !userId) { setProfile(null); setLoadingProfile(false); return }
    let alive = true
    setLoadingProfile(true)
    void supabase.from('profiles').select('id,anilist_id,username,avatar_url,banner_url,created_at').eq('id', userId).maybeSingle().then(({ data, error }) => {
      if (!alive) return
      if (error) setSocialError(displayError(error, 'Your profile is taking a moment to load.'))
      setProfile((data as Profile | null) || null)
      setLoadingProfile(false)
    })
    void refreshSocial()
    const channel = supabase.channel('morrow:presence', { config: { presence: { key: userId } } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => { void refreshSocial() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => { void refreshSocial() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recommendations' }, () => { void refreshSocial() })
      .on('presence', { event: 'sync' }, () => {
        const ids = Object.keys(channel.presenceState()).filter((key) => key !== userId)
        setOnline(new Set(ids))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ user_id: userId, at: new Date().toISOString() })
      })
    return () => { alive = false; void supabase?.removeChannel(channel) }
  }, [userId, refreshSocial])

  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  if (!userId) return <AuthView issue={bootstrapIssue} />
  if (loadingProfile) return <div className="boot-screen"><span className="brand-mark">m</span><span>Finding your corner…</span></div>

  async function logout() {
    await supabase?.auth.signOut()
    navigate('/')
  }

  return (
    <div className="app-shell">
      <button className="mobile-menu-button" aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setDrawerOpen(!drawerOpen)}>
        {drawerOpen ? <X size={20} /> : <Users size={20} />}
      </button>
      <AnimatePresence>{drawerOpen && <motion.button className="drawer-scrim" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}</AnimatePresence>
      <aside className={`sidebar ${drawerOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-top">
          <NavLink to="/" className="wordmark"><span className="brand-mark">m</span>morrow<span className="wordmark-period">.</span></NavLink>
          <span className="sidebar-edition">A companion for AniList</span>
        </div>
        <div className="sidebar-label">YOUR SPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><MessageCircle size={17} /> Conversations</NavLink>
          <NavLink to="/friends" className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><Users size={17} /> Friends</NavLink>
          <NavLink to="/inbox" className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><BookOpen size={17} /> Recommendations {inboxCount > 0 && <span className="nav-count">{inboxCount}</span>}</NavLink>
        </nav>
        <div className="sidebar-section-heading"><span>YOUR PEOPLE</span><button className="icon-button small" onClick={() => navigate('/friends')} aria-label="Add a friend"><span className="plus-icon">+</span></button></div>
        <div className="friend-list">
          {friends.length ? friends.map(({ profile: friend }) => <NavLink key={friend.id} to={`/chat/${friend.id}`} className={({ isActive }) => `friend-link ${isActive ? 'friend-active' : ''}`}>
            <span className="avatar-wrap"><Avatar name={friend.username} src={friend.avatar_url} size="sm" /><span className={`presence-dot ${online.has(friend.id) ? 'is-online' : ''}`} /></span>
            <span className="friend-link-name">{friend.username}</span>{unread[friend.id] > 0 && <span className="unread-pill">{unread[friend.id]}</span>}
          </NavLink>) : <div className="sidebar-empty">Your next good conversation is one friend away.</div>}
        </div>
        <div className="sidebar-bottom">
          <NavLink to="/about" className={({ isActive }) => `nav-link quiet-link ${isActive ? 'nav-active' : ''}`}><CircleHelp size={16} /> How Morrow works</NavLink>
          {profile && <div className="account-row"><Avatar name={profile.username} src={profile.avatar_url} size="sm" /><div className="account-name"><strong>{profile.username}</strong><a href={`https://anilist.co/user/${encodeURIComponent(profile.username)}`} target="_blank" rel="noreferrer">View AniList profile <ChevronRight size={12} /></a></div><button className="icon-button small logout-button" onClick={() => void logout()} aria-label="Log out"><LogOut size={16} /></button></div>}
          {!profile && <div className="account-row account-loading"><span className="skeleton-circle" /> <span>Profile unavailable</span></div>}
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb"><span className="breadcrumb-mark">✳</span><span>{location.pathname.startsWith('/chat/') ? 'A good conversation' : location.pathname === '/friends' ? 'Your people' : location.pathname === '/inbox' ? 'A little something for you' : 'A place to share the good stuff'}</span></div>
          <div className="topbar-right"><span className="connection-indicator"><span /> Works with AniList</span><button className="icon-button mobile-search" onClick={() => navigate('/friends')} aria-label="Find friends"><Search size={17} /></button><button className="icon-button mobile-logout" onClick={() => void logout()} aria-label="Log out"><LogOut size={17} /></button></div>
        </header>
        {socialError && <div className="inline-alert" role="status">{socialError}<button onClick={() => void refreshSocial()}>Retry</button></div>}
        <AnimatePresence mode="wait"><motion.main key={location.pathname} className="page-frame" initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
          <Routes>
            <Route path="/" element={<HomePage profile={profile} friends={friends} online={online} />} />
            <Route path="/friends" element={<FriendsPage userId={userId} relationships={relationships} friends={friends} onChanged={refreshSocial} online={online} />} />
            <Route path="/inbox" element={<InboxPage userId={userId} />} />
            <Route path="/chat/:id" element={<ChatRoute userId={userId} friends={friends} online={online} onChanged={refreshSocial} />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </motion.main></AnimatePresence>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          <NavLink to="/" end aria-label="Conversations"><MessageCircle size={19} /></NavLink>
          <NavLink to="/friends" aria-label="Friends"><Users size={19} /></NavLink>
          <NavLink to="/inbox" aria-label="Recommendations"><BookOpen size={19} />{inboxCount > 0 && <i />}</NavLink>
        </nav>
      </div>
    </div>
  )
}

function ChatRoute({ userId, friends, online, onChanged }: { userId: string; friends: FriendItem[]; online: Set<string>; onChanged: () => Promise<void> }) {
  const { id = '' } = useParams()
  const friend = friends.find((item) => item.profile.id === id)?.profile
  return <ChatPage userId={userId} friendId={id} friend={friend || null} online={online.has(id)} onChanged={onChanged} />
}

function HomePage({ profile, friends, online }: { profile: Profile | null; friends: FriendItem[]; online: Set<string> }) {
  const [stats, setStats] = useState<AniListUser | null>(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  useEffect(() => {
    if (!profile) return
    let alive = true
    void getUser(profile.anilist_id).then((data) => { if (alive) setStats(data) }).catch((reason) => { if (alive) setError(displayError(reason, 'AniList details are unavailable just now.')) })
    return () => { alive = false }
  }, [profile?.anilist_id])
  const hours = stats ? Math.floor(stats.statistics.anime.minutesWatched / 60) : 0
  return <div className="home-layout">
    <section className="welcome-panel">
      {profile?.banner_url && <div className="welcome-banner" style={{ backgroundImage: `linear-gradient(90deg,rgba(28,34,30,.72),rgba(28,34,30,.12)),url(${profile.banner_url})` }} />}
      <div className="welcome-topline"><span className="eyebrow">A NOTE FROM MORROW</span><span className="today-date">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
      <h1>Good stories<br /><em>travel better</em> together.</h1>
      <p>Your watchlist lives on AniList. This is where the “you have to see this” conversations happen.</p>
      <button className="button button-primary" onClick={() => navigate('/friends')}>Find your people <ChevronRight size={16} /></button>
      <div className="welcome-scribble" aria-hidden="true">✳</div>
    </section>
    <div className="home-lower">
      <section className="home-section people-section">
        <div className="section-heading"><div><span className="eyebrow">THE GOOD COMPANY</span><h2>Your people</h2></div><button className="text-button" onClick={() => navigate('/friends')}>See all <ChevronRight size={15} /></button></div>
        {friends.length ? <div className="people-grid">{friends.slice(0, 4).map(({ profile: friend }) => <button className="person-card" key={friend.id} onClick={() => navigate(`/chat/${friend.id}`)}><span className="person-avatar-wrap"><Avatar name={friend.username} src={friend.avatar_url} size="lg" /><i className={`presence-dot ${online.has(friend.id) ? 'is-online' : ''}`} /></span><strong>{friend.username}</strong><small>{online.has(friend.id) ? 'Around right now' : 'Say hello'}</small></button>)}</div> : <div className="empty-panel"><div className="empty-icon"><Users size={19} /></div><div><strong>The table’s set.</strong><p>Add a friend and make this space yours.</p></div><button className="button button-outline" onClick={() => navigate('/friends')}>Find a friend</button></div>}
      </section>
      <section className="profile-card">
        <div className="profile-card-top"><span className="eyebrow">YOUR ANIList SNAPSHOT</span><Sparkles size={17} /></div>
        {profile ? <><div className="profile-id"><Avatar name={profile.username} src={stats?.avatar.large || profile.avatar_url} size="md" /><div><strong>{stats?.name || profile.username}</strong><a href={`https://anilist.co/user/${encodeURIComponent(profile.username)}`} target="_blank" rel="noreferrer">Open AniList profile <ChevronRight size={12} /></a></div></div>
          {stats ? <div className="stats-row"><div><strong>{stats.statistics.anime.count.toLocaleString()}</strong><small>anime entries</small></div><div><strong>{hours.toLocaleString()}h</strong><small>spent in stories</small></div><div><strong>{stats.statistics.anime.meanScore ? `${Math.round(stats.statistics.anime.meanScore)}%` : '—'}</strong><small>mean score</small></div></div> : error ? <p className="soft-error">{error}</p> : <div className="stats-skeleton"><span /><span /><span /></div>}
          <p className="snapshot-note">Only a glimpse. Your lists and progress stay on AniList.</p>
        </> : <div className="profile-unavailable">We couldn’t load your AniList profile. <button className="text-button" onClick={() => window.location.reload()}>Try again</button></div>}
      </section>
    </div>
    <div className="home-footnote"><span>✳</span> A good message can be the start of a very good series.</div>
  </div>
}

function AboutPage() {
  return <section className="simple-page"><span className="eyebrow">A SMALL EXPLANATION</span><h1>Not another<br /><em>watchlist.</em></h1><p className="simple-lede">Morrow is a social layer for the people you already share stories with.</p><div className="about-columns"><article><span>01</span><h3>Your lists stay yours.</h3><p>AniList remains the home for your anime lists, ratings, and progress. Morrow doesn’t duplicate or edit them.</p></article><article><span>02</span><h3>Good things travel.</h3><p>Talk one-to-one, send a friend a recommendation, and let them tell you what they thought.</p></article><article><span>03</span><h3>Details, live from AniList.</h3><p>We keep the AniList media ID needed for a recommendation. Titles and cover art are fetched fresh from AniList.</p></article></div><p className="about-footnote">Morrow works with AniList and is an independent companion. It is not affiliated with or endorsed by AniList.</p></section>
}

function NotFound() { return <section className="not-found"><Compass size={24} /><span className="eyebrow">A WRONG TURN</span><h1>This page wandered off.</h1><NavLink to="/" className="button button-outline">Back to your space</NavLink></section> }

export default function App({ bootstrapIssue }: { bootstrapIssue: AuthIssue }) {
  return <HashRouter><AppHome bootstrapIssue={bootstrapIssue} /></HashRouter>
}
