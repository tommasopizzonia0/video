import { describe, expect, it } from 'vitest'
import { adUse, choosePhotos, creditLine, fromOpenverse, fromPexels, fromPixabay, fromWikimedia, type Photo } from './photos'

// Shapes copied from real API responses (trimmed).
const openverse = {
  results: [
    { id: 'a1', title: 'Lorca Olive Tree', url: 'https://upload.wikimedia.org/x/Lorca.jpg', thumbnail: 'https://api.openverse.org/v1/images/a1/thumb/', width: 1167, height: 1740, license: 'by-sa', license_version: '3.0', license_url: 'https://creativecommons.org/licenses/by-sa/3.0/', creator: 'Dr Graham Beards', foreign_landing_url: 'https://commons.wikimedia.org/w/index.php?curid=3537882' },
    { id: 'a2', title: 'Olive grove', url: 'https://live.staticflickr.com/1/2_b.jpg', width: 1024, height: 683, license: 'by', license_version: '2.0', license_url: 'https://creativecommons.org/licenses/by/2.0/', creator: 'Ian', foreign_landing_url: 'https://www.flickr.com/photos/1/2' },
    { id: 'a3', title: 'Old tree', url: 'https://live.staticflickr.com/3/4_b.jpg', width: 3000, height: 4000, license: 'cc0', license_version: '1.0', creator: 'Ann', foreign_landing_url: 'https://www.flickr.com/photos/3/4' },
    { id: 'a4', title: 'Tree NC', url: 'https://live.staticflickr.com/5/6_b.jpg', width: 3000, height: 4000, license: 'by-nc', license_version: '2.0', creator: 'Bo', foreign_landing_url: 'https://www.flickr.com/photos/5/6' },
  ],
}
const wikimedia = {
  query: {
    pages: {
      '1': {
        pageid: 153467386,
        title: 'File:Lun Olive-Gardens (2).jpg',
        imageinfo: [{ url: 'https://upload.wikimedia.org/wikipedia/commons/2/2b/Lun.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Lun.jpg', width: 6000, height: 4000, extmetadata: { License: { value: 'cc-by-4.0' }, LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0' }, Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:P">Palau &amp; co</a>' }, Restrictions: { value: 'personality|trademarked' } } }],
      },
      '2': { pageid: 2, title: 'File:Pd.jpg', imageinfo: [{ url: 'u', descriptionurl: 'd', width: 2000, height: 3000, extmetadata: { License: { value: 'pd' }, LicenseShortName: { value: 'Public domain' } } }] },
    },
  },
}

describe('photo search: parsing', () => {
  it('reads Openverse and Wikimedia licences, creators and restrictions', () => {
    const o = fromOpenverse(openverse)
    expect(o.map((p) => p.licence)).toEqual(['by-sa', 'by', 'cc0', 'other'])
    expect(o[0]).toMatchObject({ licenceName: 'CC BY-SA 3.0', creator: 'Dr Graham Beards', width: 1167 })
    const w = fromWikimedia(wikimedia)
    expect(w[0]).toMatchObject({ licence: 'by', licenceName: 'CC BY 4.0', creator: 'Palau & co', title: 'Lun Olive-Gardens (2)', restrictions: ['personality', 'trademarked'] })
    expect(w[1].licence).toBe('pdm')
  })

  it('reads Pexels and Pixabay (Pixabay at its downloadable size)', () => {
    const px = fromPexels({ photos: [{ id: 9, width: 4000, height: 6000, url: 'https://www.pexels.com/photo/9/', photographer: 'Eva', src: { original: 'https://images.pexels.com/9.jpg', medium: 'm' }, alt: 'olive tree' }] })
    expect(px[0]).toMatchObject({ licence: 'pexels', url: 'https://images.pexels.com/9.jpg', creator: 'Eva' })
    const pb = fromPixabay({ hits: [{ id: 7, pageURL: 'p', imageWidth: 4000, imageHeight: 6000, largeImageURL: 'l', user: 'U', tags: 'tree' }] })
    expect([pb[0].width, pb[0].height]).toEqual([853, 1280])
  })
})

describe('photo search: licences for ads', () => {
  const all = fromOpenverse(openverse)
  it('keeps free and attribution licences, drops non-commercial and, unless asked, share-alike', () => {
    expect(adUse(all[2])).toEqual({ ok: true, credit: false })
    expect(adUse(all[1])).toMatchObject({ ok: true, credit: true })
    expect(adUse(all[0]).ok).toBe(false)
    expect(adUse(all[0], { shareAlike: true }).ok).toBe(true)
    expect(adUse(all[3]).ok).toBe(false)
  })

  it('filters by size and shape and puts photos without credit first', () => {
    const extra: Photo = { ...all[1], id: 'x', url: 'big-by', width: 3200, height: 4800 }
    const chosen = choosePhotos([...all, extra], { minSide: 1080, orientation: 'tall' })
    expect(chosen.map((p) => p.title)).toEqual(['Old tree', 'Olive grove'])
    expect(chosen[1].url).toBe('big-by')
    // The 1167×1740 BY-SA one is tall and big enough once share-alike is allowed.
    expect(choosePhotos(all, { shareAlike: true, orientation: 'tall' }).map((p) => p.licence)).toEqual(['cc0', 'by-sa'])
  })

  it('writes the credit line', () => {
    expect(creditLine(all[1])).toBe('“Olive grove” di Ian (https://www.flickr.com/photos/1/2), CC BY 2.0 https://creativecommons.org/licenses/by/2.0/')
  })
})
