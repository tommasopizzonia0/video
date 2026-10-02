import { useRef, type Dispatch } from 'react'
import type { Action } from '../state'
import { formatTime, type MediaItem, type MusicTrack } from '../timeline'

interface Props {
  media: MediaItem[]
  music: MusicTrack | null
  onImport: (files: FileList) => void
  dispatch: Dispatch<Action>
}

export function Library({ media, music, onImport, dispatch }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <aside className="panel library">
      <div className="panel-head">
        <h2>Media</h2>
        <button onClick={() => inputRef.current?.click()}>+ Importa</button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onImport(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {media.length === 0 ? (
        <p className="muted">Importa video e una traccia musicale. I file restano sul tuo computer: niente viene caricato online.</p>
      ) : (
        <ul className="media-list">
          {media.map((item) => (
            <li key={item.id} className="media-item">
              <div className="thumb">
                {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span>{item.kind === 'audio' ? '♪' : '▶'}</span>}
              </div>
              <div className="media-info">
                <div className="media-name" title={item.name}>
                  {item.name}
                </div>
                <div className="muted">{formatTime(item.duration)}</div>
              </div>
              {item.kind === 'video' ? (
                <button onClick={() => dispatch({ type: 'addClip', mediaId: item.id })} title="Aggiungi alla timeline">
                  +
                </button>
              ) : (
                <button
                  className={music?.mediaId === item.id ? 'active' : ''}
                  onClick={() => dispatch({ type: 'setMusic', mediaId: music?.mediaId === item.id ? null : item.id })}
                  title="Usa come musica di sottofondo"
                >
                  {music?.mediaId === item.id ? '♪ In uso' : '♪ Usa'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
