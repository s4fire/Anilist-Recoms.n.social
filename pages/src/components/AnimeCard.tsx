import { useEffect, useState } from 'react'
import { ArrowUpRight, BookOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { animeTitle } from '../lib/format'
import { getAnime, type Anime } from '../lib/anilist'

export default function AnimeCard({ mediaId, episode, label }: { mediaId: number; episode?: number | null; label?: string }) {
  const [anime, setAnime] = useState<Anime | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let alive = true
    setAnime(null)
    setError(false)
    void getAnime(mediaId).then((value) => { if (alive) setAnime(value) }).catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [mediaId])
  if (!anime) return <div className="anime-card anime-card-loading" aria-live="polite"><BookOpen size={18} /><span>{error ? 'AniList details are taking a pause.' : 'Finding the AniList details…'}</span></div>
  return <article className="anime-card">
    <a className="anime-card-cover" href={anime.siteUrl} target="_blank" rel="noreferrer"><img src={anime.coverImage.large} alt={`Cover art for ${animeTitle(anime.title)}`} loading="lazy" /></a>
    <div className="anime-card-copy"><span className="eyebrow">{label || 'FROM ANILIST'}</span><a href={anime.siteUrl} target="_blank" rel="noreferrer"><strong>{animeTitle(anime.title)}</strong><ArrowUpRight size={13} aria-hidden="true" /></a><small>{anime.format?.replaceAll('_', ' ') || 'Anime'}{anime.episodes ? ` · ${anime.episodes} episodes` : ''}{episode ? ` · Episode ${episode}` : ''}</small><Link to={`/anime/${mediaId}/threads`}>Open anime threads</Link></div>
  </article>
}
