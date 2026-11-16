# Skill del progetto

| skill | da dove | licenza | cosa esegue |
|---|---|---|---|
| `motion-video` | nostra | — | il motore Motion del repo |
| `globe-arcs` | nostra (scritta per questo repo) | — · dati Natural Earth via world-atlas (ISC) | Playwright del repo + ffmpeg |
| `hologram` | nostra, per il motore Motion | — | ffmpeg (`holo.mjs`) |
| `swiss-grid` | nostra, per il motore Motion | — | niente oltre al motore |
| `map-route` | [artemnovitckii/claude-animation-skills](https://github.com/artemnovitckii/claude-animation-skills) `skills/map-route` + `kit/` (in `.claude/kit/`) | MIT | python3, ffmpeg, `npx hyperframes@0.8.34`; setup una tantum: `bash .claude/kit/setup.sh` (installa three.js e Playwright in `.claude/kit/node_modules`, scarica GSAP da cdnjs) |
| `regia` | nostra (manuali dei ruoli in `ruoli/`) | — | niente: legge `live/team/` e scrive il giro delle freccette in `live/current.json` |
| `teardown` | [elvarofficial/teardown](https://github.com/elvarofficial/teardown) (senza le GIF di `docs/`) | MIT; suoni CC0 da Freesound (`sfx/samples/SOURCES.md`) | node, ffmpeg, python3; setup una tantum nella cartella della skill: `npm install && npx playwright install chromium` |
| `threejs-*` (13 skill: `fundamentals`, `animation`, `geometry`, `materials`, `lighting`, `textures`, `shaders`, `postprocessing`, `loaders`, `interaction`, `performance`, `asset-pipeline`, `react-three-fiber`) | [CloudAI-X/threejs-skills](https://github.com/CloudAI-X/threejs-skills) @ `0e18186` | MIT | niente: sono guide di riferimento (API three.js r186) che Claude legge quando scrive scene 3D e animazioni |

Le skill di terzi sono copiate così come sono e lette prima di aggiungerle: lanciano solo ffmpeg, node,
python e i loro pacchetti npm, non mandano dati a servizi esterni. Non sono ancora state eseguite: la prima
volta va fatto il setup indicato sopra.

`hologram` e `swiss-grid` seguono convenzioni di stile note (HUD fantascientifico, Stile tipografico
internazionale) scritte con parole nostre: nessun testo è copiato da guide con licenza non commerciale.

Le `threejs-*` sono solo testo (nessuno script): tengono Claude sull'API attuale di three.js (r186: `Timer` al posto di `Clock`,
`HDRLoader`, `AnimationMixer`, WebGPU/TSL). `threejs-animation` è quella per le animazioni (keyframe, scheletri,
morph target, moto procedurale, crossfade tra clip).
