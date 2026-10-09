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
    <header className="community-banner"><div><span className="eyebrow">/{community.slug} · {community.visibility === 'public' ? 'PUBLIC COMMUNI…46590 tokens truncated…eturns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.sender is distinct from old.sender
    or new.recipient is distinct from old.recipient or new.body is distinct from old.body
    or new.created_at is distinct from old.created_at then
    raise exception 'Messages are immutable except for recipient read state.' using errcode = '42501';
  end if;
  if auth.uid() is null or auth.uid() <> old.recipient then
    raise exception 'Only the recipient may mark this message read.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger messages_guard_update before update on public.messages
  for each row execute function public.guard_message_update();

create or replace function public.guard_recommendation_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.sender is distinct from old.sender
    or new.recipient is distinct from old.recipient or new.anilist_media_id is distinct from old.anilist_media_id
    or new.note is distinct from old.note or new.created_at is distinct from old.created_at then
    raise exception 'Recommendations are immutable except for recipient status.' using errcode = '42501';
  end if;
  if auth.uid() is null or auth.uid() <> old.recipient then
    raise exception 'Only the recipient may reply to this recommendation.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger recommendations_guard_update before update on public.recommendations
  for each row execute function public.guard_recommendation_update();

-- Profile lookup is available to signed-in users for username search and friend displays.
create policy profiles_select_related on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.friendships f
      where (f.requester = auth.uid() and f.addressee = public.profiles.id)
         or (f.addressee = auth.uid() and f.requester = public.profiles.id)
    )
  );
create policy profiles_update_owner on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy friendships_select_participants on public.friendships for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());
create policy friendships_insert_requester on public.friendships for insert to authenticated
  with check (requester = auth.uid() and addressee <> auth.uid() and status = 'pending');
create policy friendships_update_answer_or_reopen on public.friendships for update to authenticated
  using ((addressee = auth.uid() and status in ('pending', 'declined')) or (requester = auth.uid() and status = 'declined'))
  with check ((addressee = auth.uid() and status in ('accepted', 'declined')) or (requester = auth.uid() and status = 'pending'));

create policy messages_select_participants on public.messages for select to authenticated
  using (sender = auth.uid() or recipient = auth.uid());
create policy messages_insert_between_friends on public.messages for insert to authenticated
  with check (
    sender = auth.uid()
    and recipient <> auth.uid()
    and read_at is null
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = sender and f.addressee = recipient) or (f.requester = recipient and f.addressee = sender))
    )
  );
create policy messages_update_recipient_read_state on public.messages for update to authenticated
  using (recipient = auth.uid()) with check (recipient = auth.uid());

create policy recommendations_select_participants on public.recommendations for select to authenticated
  using (sender = auth.uid() or recipient = auth.uid());
create policy recommendations_insert_between_friends on public.recommendations for insert to authenticated
  with check (
    sender = auth.uid()
    and recipient <> auth.uid()
    and status = 'unseen'
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = sender and f.addressee = recipient) or (f.requester = recipient and f.addressee = sender))
    )
  );
create policy recommendations_update_recipient_status on public.recommendations for update to authenticated
  using (recipient = auth.uid()) with check (recipient = auth.uid());

-- The service function is not exposed to browser roles. Keep rate_limits private even to authenticated users.
revoke all on public.rate_limits from anon, authenticated;
revoke all on function public.consume_auth_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text, integer, integer) to service_role;

create or replace view public.profile_directory
with (security_barrier = true)
as
select id, username, avatar_url
from public.profiles;

revoke all on public.profiles, public.friendships, public.messages, public.recommendations from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.friendships, public.messages, public.recommendations to authenticated;
grant usage on schema public to authenticated;

-- Supabase Realtime is used for online presence and these three row-change streams.
alter table public.friendships replica identity full;
alter table public.messages replica identity full;
alter table public.recommendations replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships') then
    execute 'alter publication supabase_realtime add table public.friendships';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recommendations') then
    execute 'alter publication supabase_realtime add table public.recommendations';
  end if;
end;
$$;
