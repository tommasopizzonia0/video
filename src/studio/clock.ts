// The playhead time while the preview plays. It changes every frame, so it lives outside React state:
// only the few things that move with it (the playhead, the timecode) subscribe and update the page
// directly, instead of the whole studio re-rendering 60 times a second.

export class Clock {
  private t = 0
  private listeners = new Set<(t: number) => void>()

  get(): number {
    return this.t
  }

  set(t: number) {
    if (t === this.t) return
    this.t = t
    for (const l of this.listeners) l(t)
  }

  /** Calls `fn` now and on every change. Returns the unsubscribe. */
  watch(fn: (t: number) => void): () => void {
    this.listeners.add(fn)
    fn(this.t)
    return () => {
      this.listeners.delete(fn)
    }
  }
}
