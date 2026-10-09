const ENDPOINT = 'https://graphql.anilist.co'
const cache = new Map<string, { expires: number; value: unknown }>()
let nextRequestAt = 0
let queue: Promise<void> = Promise.resolve()

export class AniListError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'AniListError'
  }
}

async function rateSlot() {
  const previous = queue
  let release!: () => void
  queue = new Promise<void>((resolve) => { release = resolve })
  await previous
  const wait = Math.max(0, nextRequestAt - Date.now())
  if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait))
  nextRequestAt = Date.now() + 2100
  release()
}

export async function anilist<T>(query: string, variables: Record<string, unknown> = {}, ttlMs = 45_000): Promise<T> {
  const key = JSON.stringify([query, variables])
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value as T
  let response: Response | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await rateSlot()
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
      })
    } catch {
      throw new AniListError('AniList is taking a moment to respond. Please try again.')
    }
    if (response.status !== 429) break
    const retryAfter = Number(response.headers.get('Retry-After') || '3')
    const waitSeconds = Math.min(Math.max(Number.isFinite(retryAfter) ? retryAfter : 3, 1), 30)
    nextRequestAt = Math.max(nextRequestAt, Date.now() + waitSeconds * 1000)
    if (attempt === 1) throw new AniListError('AniList is busy just now. Please try again in a few seconds.', 429)
    await new Promise((resolve) => window.setTimeout(resolve, waitSeconds * 1000))
  }
  if (!response) throw new AniListError('AniList is taking a moment to respond. Please try again.')
  if (!response.ok) throw new AniListError(response.status >= 500 ? 'AniList is having a short pause. Try again soon.' : 'AniList couldn’t find that right now.', response.status)
  const payload = await response.json() as { data?: T; errors?: Array<{ message?: string }> }
  if (!payload.data) throw new AniListError(payload.errors?.[0]?.message || 'AniList returned an incomplete response.')
  cache.set(key, { expires: Date.now() + ttlMs, value: payload.data })
  if (cache.size > 180) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) cache.delete(oldestKey)
  }
  return payload.data
}

export type Anime = {
  id: number
  title: { userPreferred: string; english: string | null; romaji: string }
  coverImage: { large: string; color: string | null }
  averageScore: number | null
  genres: string[]
  siteUrl: string
  format: string | null
  episodes: number | null
}

export const MEDIA_FIELDS = `id title { userPreferred english romaji } coverImage { large color } averageScore genres siteUrl format episodes`

export async function searchAnime(search: string) {
  const query = `query ($search: String!) { Page(perPage: 8) { media(search: $search, type: ANIME, isAdult: false, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} } } }`
  return (await anilist<{ Page: { media: Anime[] } }>(query, { search }, 30_000)).Page.media
}

export async function getAnime(id: number) {
  const query = `query ($id: Int!) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`
  return (await anilist<{ Media: Anime | null }>(query, { id }, 120_000)).Media
}

export type AniListUser = {
  id: number
  name: string
  avatar: { large: string }
  bannerImage: string | null
  statistics: { anime: { count: number; meanScore: number; minutesWatched: number } }
}

export async function getUser(id: number) {
  const query = `query ($id: Int!) { User(id: $id) { id name avatar { large } bannerImage statistics { anime { count meanScore minutesWatched } } } }`
  return (await anilist<{ User: AniListUser | null }>(query, { id }, 120_000)).User
}

export type AnimeExternalLink = { id: number; url: string; site: string }
export async function getAnimeExternalLinks(id: number) {
  const query = `query ($id: Int!) { Media(id: $id, type: ANIME) { externalLinks { id url site } } }`
  const result = await anilist<{ Media: { externalLinks: AnimeExternalLink[] } | null }>(query, { id }, 120_000)
  return (result.Media?.externalLinks || []).filter((link) => {
    try { return new URL(link.url).protocol === 'https:' } catch { return false }
  })
}

export type PublicListEntry = { mediaId: number; score: number; progress: number; status: string }

export async function getPublicAnimeList(userId: number, onPage?: (page: number) => void) {
  const entries: PublicListEntry[] = []
  const query = `query ($userId: Int!, $chunk: Int!) { MediaListCollection(userId: $userId, type: ANIME, chunk: $chunk, perChunk: 500) { hasNextChunk lists { entries { mediaId score progress status } } } }`
  let chunk = 1
  let hasNext = true
  while (hasNext) {
    const result = await anilist<{ MediaListCollection: { hasNextChunk: boolean; lists: Array<{ entries: PublicListEntry[] }> } | null }>(query, { userId, chunk }, 60_000)
    if (!result.MediaListCollection) throw new AniListError('This AniList list is private or unavailable.')
    for (const list of result.MediaListCollection.lists) entries.push(...list.entries)
    hasNext = result.MediaListCollection.hasNextChunk
    onPage?.(chunk)
    chunk += 1
    if (chunk > 11) throw new AniListError('This AniList list is too large to compare right now.')
  }
  return entries.map(({ mediaId, score, progress, status }) => ({ mediaId, score, progress, status }))
}

export async function getAnimeProgress(userId: number, mediaId: number): Promise<number | null> {
  const query = `query ($userId: Int!, $mediaId: Int!) { MediaList(userId: $userId, mediaId: $mediaId, type: ANIME) { progress status } }`
  const result = await anilist<{ MediaList: { progress: number; status: string } | null }>(query, { userId, mediaId }, 20_000)
  return result.MediaList?.progress ?? null
}
