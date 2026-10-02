import {
  emptyProject,
  moveItem,
  newId,
  splitAt,
  trimClip,
  type Format,
  type MediaItem,
  type Project,
  type TextOverlay,
} from './timeline'

export type Selection = { kind: 'clip' | 'text'; id: string } | { kind: 'music' } | null

export interface State {
  media: MediaItem[]
  project: Project
  selection: Selection
}

export type Action =
  | { type: 'addMedia'; item: MediaItem }
  | { type: 'addClip'; mediaId: string }
  | { type: 'trimClip'; id: string; in?: number; out?: number }
  | { type: 'moveClip'; from: number; to: number }
  | { type: 'split'; time: number }
  | { type: 'addText'; time: number }
  | { type: 'updateText'; id: string; patch: Partial<TextOverlay> }
  | { type: 'setMusic'; mediaId: string | null }
  | { type: 'setMusicVolume'; volume: number }
  | { type: 'setClipVolume'; volume: number }
  | { type: 'setFormat'; format: Format }
  | { type: 'deleteSelection' }
  | { type: 'select'; selection: Selection }

export const initialState: State = { media: [], project: emptyProject(), selection: null }

export function reducer(state: State, action: Action): State {
  const { project } = state
  const withProject = (patch: Partial<Project>, selection = state.selection): State => ({
    ...state,
    project: { ...project, ...patch },
    selection,
  })

  switch (action.type) {
    case 'addMedia':
      return { ...state, media: [...state.media, action.item] }

    case 'addClip': {
      const item = state.media.find((m) => m.id === action.mediaId)
      if (!item || item.kind !== 'video') return state
      const clip = { id: newId('clip'), mediaId: item.id, in: 0, out: item.duration }
      return withProject({ clips: [...project.clips, clip] }, { kind: 'clip', id: clip.id })
    }

    case 'trimClip': {
      const clips = project.clips.map((c) => {
        if (c.id !== action.id) return c
        const duration = state.media.find((m) => m.id === c.mediaId)?.duration ?? c.out
        return trimClip(c, duration, { in: action.in, out: action.out })
      })
      return withProject({ clips })
    }

    case 'moveClip':
      return withProject({ clips: moveItem(project.clips, action.from, action.to) })

    case 'split':
      return withProject({ clips: splitAt(project.clips, action.time) })

    case 'addText': {
      const text: TextOverlay = {
        id: newId('text'),
        text: 'Il tuo testo',
        start: action.time,
        duration: 3,
        x: 0.5,
        y: 0.8,
        size: 56,
        color: '#ffffff',
      }
      return withProject({ texts: [...project.texts, text] }, { kind: 'text', id: text.id })
    }

    case 'updateText':
      return withProject({
        texts: project.texts.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)),
      })

    case 'setMusic':
      return withProject(
        { music: action.mediaId ? { mediaId: action.mediaId, volume: project.music?.volume ?? 0.6 } : null },
        action.mediaId ? { kind: 'music' } : null,
      )

    case 'setMusicVolume':
      return project.music ? withProject({ music: { ...project.music, volume: action.volume } }) : state

    case 'setClipVolume':
      return withProject({ clipVolume: action.volume })

    case 'setFormat':
      return withProject({ format: action.format })

    case 'deleteSelection': {
      const sel = state.selection
      if (!sel) return state
      if (sel.kind === 'clip') return withProject({ clips: project.clips.filter((c) => c.id !== sel.id) }, null)
      if (sel.kind === 'text') return withProject({ texts: project.texts.filter((t) => t.id !== sel.id) }, null)
      return withProject({ music: null }, null)
    }

    case 'select':
      return { ...state, selection: action.selection }
  }
}
