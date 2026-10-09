import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)
export const supabase = isSupabaseConfigured
  ? createClient<any>(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 8 } },
    })
  : null

export type Profile = {
  id: string
  anilist_id: number
  username: string
  avatar_url: string | null
  banner_url: string | null
  created_at: string
  is_admin?: boolean
}

export type Friendship = {
  id: string
  requester: string
  addressee: string
  status: 'pending' | 'accepted' | 'declined'
  created_at: string
}

export type Message = {
  id: string
  sender: string
  recipient: string
  body: string
  created_at: string
  read_at: string | null
}

export type Recommendation = {
  id: string
  sender: string
  recipient: string
  anilist_media_id: number
  note: string | null
  status: 'unseen' | 'on_my_list' | 'seen' | 'not_for_me'
  reason_tags: RecommendationReasonTag[]
  similar_to_media_id: number | null
  created_at: string
  is_admin?: boolean
}

export type RecommendationReasonTag = 'similar_to_something' | 'great_characters' | 'great_story' | 'great_art_music' | 'short_and_sweet' | 'hidden_gem' | 'comfort_watch' | 'mind_bending'
export type AnimeRef = { mediaId: number; episode: number | null }

export type SharedQueue = { id: string; owner_id: string; name: string; visibility: 'private' | 'friends'; created_at: string }
export type QueueItem = { id: string; queue_id: string; media_id: number; added_by: string; priority: 1 | 2 | 3; recommended_by: string | null; status: 'up_next' | 'done'; created_at: string }
export type AnimeThread = { id: string; media_id: number; episode: number | null; title: string; created_by: string; created_at: string }
export type ThreadPost = { id: string; thread_id: string; author: string; body: string; episode_tag: number | null; created_at: string }
export type Community = { id: string; slug: string; name: string; description: string; visibility: 'public' | 'unlisted'; created_by: string; created_at: string }
export type CommunityMember = { community_id: string; member_id: string; role: 'owner' | 'mod' | 'member'; joined_at: string }
export type CommunityChannel = { id: string; community_id: string; name: string; kind: 'chat' | 'threads'; position: number; media_id: number | null; episode: number | null; created_at: string }
export type CommunityMessage = { id: string; channel_id: string; author: string; body: string; media_id: number | null; episode: number | null; created_at: string }
export type CommunityEmoji = { id: string; community_id: string; name: string; path: string; uploaded_by: string; created_at: string; url?: string }
export type CommunityPerson = { id: string; username: string; avatar_url: string | null; role: 'owner' | 'mod' | 'member' }
export type CommunityReport = { id: string; reporter: string; community_id: string | null; target_type: 'message' | 'emoji' | 'community'; target_id: string; reason: string; status: 'open' | 'closed'; created_at: string; closed_at: string | null }
export type ModAction = { id: string; community_id: string | null; actor: string | null; action: string; target_type: string; target_id: string | null; target_user: string | null; reason: string; expires_at: string | null; created_at: string }
export type CommunitySanction = { id: string; username: string; restriction: 'ban' | 'mute'; reason: string; expires_at: string | null }
export type WatchAdapter = 'youtube' | 'vimeo' | 'twitch' | 'dailymotion' | 'direct' | 'hls' | 'external'
export type WatchRoom = { id: string; host_id: string; media_id: number; episode: number; adapter: WatchAdapter; source_ref: string | null; state: 'paused' | 'playing'; position_seconds: number; state_updated_at: string; access: 'invite' | 'friends' | 'community'; community_id: string | null; invite_code?: string | null; created_at: string }
export type WatchRoomMember = { room_id: string; user_id: string; joined_at: string }
export type RoomMessage = { id: string; room_id: string; author: string; body: string; created_at: string }

export const RECOMMENDATION_REASONS: Array<{ value: RecommendationReasonTag; label: string }> = [
  { value: 'similar_to_something', label: 'Like something you love' },
  { value: 'great_characters', label: 'Great characters' },
  { value: 'great_story', label: 'A great story' },
  { value: 'great_art_music', label: 'Art & music' },
  { value: 'short_and_sweet', label: 'Short and sweet' },
  { value: 'hidden_gem', label: 'Hidden gem' },
  { value: 'comfort_watch', label: 'Comfort watch' },
  { value: 'mind_bending', label: 'Mind bending' },
]

export function displayError(error: unknown, fallback = 'That didn’t work. Please try again.') {
  const message = error instanceof Error ? error.message : ''
  if (/network|fetch/i.test(message)) return 'We couldn’t reach the server. Check your connection and try again.'
  if (/rate limit|too many requests/i.test(message)) return 'A moment, please — we’re giving AniList a breather.'
  if (/JWT|token|session/i.test(message)) return 'Your session needs a refresh. Please sign in again.'
  return message || fallback
}
