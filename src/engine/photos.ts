// Photo search for ads: results from free archives turned into one shape, with the licence read
// and judged for use in a paid ad. No imports, so the CLI can load this file with Node directly.

export type Licence = 'cc0' | 'pdm' | 'by' | 'by-sa' | 'pexels' | 'pixabay' | 'other'

export interface Photo {
  /** Source and id, e.g. "openverse:1c7d…". */
  id: string
  source: 'openverse' | 'wikimedia' | 'pexels' | 'pixabay'
  title: string
  /** Full-size image. */
  url: string
  /** Small preview. */
  thumb: string
  width: number
  height: number
  licence: Licence
  /** e.g. "CC BY 4.0", "Pexels License". */
  licenceName: string
  licenceUrl: string
  creator: string
  creatorUrl?: string
  /** The photo's page, where the licence can be checked. */
  page: string
  /** Rights the licence does not cover, as the archive reports them (people, trademarks). */
  restrictions: string[]
}

export interface PhotoFilter {
  /** Shortest side in pixels (default 1080). */
  minSide?: number
  orientation?: 'tall' | 'wide' | 'square'
  /** Accept CC BY-SA (share-alike: the edited ad picture should carry the same licence). */
  shareAlike?: boolean
}

const CC_NAMES: Record<string, Licence> = { cc0: 'cc0', pdm: 'pdm', by: 'by', 'by-sa': 'by-sa' }

