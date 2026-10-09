import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { animeTitle } from '../lib/format'
import { searchAnime, type Anime } from '../lib/anilist'
import { displayError } from '../lib/supabase'

export default function AnimeSearch({ onSelect, label = 'Search anime on AniList', placeholder = 'Type a title…' }: { onSelect: (anime: Anime) => void; label?: string; placeholder?: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Anime[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setError(''); setLoading(false); return }
    let alive = true
    const timer = window.setTimeout(() => {
      setLoading(true); setError('')
      void searchAnime(query.trim()).then((items) => { if (alive) setResults(items) }).catch((reason) => { if (alive) setError(displayError(reason, 'AniList search is unavailable just now.')) }).finally(() => { if (alive) setLoading(false) })
    }, 350)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [query])
  return <div className="anime-search">
    <label className="search-box"><Search size={16} /><input aria-label={label} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} /><span>AniList</span></label>
    {loading && <p className="loading-line"><span className="spinner" /> Searching AniList…</p>}
    {error && <p className="soft-error" role="alert">{error}</p>}
    {results.length > 0 && <div className="anime-search-results" role="listbox" aria-label="Anime results">{results.map((anime) => <button type="button" className="anime-search-result" role="option" aria-selected="false" key={anime.id} onClick={() => { onSelect(anime); setQuery(''); setResults([]) }}><img src={anime.coverImage.large} alt="" loading="lazy" /><span><strong>{animeTitle(anime.title)}</strong><small>{anime.format?.replaceAll('_', ' ') || 'Anime'}{anime.episodes ? ` · ${anime.episodes} episodes` : ''}</small></span><span className="text-button">Choose</span></button>)}</div>}
    {query.trim().length >= 2 && !loading && !error && !results.length && <p className="empty-search">No anime found. Try another title.</p>}
  </div>
}
