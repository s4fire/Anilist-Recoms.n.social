export type ListEntry = { mediaId: number; score: number }

export type TasteComparison = {
  sharedMediaIds: number[]
  overlapPercent: number
  scoreAgreementPercent: number | null
  sharedFavorites: number[]
  recommendationsForFirst: number[]
  recommendationsForSecond: number[]
}

const FAVORITE_SCORE = 80

function uniqueEntries(entries: ListEntry[]) {
  return new Map(entries.filter((entry) => Number.isSafeInteger(entry.mediaId) && entry.mediaId > 0).map((entry) => [entry.mediaId, entry]))
}

export function compareTaste(firstEntries: ListEntry[], secondEntries: ListEntry[]): TasteComparison {
  const first = uniqueEntries(firstEntries)
  const second = uniqueEntries(secondEntries)
  const sharedMediaIds = [...first.keys()].filter((id) => second.has(id)).sort((a, b) => a - b)
  const unionSize = new Set([...first.keys(), ...second.keys()]).size
  const comparableScores = sharedMediaIds.flatMap((id) => {
    const a = first.get(id)?.score || 0
    const b = second.get(id)?.score || 0
    return a > 0 && b > 0 ? [Math.abs(a - b)] : []
  })
  return {
    sharedMediaIds,
    overlapPercent: unionSize ? Math.round((sharedMediaIds.length / unionSize) * 100) : 0,
    scoreAgreementPercent: comparableScores.length
      ? Math.round(100 - comparableScores.reduce((sum, difference) => sum + difference, 0) / comparableScores.length)
      : null,
    sharedFavorites: sharedMediaIds.filter((id) => (first.get(id)?.score || 0) >= FAVORITE_SCORE && (second.get(id)?.score || 0) >= FAVORITE_SCORE),
    recommendationsForFirst: [...second.values()].filter((entry) => entry.score >= FAVORITE_SCORE && !first.has(entry.mediaId)).map((entry) => entry.mediaId).sort((a, b) => a - b),
    recommendationsForSecond: [...first.values()].filter((entry) => entry.score >= FAVORITE_SCORE && !second.has(entry.mediaId)).map((entry) => entry.mediaId).sort((a, b) => a - b),
  }
}

export function shouldBlurSpoiler(episodeTag: number | null, progress: number | null) {
  return episodeTag !== null && (progress === null || episodeTag > progress)
}
