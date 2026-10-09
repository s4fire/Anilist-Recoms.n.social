import { useCallback, useEffect, useState } from 'react'
import { Heart, RefreshCw, Sparkles, Users } from 'lucide-react'
import { useParams } from 'react-router-dom'
import AnimeCard from './AnimeCard'
import { getPublicAnimeList } from '../lib/anilist'
import { compareTaste, type TasteComparison } from '../lib/taste'
import { displayError, supabase, type Profile } from '../lib/supabase'

export default function TasteComparePage({ userAnilistId }: { userAnilistId: number }) {
  const { friendId = '' } = useParams()
  const [friend, setFriend] = useState<Profile | null>(null)
  const [comparison, setComparison] = useState<TasteComparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [yourPage, setYourPage] = useState(0)
  const [friendPage, setFriendPage] = useState(0)
  const [error, setError] = useState('')
  const run = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError(''); setComparison(null); setYourPage(0); setFriendPage(0)
    const { data, error: profileError } = await supabase.from('profiles').select('id,anilist_id,username,avatar_url,banner_url,created_at').eq('id', friendId).maybeSingle()
    if (profileError || !data) { setError(displayError(profileError, 'We couldn’t find that friend.')); setLoading(false); return }
    const other = data as Profile
    setFriend(other)
    try {
      const [yourList, theirList] = await Promise.all([
        getPublicAnimeList(userAnilistId, setYourPage),
        getPublicAnimeList(other.anilist_id, setFriendPage),
      ])
      setComparison(compareTaste(yourList, theirList))
    } catch {
      setError('We couldn’t compare these lists. One may be private, unavailable, or taking a breather. Your lists stay on AniList.')
    }
    setLoading(false)
  }, [friendId, userAnilistId])
  useEffect(() => { void run() }, [run])
  return <section className="taste-compare-page">
    <div className="page-heading"><div><span className="eyebrow">TWO LISTS, SIDE BY SIDE</span><h1>Taste check<span className="heading-period">.</span></h1><p>{friend ? `A little look at the overlap between you and ${friend.username}.` : 'Comparing public AniList lists.'}</p></div><span className="heading-stamp"><Sparkles size={17} />Private by design</span></div>
    <div className="privacy-note">This comparison runs in your browser. ARNS doesn’t save anyone’s list, scores, or progress.</div>
    {loading && <div className="taste-loading"><span className="spinner" /><strong>Reading public AniList lists…</strong><span>You: {yourPage ? `page ${yourPage}` : 'starting'} · {friend?.username || 'Friend'}: {friendPage ? `page ${friendPage}` : 'starting'}</span><small>AniList asks us to pace requests, so a big list can take a moment.</small></div>}
    {error && <div className="error-message" role="alert">{error} <button className="text-button" onClick={() => void run()}><RefreshCw size={13} /> Try again</button></div>}
    {comparison && friend && <>
      <div className="taste-stats"><article><span>OVERLAP</span><strong>{comparison.overlapPercent}%</strong><small>of unique anime on either list</small></article><article><span>SHARED ANIME</span><strong>{comparison.sharedMediaIds.length}</strong><small>both lists have these entries</small></article><article><span>SCORE AGREEMENT</span><strong>{comparison.scoreAgreementPercent === null ? '—' : `${comparison.scoreAgreementPercent}%`}</strong><small>closer is more alike</small></article></div>
      <section className="taste-section"><div className="section-heading"><div><span className="eyebrow">THE SAME GOOD STORIES</span><h2><Heart size={18} /> Shared favorites</h2></div></div>{comparison.sharedFavorites.length ? <div className="taste-anime-grid">{comparison.sharedFavorites.slice(0, 8).map((id) => <AnimeCard mediaId={id} key={id} />)}</div> : <div className="empty-panel">No high-scored overlap yet. There may be hidden favorites to discover.</div>}</section>
      <div className="taste-recommendation-columns"><section className="taste-section"><div className="section-heading"><div><span className="eyebrow">FROM {friend.username.toUpperCase()} TO YOU</span><h2><Users size={17} /> Worth a look</h2></div></div>{comparison.recommendationsForFirst.length ? <div className="taste-anime-list">{comparison.recommendationsForFirst.slice(0, 8).map((id) => <AnimeCard mediaId={id} key={id} />)}</div> : <p className="soft-copy">Nothing new at the moment—your lists overlap here.</p>}</section><section className="taste-section"><div className="section-heading"><div><span className="eyebrow">FROM YOU TO {friend.username.toUpperCase()}</span><h2><Users size={17} /> Pass it along</h2></div></div>{comparison.recommendationsForSecond.length ? <div className="taste-anime-list">{comparison.recommendationsForSecond.slice(0, 8).map((id) => <AnimeCard mediaId={id} key={id} />)}</div> : <p className="soft-copy">No high-rated surprises from your list just yet.</p>}</section></div>
      <p className="taste-footnote">“High-rated” means an AniList score of 80 or higher. Scores are compared only when both people rated the same anime.</p>
    </>}
  </section>
}
