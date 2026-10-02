import { newId, type MediaItem } from './timeline'

/** Read duration, size and a thumbnail from a user-picked file. */
export async function loadMediaFile(file: File): Promise<MediaItem> {
  const kind = file.type.startsWith('audio/') ? 'audio' : 'video'
  const url = URL.createObjectURL(file)
  const el = document.createElement(kind)
  el.preload = 'auto'
  el.muted = true
  el.src = url
  await new Promise<void>((resolve, reject) => {
    el.onloadedmetadata = () => resolve()
    el.onerror = () => reject(new Error(`Impossibile leggere "${file.name}"`))
  })
  const item: MediaItem = {
    id: newId('media'),
    name: file.name,
    kind,
    url,
    duration: el.duration,
    width: el instanceof HTMLVideoElement ? el.videoWidth : 0,
    height: el instanceof HTMLVideoElement ? el.videoHeight : 0,
  }
  if (el instanceof HTMLVideoElement && el.videoWidth) {
    item.thumbnail = await captureThumbnail(el).catch(() => undefined)
  }
  el.removeAttribute('src')
  return item
}

async function captureThumbnail(video: HTMLVideoElement): Promise<string> {
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve()
    video.currentTime = Math.min(1, video.duration / 2)
  })
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = Math.round((160 * video.videoHeight) / video.videoWidth)
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.7)
}
