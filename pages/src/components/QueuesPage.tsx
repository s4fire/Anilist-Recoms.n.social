import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowUpRight, Check, ListPlus } from 'lucide-react'
import AnimeCard from './AnimeCard'
import AnimeSearch from './AnimeSearch'
import AniListListAction from './AniListListAction'
import { displayError, supabase, type Friendship, type Profile, type QueueItem, type SharedQueue } from '../lib/supabase'
import type { Anime } from '../lib/anilist'

export default function QueuesPage({ userId }: { userId: string }) {
  const [queues, setQueues] = useState<SharedQueue[]>([])
  const [items, setItems] = useState<QueueItem[]>([])
  const [people, setPeople] = useState<Map<string, Profile>>(new Map())
  const [friends, setFriends] = useState<Profile[]>([])
  const [selectedQueue, setSelectedQueue] = useState('')
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'friends'>('friends')
  const [invites, setInvites] = useState<string[]>([])
  const [selectedAnime, setSelectedAnime] = useState<Anime | null>(null)
  const [priority, setPriority] = useState<1 | 2 | 3>(2)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError('')
    const { data: rows, error: loadError } = await supabase.from('queues').select('*').order('created_at', { ascending: false })
    if (loadError) { setError(displayError(loadError, 'Your shared queues couldn’t be loaded.')); setLoading(false); return }
    const loaded = (rows || []) as SharedQueue[]
    setQueues(loaded)
    const nextQueue = loaded.some((queue) => queue.id === selectedQueue) ? selectedQueue : loaded[0]?.id || ''
    setSelectedQueue(nextQueue)
    if (!nextQueue) { setItems([]); setLoading(false); return }
    const { data: itemRows, error: itemError } = await supabase.from('queue_items').select('*').eq('queue_id', nextQueue).order('status').order('priority').order('created_at')
    if (itemError) { setError(displayError(itemError, 'This queue couldn’t be opened.')); setLoading(false); return }
    const queueItems = (itemRows || []) as QueueItem[]
    setItems(queueItems)
    const peopleIds = [...new Set([userId, ...loaded.map((queue) => queue.owner_id), ...queueItems.flatMap((item) => [item.added_by, ...(item.recommended_by ? [item.recommended_by] : [])])])]
    const { data: profiles } = await supabase.from('profiles').select('id,anilist_id,username,avatar_url,banner_url,created_at').in('id', peopleIds)
    setPeople(new Map(((profiles || []) as Profile[]).map((profile) => [profile.id, profile])))
    setLoading(false)
  }, [selectedQueue, userId])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let alive = true
    void client.from('friendships').select('*').eq('status', 'accepted').or(`requester.eq.${userId},addressee.eq.${userId}`).then(async ({ data }) => {
      if (!alive) return
      const ids = ((data || []) as Friendship[]).map((row) => row.requester === userId ? row.addressee : row.requester)
      const result = ids.length ? await client.from('profiles').select('id,anilist_id,username,avatar_url,banner_url,created_at').in('id', ids) : { data: [] }
      if (alive) setFriends((result.data || []) as Profile[])
    })
    return () => { alive = false }
  }, [userId])
  useEffect(() => {
    if (!supabase || !selectedQueue) return
    const channel = supabase.channel(`arns:queue:${selectedQueue}`).on('postgres_changes', { event: '*', schema: 'public', table: 'queue_items', filter: `queue_id=eq.${selectedQueue}` }, () => { void refresh() }).subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [selectedQueue, refresh])

  async function createQueue(event: FormEvent) {
    event.preventDefault(); if (!supabase || busy || !name.trim()) return
    setBusy(true); setError('')
    const { data, error: createError } = await supabase.from('queues').insert({ owner_id: userId, name: name.trim(), visibility }).select('*').single()
    if (createError || !data) { setError(displayError(createError, 'Your queue couldn’t be created.')); setBusy(false); return }
    if (visibility === 'private' && invites.length) {
      const { error: inviteError } = await supabase.from('queue_members').insert(invites.map((member_id) => ({ queue_id: data.id, member_id, added_by: userId })))
      if (inviteError) setError(displayError(inviteError, 'The queue was made, but one or more invitations couldn’t be added.'))
    }
    setName(''); setInvites([]); setQueues((current) => [data as SharedQueue, ...current]); setItems([]); setSelectedQueue(data.id); setLoading(false); setBusy(false)
  }
  async function addItem() {
    if (!supabase || !selectedAnime || busy || !selectedQueue) return
    setBusy(true); setError('')
    const { data, error: addError } = await supabase.from('queue_items').insert({ queue_id: selectedQueue, media_id: selectedAnime.id, added_by: userId, priority, status: 'up_next' }).select('*').single()
    if (addError) setError(displayError(addError, 'That anime couldn’t be added.'))
    else if (data) { setItems((current) => [...current, data as QueueItem]); setSelectedAnime(null) }
    setBusy(false)
  }
  async function updateItem(item: QueueItem, changes: Partial<Pick<QueueItem, 'priority' | 'status'>>) {
    if (!supabase) return
    const { error: updateError } = await supabase.from('queue_items').update(changes).eq('id', item.id)
    if (updateError) setError(displayError(updateError, 'That queue change couldn’t be saved.'))
    else setItems((current) => current.map((row) => row.id === item.id ? { ...row, ...changes } : row).sort((a, b) => a.status.localeCompare(b.status) || a.priority - b.priority || a.created_at.localeCompare(b.created_at)))
  }
  const activeQueue = queues.find((queue) => queue.id === selectedQueue)
  return <section className="queues-page">
    <div className="page-heading"><div><span className="eyebrow">A SHARED SHORTLIST</span><h1>Watch Next<span className="heading-period">.</span></h1><p>Pick something together. Your personal lists stay on AniList.</p></div><span className="heading-stamp"><ListPlus size={17} />Shared queues</span></div>
    {error && <div className="error-message" role="alert">{error} <button className="text-button" onClick={() => void refresh()}>Try again</button></div>}
    <div className="queues-layout"><aside className="queue-rail"><h2>Your queues</h2>{loading ? <p className="soft-copy">Loading queues…</p> : queues.length ? queues.map((queue) => <button className={`queue-choice ${queue.id === selectedQueue ? 'queue-choice-active' : ''}`} key={queue.id} onClick={() => setSelectedQueue(queue.id)}><strong>{queue.name}</strong><small>{queue.visibility === 'friends' ? 'Friends can join in' : 'Private · invited friends only'}</small></button>) : <p className="soft-copy">No shared queues yet. Start a small one.</p>}
      <form className="queue-create" onSubmit={(event) => void createQueue(event)}><label>New queue<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Friday night picks" /></label><label>Who can see it<select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="friends">My friends</option><option value="private">Only invited friends</option></select></label>{visibility === 'private' && <fieldset className="queue-invites"><legend>Invite friends</legend>{friends.map((friend) => <label key={friend.id}><input type="checkbox" checked={invites.includes(friend.id)} onChange={(event) => setInvites((current) => event.target.checked ? [...current, friend.id] : current.filter((id) => id !== friend.id))} />{friend.username}</label>)}{!friends.length && <small>Add a friend first to invite them.</small>}</fieldset>}<button className="button button-primary button-small" disabled={!name.trim() || busy}>{busy ? 'Making queue…' : 'Create queue'}</button></form>
    </aside>
    <div className="queue-content">{!activeQueue ? <div className="empty-state large-empty"><div className="empty-icon"><ListPlus size={20} /></div><h2>Start with one shared list.</h2><p>Make a queue for a friend, a group, or your next watch night.</p></div> : <><div className="queue-content-heading"><div><span className="eyebrow">{activeQueue.visibility === 'friends' ? 'FRIENDS QUEUE' : 'PRIVATE QUEUE'}</span><h2>{activeQueue.name}</h2><p>Added by {people.get(activeQueue.owner_id)?.username || 'a friend'}</p></div></div><div className="queue-add-row">{selectedAnime ? <div className="queue-selected-anime"><AnimeCard mediaId={selectedAnime.id} /><label>Priority<select value={priority} onChange={(event) => setPriority(Number(event.target.value) as 1 | 2 | 3)}><option value={1}>1 · Soon</option><option value={2}>2 · Next few</option><option value={3}>3 · Whenever</option></select></label><button className="button button-primary button-small" disabled={busy} onClick={() => void addItem()}><ListPlus size={14} /> Add to queue</button><button className="text-button" onClick={() => setSelectedAnime(null)}>Cancel</button></div> : <AnimeSearch label="Add an anime to this queue" placeholder="Find an anime to add…" onSelect={setSelectedAnime} />}</div>
      {loading ? <div className="empty-panel"><span className="spinner" /> Loading this queue…</div> : items.length ? <div className="queue-items">{items.map((item) => <article className={`queue-item ${item.status === 'done' ? 'queue-item-done' : ''}`} key={item.id}><AnimeCard mediaId={item.media_id} /><div className="queue-item-meta"><span>Added by <strong>{people.get(item.added_by)?.username || 'a friend'}</strong>{item.recommended_by && <> · recommended by <strong>{people.get(item.recommended_by)?.username || 'a friend'}</strong></>}</span><label>Priority<select aria-label={`Priority for item ${item.media_id}`} value={item.priority} onChange={(event) => void updateItem(item, { priority: Number(event.target.value) as 1 | 2 | 3 })}><option value={1}>1 · Soon</option><option value={2}>2 · Next few</option><option value={3}>3 · Whenever</option></select></label><a href={`https://anilist.co/anime/${item.media_id}`} target="_blank" rel="noreferrer">AniList <ArrowUpRight size={12} /></a><AniListListAction mediaId={item.media_id} allowRepeat />{item.status === 'up_next' ? <button className="button button-outline button-small" onClick={() => void updateItem(item, { status: 'done' })}><Check size={13} /> Mark done</button> : <button className="text-button" onClick={() => void updateItem(item, { status: 'up_next' })}>Move back to queue</button>}</div></article>)}</div> : <div className="empty-panel"><div className="empty-icon"><ListPlus size={18} /></div><div><strong>A little room for a good pick.</strong><p>Add the first anime to this shared queue.</p></div></div>}
    </>}</div></div>
  </section>
}
