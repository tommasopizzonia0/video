# Skill del progetto

| skill | da dove | licenza | cosa esegue |
|---|---|---|---|
| `motion-video` | nostra | — | il motore Motion del repo |
| `globe-arcs` | nostra (scritta per questo repo) | — · dati Natural Earth via world-atlas (ISC) | Playwright del repo + ffmpeg |
| `hologram` | nostra, per il motore Motion | — | ffmpeg (`holo.mjs`) |
| `swiss-grid` | nostra, per il motore Motion | — | niente oltre al motore |
| `map-route` | [artemnovitckii/claude-animation-skills](https://github.com/artemnovitckii/claude-animation-skills) `skills/map-route` + `kit/` (in `.claude/kit/`) | MIT | python3, ffmpeg, `npx hyperframes@0.8.34`; setup una tantum: `bash .claude/kit/setup.sh` (installa three.js e Playwright in `.claude/kit/node_modules`, scarica GSAP da cdnjs) |
| `teardown` | [elvarofficial/teardown](https://github.com/elvarofficial/teardown) (senza le GIF di `docs/`) | MIT; suoni CC0 da Freesound (`sfx/samples/SOURCES.md`) | node, ffmpeg, python3; setup una tantum nella cartella della skill: `npm install && npx playwright install chromium` |

Le due skill di terzi sono copiate così come sono e lette prima di aggiungerle: lanciano solo ffmpeg, node,
python e i loro pacchetti npm, non mandano dati a servizi esterni. Non sono ancora state eseguite: la prima
volta va fatto il setup indicato sopra.

`hologram` e `swiss-grid` seguono convenzioni di stile note (HUD fantascientifico, Stile tipografico
internazionale) scritte con parole nostre: nessun testo è copiato da guide con licenza non commerciale.
