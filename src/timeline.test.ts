import { describe, expect, it } from 'vitest'
import { clipStarts, formatTime, locate, moveItem, splitAt, textsAt, totalDuration, trimClip, type Clip } from './timeline'

const clips: Clip[] = [
  { id: 'a', mediaId: 'm1', in: 0, out: 4 },
  { id: 'b', mediaId: 'm2', in: 2, out: 5 },
]

describe('timeline math', () => {
  it('sums clip lengths', () => {
    expect(totalDuration(clips)).toBe(7)
    expect(clipStarts(clips)).toEqual([0, 4])
  })

  it('locates the clip under a time', () => {
    expect(locate(clips, 0)).toEqual({ index: 0, offset: 0 })
    expect(locate(clips, 4)).toEqual({ index: 1, offset: 0 })
    expect(locate(clips, 6.5)).toEqual({ index: 1, offset: 2.5 })
    expect(locate(clips, 7)).toBeNull()
  })

  it('splits a clip at the playhead', () => {
    const result = splitAt(clips, 5)
    expect(result).toHaveLength(3)
    expect(result[1]).toMatchObject({ id: 'b', in: 2, out: 3 })
    expect(result[2]).toMatchObject({ mediaId: 'm2', in: 3, out: 5 })
    expect(totalDuration(result)).toBe(7)
  })

  it('does not split on a clip edge', () => {
    expect(splitAt(clips, 4)).toBe(clips)
    expect(splitAt(clips, 9)).toBe(clips)
  })

  it('moves items', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1])
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2])
  })

  it('clamps trims to the source', () => {
    expect(trimClip(clips[0], 4, { in: -1 })).toMatchObject({ in: 0, out: 4 })
    expect(trimClip(clips[0], 4, { out: 10 })).toMatchObject({ out: 4 })
    expect(trimClip(clips[0], 4, { in: 4 })).toMatchObject({ in: 3.9, out: 4 })
  })

  it('finds visible texts and formats time', () => {
    const texts = [{ id: 't', text: 'Ciao', start: 1, duration: 2, x: 0.5, y: 0.5, size: 48, color: '#fff' }]
    expect(textsAt(texts, 0.5)).toHaveLength(0)
    expect(textsAt(texts, 1.5)).toHaveLength(1)
    expect(formatTime(65.25)).toBe('1:05.3')
  })
})
