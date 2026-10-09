import { describe, expect, it } from 'vitest'
import { compareTaste, shouldBlurSpoiler, type ListEntry } from './taste'

describe('compareTaste', () => {
  it('finds overlap, score agreement, shared favorites, and recommendations without saving lists', () => {
    const first: ListEntry[] = [
      { mediaId: 1, score: 90 },
      { mediaId: 2, score: 85 },
      { mediaId: 3, score: 0 },
    ]
    const second: ListEntry[] = [
      { mediaId: 1, score: 80 },
      { mediaId: 4, score: 95 },
    ]

    expect(compareTaste(first, second)).toEqual({
      sharedMediaIds: [1],
      overlapPercent: 25,
      scoreAgreementPercent: 90,
      sharedFavorites: [1],
      recommendationsForFirst: [4],
      recommendationsForSecond: [2],
    })
  })

  it('returns zero overlap and no recommendations for two empty lists', () => {
    expect(compareTaste([], [])).toEqual({
      sharedMediaIds: [],
      overlapPercent: 0,
      scoreAgreementPercent: null,
      sharedFavorites: [],
      recommendationsForFirst: [],
      recommendationsForSecond: [],
    })
  })
})

describe('shouldBlurSpoiler', () => {
  it('blurs future or unknown progress, but leaves reached episodes visible', () => {
    expect(shouldBlurSpoiler(5, 4)).toBe(true)
    expect(shouldBlurSpoiler(5, null)).toBe(true)
    expect(shouldBlurSpoiler(4, 4)).toBe(false)
    expect(shouldBlurSpoiler(null, 0)).toBe(false)
  })
})
