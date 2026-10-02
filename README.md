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
npm test        # test della logica della timeline
npm run lint    # controllo del codice
npm run build   # versione ottimizzata in dist/
```

## Com'è fatto

- `src/timeline.ts`: il modello dati (clip, testi, musica) e i calcoli sulla timeline
- `src/state.ts`: tutte le modifiche al progetto (aggiungi, taglia, dividi, sposta, elimina)
- `src/player.ts`: riproduce la timeline su un `<canvas>` e la registra per l'export
- `src/components/`: libreria media, timeline e pannello proprietà

Costruito con React, TypeScript e Vite.
