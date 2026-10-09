import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Compass, Plus, Search, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { displayError, supabase, type Community } from '../lib/supabase'

export default function CommunitiesPage({ userId }: { userId: string }) {
  const [communities, setCommunities] = useState<Community[]>([])
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('public')
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async (search: string) => {
    if (!supabase) { setLoading(false); setError('ARNS is still connecting to its community space.'); return }
    setLoading(true); setError('')
    let request = supabase.from('communities').select('*').eq('visibility', 'public').order('name').limit(60)
    const term = search.trim().replace(/[%,()]/g, '')
    if (term) request = request.or(`name.ilike.%${term}%,description.ilike.%${term}%,slug.ilike.%${term}%`)
    const { data, error: loadError } = await request
    if (loadError) setError(displayError(loadError, 'Communities couldn’t load just now.'))
    else setCommunities((data || []) as Community[])
    setLoading(false)
  }, [])
  useEffect(() => { void load('') }, [load])
  useEffect(() => { const timer = window.setTimeout(() => { void load(query) }, 250); return () => window.clearTimeout(timer) }, [query, load])

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!supabase || creating) return
    setCreating(true); setError(''); setNotice('')
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    const { data, error: createError } = await supabase.from('communities').insert({ name: name.trim(), slug: cleanSlug, description: description.trim(), visibility, created_by: userId }).select('*').single()
    if (createError || !data) setError(displayError(createError, 'That community couldn’t be created. Try a different name or short link.'))
    else { setNotice('Your community is ready, with a general chat and recommendation channel.'); setShowCreate(false); setName(''); setSlug(''); setDescription(''); await load('') }
    setCreating(false)
  }

  return <section className="communities-page">
    <div className="page-heading"><div><span className="eyebrow">FIND YOUR CORNER</span><h1>Communities<span className="heading-period">.</span></h1><p>Good stories bring people together. Find a group that feels like yours.</p></div><span className="heading-stamp"><Users size={17} />The shared space</span></div>
    <div className="community-tools"><label className="community-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or topic" aria-label="Search communities" /></label><button className="button button-primary" onClick={() => setShowCreate(!showCreate)}><Plus size={15} /> Start a community</button></div>
    {showCreate && <form className="community-create-panel" onSubmit={(event) => void create(event)}><div className="section-heading"><div><span className="eyebrow">START SOMETHING GOOD</span><h2>Make a community</h2></div></div>
      <label className="form-field">Name<input value={name} maxLength={64} required onChange={(event) => { setName(event.target.value); if (!slug) setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) }} placeholder="Late-night mystery club" /></label>
      <label className="form-field">Short link<input value={slug} maxLength={40} required pattern="[a-zA-Z0-9][a-zA-Z0-9-]{1,39}" onChange={(event) => setSlug(event.target.value)} placeholder="mystery-club" /><small>2–40 letters, numbers, or hyphens.</small></label>
      <label className="form-field">A little about it<textarea value={description} maxLength={500} rows={3} onChange={(event) => setDescription(event.target.value)} placeholder="What do people talk about here?" /></label>
      <label className="form-field">Discovery<select value={visibility} onChange={(event) => setVisibility(event.target.value as 'public' | 'unlisted')}><option value="public">Public — appears in search</option><option value="unlisted">Unlisted — share the link</option></select></label>
      <div className="community-create-actions"><button className="button button-primary" disabled={creating}>{creating ? 'Setting it up…' : 'Create community'}</button><button type="button" className="button button-outline" onClick={() => setShowCreate(false)}>Cancel</button></div>
    </form>}
    {notice && <p className="inline-success" role="status">{notice}</p>}{error && <p className="inline-alert" role="alert">{error}</p>}
    {loading ? <div className="empty-panel"><span className="spinner" />Looking for your people…</div> : communities.length ? <div className="community-grid">{communities.map((community) => <article className="community-card" key={community.id}><span className="community-card-icon"><Compass size={20} /></span><span className="eyebrow">/{community.slug}</span><h2>{community.name}</h2><p>{community.description || 'A new place to talk about the shows you love.'}</p><Link className="button button-outline" to={`/communities/${community.id}`}>Visit community</Link></article>)}</div> : <div className="empty-panel"><div className="empty-icon"><Users size={18} /></div><div><strong>{query ? 'No communities found yet.' : 'You could start the first one.'}</strong><p>{query ? 'Try a shorter search, or start a community around your favorite anime.' : 'Pick a show, invite a few friends, and see what grows.'}</p></div>{!showCreate && <button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={14} />Start a community</button>}</div>}
  </section>
}
