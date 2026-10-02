# Video Editor

Un editor video semplice che gira interamente nel browser. I file non vengono caricati da nessuna parte: restano sul tuo computer.

## Cosa sa fare

- **Importare** video e audio (pulsante «Importa» oppure trascinando i file nella finestra)
- **Timeline** con tracce per video, testi e musica; trascina le clip per riordinarle
- **Tagliare** l'inizio e la fine di ogni clip, e **dividere** una clip al cursore (tasto `S`)
- **Testi** sovrapposti con posizione, dimensione, colore e dissolvenza
- **Musica di sottofondo** con volume separato da quello delle clip
- **Formati** 16:9, 9:16 (Reels/TikTok) e 1:1
- **Esportare** in MP4 (o WebM se il browser non supporta MP4)

## Motion: video di motion design

Oltre all'editor di clip c'è la vista **Motion** (pulsante «✦ Motion» in alto, oppure l'indirizzo con `#motion`):
un video è descritto da un file JSON con scene, testi animati, forme, immagini, video, keyframe con easing,
transizioni ed effetti. Scrivi o apri il JSON a sinistra, guardi l'anteprima a destra (spazio per play,
frecce per spostarti di un fotogramma) ed esporti l'MP4 fotogramma per fotogramma, identico all'anteprima.
Se il JSON usa immagini, video o musica, aggiungili con «Aggiungi file» o trascinandoli nella finestra.

Lo stesso file si trasforma in MP4 anche da terminale, senza aprire il browser:

```bash
npx playwright install chromium   # una volta sola
npm run render -- examples/launch.json              # crea examples/launch.mp4
npm run render -- examples/launch.json --contact 24 # un'immagine con 24 fotogrammi, per controllare tutto il video
```

Serve [ffmpeg](https://ffmpeg.org) per l'MP4 migliore (senza, il video viene codificato nel browser).
Il formato completo è in [docs/MOTION.md](docs/MOTION.md); gli esempi sono in `examples/`.

Scorciatoie: `Spazio` play/pausa · `S` dividi · `Canc` elimina la selezione · `←/→` sposta il cursore (con `Shift` di un secondo).

L'export registra l'anteprima in tempo reale: un video di 30 secondi richiede circa 30 secondi. Tieni la scheda aperta e in primo piano mentre esporta. Funziona al meglio su Chrome o Edge.

## Usarlo online

Ogni modifica su `main` viene pubblicata su GitHub Pages: https://tommasopizzonia0.github.io/video/

(La prima volta va attivato in **Settings → Pages → Source: GitHub Actions**.)

## Avviarlo sul tuo computer

Serve [Node.js](https://nodejs.org) 22 o più recente.

```bash
npm install
npm run dev
```

Poi apri l'indirizzo che appare nel terminale (di solito http://localhost:5173).

Altri comandi:

```bash
npm test        # test della timeline e del motore Motion
npm run lint    # controllo del codice
npm run build   # versione ottimizzata in dist/
```

## Com'è fatto

- `src/timeline.ts`: il modello dati (clip, testi, musica) e i calcoli sulla timeline
- `src/state.ts`: tutte le modifiche al progetto (aggiungi, taglia, dividi, sposta, elimina)
- `src/player.ts`: riproduce la timeline su un `<canvas>` e la registra per l'export
- `src/components/`: libreria media, timeline e pannello proprietà
- `src/engine/`: il motore Motion (formato JSON, animazioni, testo, render su canvas, export MP4)
- `src/studio/`: la vista Motion
- `scripts/render.mjs`: il render da terminale con Chromium

Costruito con React, TypeScript e Vite.
