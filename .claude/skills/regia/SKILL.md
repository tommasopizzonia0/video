---
name: regia
description: Make the four arrows of the live Motion studio (Video, Timeline, Caricamenti, Audio) reason as a team of Claude agents, each on its own section, talking to each other, with you as the director. Use when Tomm writes "regia", asks the arrows to think, or presses "Fai ragionare Claude" in the Regia panel.
---

# Regia: the arrows reason as a team

The live studio (`npm run dev`, `#live`) has four arrows. With the built-in rules (`src/agents/agents.ts`)
they follow fixed checks. With this skill **you** give each of them a mind: one agent per arrow, each
looking only at its own section, asking the others for what is not theirs, and you as the director who
turns their conversation into proposals. Tomm applies them in the Regia panel; nothing changes before.

## 1. Read what the arrows see

Tomm opens the Regia panel and presses **Analizza** or **Fai ragionare Claude**. The studio then writes:

- `live/team/context.json`: duration, platform and safe zone, scenes (start, length, frame file), what the
  Video arrow measured on every text (`look`: box, seconds readable, words, contrast, seconds outside the
  safe zone), file facts (`media`: lengths and sizes), and what the fixed rules found (`rules`): use them
  as hints, not as the answer.
- `live/team/frames/*.png`: one frame per scene (at 60% of it), named `NN-<scene id>-<time>s.png`.
- `live/current.json`: the composition (`json`), the one every proposal must apply to.

If `context.json` is missing or older than the last change to `live/current.json`, ask Tomm to press
**Analizza** in the Regia panel first.

## 2. The director's brief

Read `ruoli/regista.md` (your role) and `ruoli/sapere/regia.md` (the director's field), and write the brief it describes (genre, platform, audience, the one
thing to remember, the action, tone). Every arrow gets it: the same video is cut, mixed and graded
differently if it is an ad, a tutorial or a documentary.

## 3. One agent per arrow

Start four agents in parallel (Agent tool, one per arrow), unless Tomm asks for a quick round, in which
case reason as each arrow yourself, one at a time, without mixing their points of view. Each agent is a
senior professional with the whole knowledge of its field: tell it to read its role file and the field
map it points to (`ruoli/sapere/`, absolute paths) before anything else, and to work by them:

| Arrow | Role file | Who it is |
|---|---|---|
| `audio` | `ruoli/audio.md` | re-recording mixer and sound designer (listens with earshot when available) |
| `timeline` | `ruoli/timeline.md` | picture editor |
| `video` | `ruoli/video.md` | motion designer, art director and colorist (looks at the frames) |
| `media` | `ruoli/media.md` | producer and asset manager |

Give each agent: the brief, the composition, `context.json`, the frames it needs, its role file, the
ownership rules below and the output format. Ask it to look with taste, not only for errors: rhythm, the hook in the first 2 seconds,
whether a frame says what the voice says, whether the music fits the cut, whether the call to action
lands. Each one returns at most 4 messages.

| Arrow | Its section (what it may change) | What it looks at |
|---|---|---|
| `video` | how layers look: position, size, colour, font, stroke, background, presets, grade, effects | the frames, `look` |
| `timeline` | timing: `scenes[i].duration` / `beats` / `transition`, scene order, layer `start` / `duration`, `duration` | scene lengths, cuts, transitions, pace |
| `media` | `assets`, `fonts` | `media`, missing and unused files, file quality |
| `audio` | `audio`, `mix`, and a video layer's `volume` / `muted` / `mixer` | music, voice, effects, levels, ending |

The director enforces this (`ownerOf` in `src/agents/team.ts`): an arrow that changes another's section is
vetoed. When the fix belongs to someone else, the arrow **asks** that arrow (a message `to` it).

## 4. Let them talk

Deliver every request to the arrow it is addressed to (a second round of the same agents, or reason as
that arrow yourself with its section and the request) and let it answer: accept with a change, refuse
with a reason, or pass it on (Timeline lengthens a scene → tells Audio the video ends later). Stop a chain
after 4 hops. Before each answer, apply the changes already agreed in the same chain, so the next arrow
sees the composition as it would be.

## 5. Write the round

Write it into `live/current.json` next to `json` (keep `json` unchanged: proposals are not applied yet):

```json
"team": {
  "round": "2026-11-16T19:30:00Z",
  "messages": [
    { "plan": 1, "from": "video", "to": "timeline", "text": "Timeline, il titolo dell'apertura passa troppo in fretta: puoi dargli un secondo in più?", "target": { "x": 540, "y": 860 }, "at": 1.2 },
    { "plan": 1, "from": "timeline", "to": "regista", "text": "Allungo l'apertura da 2.2 a 3.2 s.", "ops": [{ "op": "set", "path": ["scenes", 0, "duration"], "value": 3.2 }], "target": { "clip": "apertura", "edge": "end" } },
    { "plan": 1, "from": "timeline", "to": "audio", "text": "Audio, ora il video finisce a 15.6 s.", "target": { "clip": "apertura" } },
    { "plan": 1, "from": "audio", "to": "regista", "text": "Porto la musica a 15.6 s con una dissolvenza.", "ops": [{ "op": "set", "path": ["audio", 0, "duration"], "value": 15.6 }], "target": { "channel": "a0" } },
    { "from": "media", "to": "regista", "text": "Le due clip sono a 480p: a tutto schermo si vedranno morbide.", "target": { "media": "04-ulivi-vaso.mp4" } }
  ]
}
```

- `plan` groups one chain into one proposal; messages without `plan` are notes for Tomm.
- `ops`: `set` (path → value), `push` (append to a list), `remove` (a key or a list item), on paths of the
  current composition. Only on messages from the arrow that owns the path.
  Only fields documented in `docs/MOTION.md`: a proposal that adds an unknown key or an invalid value is
  dropped by the studio, so tell every agent to check the doc before inventing a field.
- `target`: where that arrow points while it speaks (`{x,y}` on the frame in comp px, `{clip}` with a
  scene id or layer id/label, `{media}` with a file name, `{channel}` like `a0`, `bus:music`, `master`).
- Write in Italian, short, as colleagues talking; address the other arrow by name ("Timeline, …").
- A new `round` value every time, or the studio ignores it.

The studio checks every proposal with the same rules as the built-in team (ownership, it must apply,
duplicates dropped, colliding proposals wait), plays the conversation on the arrows and shows it in the
Regia panel under **Ragiona Claude**. Then give Tomm the director's note (see `ruoli/regista.md`).

## On claude.ai (Artifact)

The same `team` field goes into the shared document `live/current` (with `json`). The studio there has
no `context.json`: read the composition and reason from it, without frames.