function plain(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function ccName(l: Licence, version: string): string {
  if (l === 'cc0') return 'CC0 1.0'
  if (l === 'pdm') return 'Public Domain Mark 1.0'
  return `CC ${l.toUpperCase()}${version ? ` ${version}` : ''}`
}

/** Openverse API `/v1/images/` response. */
export function fromOpenverse(json: { results?: Record<string, unknown>[] }): Photo[] {
  return (json.results ?? []).map((r) => {
    const licence = CC_NAMES[String(r.license)] ?? 'other'
    return {
      id: `openverse:${r.id}`,
      source: 'openverse' as const,
      title: String(r.title ?? ''),
      url: String(r.url),
      thumb: String(r.thumbnail ?? r.url),
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
      licence,
      licenceName: licence === 'other' ? String(r.license ?? '').toUpperCase() : ccName(licence, String(r.license_version ?? '')),
      licenceUrl: String(r.license_url ?? ''),
      creator: String(r.creator ?? ''),
      creatorUrl: r.creator_url ? String(r.creator_url) : undefined,
      page: String(r.foreign_landing_url ?? ''),
      restrictions: [],
    }
  })
}

interface WikiPage {
  pageid: number
  title: string
  imageinfo?: { url: string; descriptionurl: string; width: number; height: number; thumburl?: string; extmetadata?: Record<string, { value: string }> }[]
}

/** Wikimedia Commons API (`generator=search`, `prop=imageinfo` with `extmetadata`). */
export function fromWikimedia(json: { query?: { pages?: Record<string, WikiPage> } }): Photo[] {
  const out: Photo[] = []
  for (const p of Object.values(json.query?.pages ?? {})) {
    const ii = p.imageinfo?.[0]
    if (!ii) continue
    const m = ii.extmetadata ?? {}
    const code = (m.License?.value ?? '').toLowerCase()
    const licence: Licence = code === 'cc0' ? 'cc0' : code.startsWith('pd') ? 'pdm' : /^cc-by-sa-/.test(code) ? 'by-sa' : /^cc-by-\d/.test(code) ? 'by' : 'other'
    out.push({
      id: `wikimedia:${p.pageid}`,
      source: 'wikimedia',
      title: p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
      url: ii.url,
      thumb: ii.thumburl ?? ii.url,
      width: ii.width,
      height: ii.height,
      licence,
      licenceName: plain(m.LicenseShortName?.value ?? code),
      licenceUrl: m.LicenseUrl?.value ?? '',
      creator: plain(m.Artist?.value ?? ''),
      page: ii.descriptionurl,
      restrictions: (m.Restrictions?.value ?? '').split('|').filter(Boolean),
    })
  }
  return out
}

/** Pexels API `/v1/search` response. */
export function fromPexels(json: { photos?: Record<string, unknown>[] }): Photo[] {
  return (json.photos ?? []).map((r) => {
    const src = (r.src ?? {}) as Record<string, string>
    return {
      id: `pexels:${r.id}`,
      source: 'pexels' as const,
      title: String(r.alt ?? ''),
      url: src.original,
      thumb: src.medium ?? src.small ?? src.original,
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
      licence: 'pexels' as const,
      licenceName: 'Pexels License',
      licenceUrl: 'https://www.pexels.com/license/',
      creator: String(r.photographer ?? ''),
      creatorUrl: r.photographer_url ? String(r.photographer_url) : undefined,
      page: String(r.url ?? ''),
      restrictions: [],
    }
  })
}

/** Pixabay API response. `largeImageURL` is at most 1280 px on its long side without full API access. */
export function fromPixabay(json: { hits?: Record<string, unknown>[] }): Photo[] {
  return (json.hits ?? []).map((r) => {
    // The downloadable size, not the original's.
    const scale = Math.min(1, 1280 / Math.max(Number(r.imageWidth) || 1, Number(r.imageHeight) || 1))
    return {
      id: `pixabay:${r.id}`,
      source: 'pixabay' as const,
      title: String(r.tags ?? ''),
      url: String(r.largeImageURL),
      thumb: String(r.webformatURL ?? r.previewURL ?? r.largeImageURL),
      width: Math.round((Number(r.imageWidth) || 0) * scale),
      height: Math.round((Number(r.imageHeight) || 0) * scale),
      licence: 'pixabay' as const,
      licenceName: 'Pixabay Content License',
      licenceUrl: 'https://pixabay.com/service/license-summary/',
      creator: String(r.user ?? ''),
      page: String(r.pageURL ?? ''),
      restrictions: [],
    }
  })
}

/** Whether the licence allows a paid ad with an edited picture; `credit` when the author must be named. */
export function adUse(p: Photo, f: PhotoFilter = {}): { ok: boolean; credit: boolean; note?: string } {
  switch (p.licence) {
    case 'cc0':
    case 'pdm':
    case 'pexels':
    case 'pixabay':
      return { ok: true, credit: false }
    case 'by':
      return { ok: true, credit: true, note: 'citare autore e licenza (es. nella descrizione dell’annuncio)' }
    case 'by-sa':
      return f.shareAlike
        ? { ok: true, credit: true, note: 'citare autore e licenza; l’immagine modificata va rilasciata con la stessa licenza' }
        : { ok: false, credit: true, note: 'share-alike: escluso salvo --sa' }
    default:
      return { ok: false, credit: true, note: 'licenza non riconosciuta' }
  }
}

/** Kept photos, best first: no credit needed, then size; wrong shape or too small left out. */
export function choosePhotos(photos: Photo[], f: PhotoFilter = {}): Photo[] {
  const min = f.minSide ?? 1080
  const seen = new Set<string>()
  const kept = photos.filter((p) => {
    if (seen.has(p.url)) return false
    if (!adUse(p, f).ok) return false
    if (Math.min(p.width, p.height) < min) return false
    const r = p.width / p.height
    if (f.orientation === 'tall' && r > 0.9) return false
    if (f.orientation === 'wide' && r < 1.1) return false
    if (f.orientation === 'square' && (r < 0.8 || r > 1.25)) return false
    seen.add(p.url)
    return true
  })
  const score = (p: Photo) => (adUse(p, f).credit ? 0 : 1) * 1e9 + Math.min(p.width, p.height)
  return kept.sort((a, b) => score(b) - score(a))
}

/** The credit line for a photo, in the usual Title–Author–Source–Licence order. */
export function creditLine(p: Photo): string {
  const title = p.title ? `“${p.title}”` : 'Foto'
  return `${title} di ${p.creator || 'autore sconosciuto'} (${p.page}), ${p.licenceName}${p.licenceUrl ? ` ${p.licenceUrl}` : ''}`
}
