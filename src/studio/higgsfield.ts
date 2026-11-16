// Higgsfield: where AI-generated clips come from.
//
// Today the link is one-way and free: clips generated on higgsfield.ai and saved in the
// Higgsfield folder (HIGGSFIELD_DIR, default `Videos/higgsfield` next to the repo) appear on their
// own in the Caricamenti panel, ready to drag into the timeline. Nothing here calls Higgsfield,
// so no credits are spent.
//
// Launching a generation from the editor is prepared but switched off: `generate()` is the single
// entry point the panel uses, and it refuses until a real implementation (a call through the dev
// server, with the API key kept server-side) is written and `ENABLED` is turned on on purpose.

export interface GenerationRequest {
  prompt: string
  /** A picture to start from (a library item URL), for image-to-video. */
  image?: string
  duration?: 5 | 10
  aspect?: '9:16' | '16:9' | '1:1'
}

/** Off: generating costs credits, so it stays off until it is switched on deliberately. */
export const ENABLED = false

export async function generate(req: GenerationRequest): Promise<never> {
  void req
  throw new Error('La generazione con Higgsfield non è ancora attiva: nessuna richiesta inviata, nessun credito usato.')
}
